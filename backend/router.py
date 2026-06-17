"""
Routers da API REST.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response

from backend.config import (
    ALLOWED_CONTENT_TYPE,
    MAX_FILE_SIZE_BYTES,
    MAX_FILE_SIZE_MB,
    OUTPUT_DIR,
)
from backend.pdf_service import apply_edits_and_export, extract_document, save_upload, render_page_image
from backend.schemas import DocumentInfo, ExportRequest

router = APIRouter(prefix="/api", tags=["pdf"])


# ── upload ────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DocumentInfo, summary="Enviar PDF para edição")
async def upload_pdf(file: UploadFile = File(...)) -> DocumentInfo:
    """
    Recebe um PDF, valida e extrai seus blocos de texto.

    - Tamanho máximo: configurável via MAX_FILE_SIZE_MB (padrão 50 MB).
    - Tipo permitido: application/pdf.
    """
    # Validação de tipo MIME
    if file.content_type != ALLOWED_CONTENT_TYPE:
        raise HTTPException(
            status_code=415,
            detail=f"Tipo de arquivo inválido: '{file.content_type}'. Envie um PDF.",
        )

    file_bytes = await file.read()

    # Validação de tamanho
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Arquivo excede o limite de {MAX_FILE_SIZE_MB} MB.",
        )

    # Validação de header mágico do PDF
    if not file_bytes.startswith(b"%PDF"):
        raise HTTPException(
            status_code=422,
            detail="O arquivo enviado não é um PDF válido.",
        )

    try:
        session_id, saved_path = save_upload(file_bytes, file.filename or "document.pdf")
        doc_info = extract_document(saved_path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Erro interno ao processar PDF: {exc}"
        ) from exc

    return doc_info


# ── page image ────────────────────────────────────────────────────────────────

@router.get("/document/{session_id}/page/{page_number}/image", summary="Obter imagem da página")
async def get_page_image(session_id: str, page_number: int) -> Response:
    """
    Retorna a imagem PNG de uma página específica do PDF para ser usada
    como background no editor WYSIWYG.
    """
    try:
        image_bytes = render_page_image(session_id, page_number)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Erro interno ao renderizar imagem: {exc}"
        ) from exc

    return Response(content=image_bytes, media_type="image/png")



# ── export ────────────────────────────────────────────────────────────────────

@router.post("/export", summary="Exportar PDF modificado")
async def export_pdf(request: ExportRequest) -> FileResponse:
    """
    Aplica as edições e novas inserções de texto e devolve o PDF modificado
    como download.
    """
    try:
        output_path = apply_edits_and_export(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Erro ao exportar PDF: {exc}"
        ) from exc

    return FileResponse(
        path=str(output_path),
        media_type="application/pdf",
        filename=f"{request.session_id}_edited.pdf",
        headers={"Content-Disposition": f'attachment; filename="{request.session_id}_edited.pdf"'},
    )


# ── health ────────────────────────────────────────────────────────────────────

@router.get("/health", summary="Health check")
async def health() -> dict:
    return {"status": "ok"}
