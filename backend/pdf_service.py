"""
Toda lógica de manipulação de PDF encapsulada aqui.
Usa PyMuPDF (fitz) para leitura e escrita.

Negrito inline:
  O texto pode conter marcadores **assim** para indicar trechos em negrito.
  Blocos SEM marcadores → insert_textbox (preserva fonte original).
  Blocos COM marcadores → insert_htmlbox (renderiza negrito misto).
"""

from __future__ import annotations

import html as _html_lib
import re
import uuid
from pathlib import Path
from typing import List, Tuple

import fitz  # PyMuPDF

from backend.config import OUTPUT_DIR, UPLOAD_DIR
from backend.schemas import (
    DocumentInfo,
    ExportRequest,
    PageInfo,
    TextBlock,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _hex_to_rgb(hex_color: str) -> Tuple[float, float, float]:
    """Converte '#rrggbb' para tuple (r, g, b) normalizado em [0, 1]."""
    hex_color = hex_color.lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", hex_color):
        hex_color = "000000"
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return r, g, b


def _get_dominant_font_size(span_list: list) -> float:
    """Retorna o tamanho de fonte mais frequente numa lista de spans."""
    sizes = [s["size"] for s in span_list if s.get("size")]
    return max(set(sizes), key=sizes.count) if sizes else 12.0


# Mapeamento: palavras-chave no nome da fonte → (base14_regular, base14_bold, css_family)
_FONT_MAP = [
    (["times", "roman", "georgia", "serif"],
     "tiro", "tibo", "times new roman, serif"),
    (["courier", "mono", "consola", "inconsolata"],
     "cour", "cobo", "courier, monospace"),
]
_DEFAULT = ("helv", "hebo", "helvetica, arial, sans-serif")


def _map_font(raw_font: str) -> Tuple[str, str, str]:
    """
    Dado o nome bruto de uma fonte PDF, retorna
    (base14_regular, base14_bold, css_family).

    Remove prefixos de fontes embutidas (ex: "ABCDEF+TimesNewRomanPSMT").
    """
    name = raw_font.split("+")[-1].lower()
    for keywords, reg, bold, css in _FONT_MAP:
        if any(k in name for k in keywords):
            return reg, bold, css
    return _DEFAULT


def _dominant_font(span_list: list) -> str:
    """Retorna o nome da fonte mais frequente numa lista de spans."""
    names = [s.get("font", "") for s in span_list if s.get("font")]
    return max(set(names), key=names.count) if names else ""


def _parse_bold_segments(text: str) -> List[Tuple[str, bool]]:
    """
    Divide o texto em segmentos (conteúdo, is_bold).
    Trechos entre **marcadores** são negrito.
    """
    segments: List[Tuple[str, bool]] = []
    last = 0
    for m in re.finditer(r'\*\*(.+?)\*\*', text, re.DOTALL):
        if m.start() > last:
            segments.append((text[last:m.start()], False))
        segments.append((m.group(1), True))
        last = m.end()
    if last < len(text):
        segments.append((text[last:], False))
    return segments or [(text, False)]


def _has_bold_markers(text: str) -> bool:
    return bool(re.search(r'\*\*.+?\*\*', text, re.DOTALL))


def _build_htmlbox(
    text: str,
    font_size: float,
    color_hex: str,
    css_family: str,
) -> str:
    """
    Constrói HTML para insert_htmlbox com negrito inline via **marcadores**.
    Usa a família de fonte detectada do PDF original.
    """
    color = color_hex if re.match(r'^#[0-9a-fA-F]{6}$', color_hex) else '#000000'
    parts: List[str] = []
    for seg, bold in _parse_bold_segments(text):
        safe   = _html_lib.escape(seg).replace('\n', '<br/>')
        weight = 'bold' if bold else 'normal'
        parts.append(f'<span style="font-weight:{weight}">{safe}</span>')

    body = ''.join(parts)
    return (
        f'<div style="'
        f'font-family:{css_family};'
        f'font-size:{font_size}pt;'
        f'color:{color};'
        f'margin:0;padding:0;'
        f'line-height:1.3'
        f'">{body}</div>'
    )


# ── operações principais ──────────────────────────────────────────────────────

def extract_document(file_path: Path) -> DocumentInfo:
    """
    Abre o PDF e extrai todos os blocos de texto com suas coordenadas.

    Blocos originalmente em negrito (span flag bit 4) são extraídos com o
    texto envolto em **marcadores**. A fonte dominante do bloco é preservada
    no campo font_family para ser usada na reinserção.

    Args:
        file_path: Caminho para o PDF no disco.

    Returns:
        DocumentInfo com metadados e blocos de texto de cada página.

    Raises:
        ValueError: Se o arquivo não puder ser aberto como PDF.
    """
    try:
        doc = fitz.open(str(file_path))
    except Exception as exc:
        raise ValueError(f"Não foi possível abrir o PDF: {exc}") from exc

    session_id = file_path.stem
    pages: List[PageInfo] = []

    for page_num in range(len(doc)):
        page   = doc[page_num]
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        text_blocks: List[TextBlock] = []
        block_index = 0

        for block in blocks:
            if block.get("type") != 0:
                continue

            all_spans = [
                span
                for line in block.get("lines", [])
                for span in line.get("spans", [])
            ]

            # Reconstrói texto preservando quebras de linha e negrito inline.
            lines_parts: List[str] = []
            for line in block.get("lines", []):
                line_segs: List[str] = []
                for span in line.get("spans", []):
                    span_text = span.get("text", "")
                    is_bold   = bool(span.get("flags", 0) & 16)
                    line_segs.append(f"**{span_text}**" if is_bold else span_text)
                lines_parts.append("".join(line_segs))
            raw_text = "\n".join(lines_parts)

            if not raw_text.strip():
                continue

            font_size   = _get_dominant_font_size(all_spans)
            raw_font    = _dominant_font(all_spans)
            base14_reg, _, _ = _map_font(raw_font)
            bbox = block["bbox"]

            text_blocks.append(
                TextBlock(
                    page=page_num,
                    block_index=block_index,
                    original_text=raw_text,
                    edited_text=raw_text,
                    x0=bbox[0],
                    y0=bbox[1],
                    x1=bbox[2],
                    y1=bbox[3],
                    font_size=font_size,
                    font_color="#000000",
                    font_family=base14_reg,   # base14 preservado para reinserção
                )
            )
            block_index += 1

        pages.append(
            PageInfo(
                page_number=page_num,
                width=page.rect.width,
                height=page.rect.height,
                text_blocks=text_blocks,
            )
        )

    doc.close()
    filename = file_path.name.rsplit("_", 1)[0] + ".pdf"
    return DocumentInfo(
        session_id=session_id,
        filename=filename,
        page_count=len(pages),
        pages=pages,
    )


def apply_edits_and_export(request: ExportRequest) -> Path:
    """
    Aplica edições e inserções ao PDF e salva a versão exportada.

    Estratégia de reinserção:
      - Sem **marcadores**: insert_textbox com a fonte base14 original.
      - Com **marcadores**: insert_htmlbox com CSS font-family mapeado.

    Em ambos os casos, a área original é apagada com branco e o rect
    de inserção é expandido até a margem da página para evitar clipping.

    Args:
        request: ExportRequest com session_id, edits e additions.

    Returns:
        Path para o arquivo PDF exportado.

    Raises:
        FileNotFoundError: Se o PDF original não for encontrado.
        ValueError: Se o número de página for inválido.
    """
    source_path = UPLOAD_DIR / f"{request.session_id}.pdf"
    if not source_path.exists():
        raise FileNotFoundError(f"Sessão não encontrada: {request.session_id}")

    try:
        doc = fitz.open(str(source_path))
    except Exception as exc:
        raise ValueError(f"Erro ao abrir PDF: {exc}") from exc

    page_count = len(doc)

    # ── aplicar edições em blocos existentes ──────────────────────────────────
    for edit in request.edits:
        if edit.page >= page_count:
            raise ValueError(f"Página {edit.page} inválida (total: {page_count})")
        if edit.edited_text == edit.original_text:
            continue

        page    = doc[edit.page]
        page_w  = page.rect.width
        page_h  = page.rect.height
        margin  = 20.0
        color   = _hex_to_rgb(edit.font_color)

        orig_rect   = fitz.Rect(edit.x0, edit.y0, edit.x1, edit.y1)
        insert_rect = fitz.Rect(edit.x0, edit.y0, page_w - margin, page_h - margin)

        # 1. Apagar área original
        page.draw_rect(orig_rect, color=(1, 1, 1), fill=(1, 1, 1))

        # 2a. Sem negrito inline → insert_textbox com fonte original
        if not _has_bold_markers(edit.edited_text):
            # Determina nome base14 a partir do font_family armazenado
            base14_reg, _, _ = _map_font(edit.font_family)
            page.insert_textbox(
                insert_rect,
                edit.edited_text,
                fontsize=edit.font_size,
                fontname=base14_reg,
                color=color,
                align=0,
            )

        # 2b. Com negrito inline → insert_htmlbox com família mapeada
        else:
            base14_reg, _, css_family = _map_font(edit.font_family)
            html = _build_htmlbox(
                edit.edited_text,
                edit.font_size,
                edit.font_color,
                css_family,
            )
            page.insert_htmlbox(insert_rect, html)

    # ── inserir novos blocos de texto ─────────────────────────────────────────
    for addition in request.additions:
        if addition.page >= page_count:
            raise ValueError(f"Página {addition.page} inválida (total: {page_count})")

        page   = doc[addition.page]
        margin = 20.0
        rect   = fitz.Rect(
            addition.x,
            addition.y,
            page.rect.width - margin,
            page.rect.height - margin,
        )

        if not _has_bold_markers(addition.text):
            base14_reg, _, _ = _map_font(addition.font_family)
            color = _hex_to_rgb(addition.font_color)
            page.insert_textbox(
                rect,
                addition.text,
                fontsize=addition.font_size,
                fontname=base14_reg,
                color=color,
                align=0,
            )
        else:
            _, _, css_family = _map_font(addition.font_family)
            html = _build_htmlbox(
                addition.text,
                addition.font_size,
                addition.font_color,
                css_family,
            )
            page.insert_htmlbox(rect, html)

    # ── salvar resultado ──────────────────────────────────────────────────────
    output_filename = f"{request.session_id}_edited.pdf"
    output_path     = OUTPUT_DIR / output_filename
    doc.save(str(output_path), garbage=4, deflate=True)
    doc.close()
    return output_path


def save_upload(file_bytes: bytes, original_filename: str) -> Tuple[str, Path]:
    """
    Salva o arquivo enviado em UPLOAD_DF com um session_id único.

    Args:
        file_bytes: Conteúdo binário do PDF.
        original_filename: Nome original do arquivo.

    Returns:
        Tuple (session_id, caminho_salvo).
    """
    session_id = uuid.uuid4().hex
    dest = UPLOAD_DIR / f"{session_id}.pdf"
    dest.write_bytes(file_bytes)
    return session_id, dest
