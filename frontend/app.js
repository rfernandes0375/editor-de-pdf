/**
 * app.js — Lógica do frontend do Editor de PDF Local
 *
 * Fluxo:
 *  1. Usuário faz upload → POST /api/upload → recebe DocumentInfo (session_id + blocos)
 *  2. Usuário edita os TextBlocks exibidos ou adiciona novos
 *     - Negrito INLINE: selecione parte do texto e clique N (ou Ctrl+B)
 *       O trecho selecionado fica envolto em **marcadores**: **texto negrito**
 *  3. Usuário clica "Exportar" → POST /api/export → download automático do PDF modificado
 */

"use strict";

// ── Estado global ────────────────────────────────────────────────────────────

const state = {
  sessionId: null,
  filename: null,
  pages: [],
  currentPage: 0,
  additions: [],
};

// ── Seletores ────────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const dropZone        = $("#drop-zone");
const fileInput       = $("#file-input");
const editorSection   = $("#editor-section");
const addSection      = $("#add-section");
const exportSection   = $("#export-section");
const blocksContainer = $("#blocks-container");
const docName         = $("#doc-name");
const pageSelect      = $("#page-select");
const addPageSelect   = $("#add-page");
const additionsListEl = $("#additions-list");
const exportBtn       = $("#export-btn");

// ── Negrito inline ───────────────────────────────────────────────────────────

/**
 * Envolve o texto selecionado no textarea com **marcadores** de negrito.
 * Se o trecho já estiver marcado, remove os marcadores (toggle).
 * @param {HTMLTextAreaElement} textarea
 */
function wrapBold(textarea) {
  const start = textarea.selectionStart;
  const end   = textarea.selectionEnd;

  if (start === end) {
    toast("Selecione o trecho que deseja negritar antes de clicar N.", "warn", 3500);
    return;
  }

  const text   = textarea.value;
  const before = text.slice(0, start);
  const sel    = text.slice(start, end);
  const after  = text.slice(end);

  // Toggle: se a seleção já está envolta em **, remove; caso contrário, adiciona
  if (sel.startsWith("**") && sel.endsWith("**") && sel.length > 4) {
    const inner = sel.slice(2, -2);
    textarea.value = before + inner + after;
    textarea.setSelectionRange(start, start + inner.length);
  } else {
    textarea.value = before + "**" + sel + "**" + after;
    textarea.setSelectionRange(start, end + 4);
  }

  // Dispara evento de input para marcar como modificado
  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
}

// ── Toast ────────────────────────────────────────────────────────────────────

function toast(message, type = "info", duration = 4000) {
  const icons = { info: "ℹ️", success: "✅", error: "❌", warn: "⚠️" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  $("#toast-container").appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Upload & Drag-and-drop ───────────────────────────────────────────────────

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleUpload(fileInput.files[0]);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) handleUpload(file);
});

async function handleUpload(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    toast("Selecione um arquivo PDF válido.", "error");
    return;
  }

  dropZone.innerHTML = `
    <span class="icon">⏳</span>
    <p>Processando <strong>${file.name}</strong>…</p>
    <div style="display:flex;justify-content:center;margin-top:14px"><div class="spinner"></div></div>
  `;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res  = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || `Erro ${res.status}`);

    state.sessionId   = data.session_id;
    state.filename    = data.filename;
    state.pages       = data.pages;
    state.currentPage = 0;
    state.additions   = [];

    populatePageSelects();
    renderPage(0);
    renderAdditionsList();

    editorSection.classList.remove("hidden");
    addSection.classList.remove("hidden");
    exportSection.classList.remove("hidden");
    docName.textContent = data.filename;
    exportBtn.disabled  = false;

    toast(`PDF carregado: ${data.page_count} página(s) detectada(s).`, "success");
  } catch (err) {
    toast(`Falha no upload: ${err.message}`, "error", 6000);
    resetDropZone();
  }
}

function resetDropZone() {
  dropZone.innerHTML = `
    <span class="icon">📄</span>
    <p>Arraste seu PDF aqui ou <strong>clique para selecionar</strong></p>
    <p class="hint">Apenas arquivos <strong>.pdf</strong> • Máx. 50 MB</p>
    <input type="file" id="file-input" accept=".pdf" />
  `;
  document.getElementById("file-input").addEventListener("change", (e) => {
    if (e.target.files[0]) handleUpload(e.target.files[0]);
  });
}

// ── Renderização de páginas ───────────────────────────────────────────────────

function populatePageSelects() {
  [pageSelect, addPageSelect].forEach((sel) => {
    sel.innerHTML = state.pages
      .map((p) => `<option value="${p.page_number}">Página ${p.page_number + 1}</option>`)
      .join("");
  });
}

pageSelect.addEventListener("change", () => {
  state.currentPage = parseInt(pageSelect.value, 10);
  renderPage(state.currentPage);
});

function renderPage(pageNum) {
  const page = state.pages.find((p) => p.page_number === pageNum);
  if (!page) return;

  blocksContainer.innerHTML = "";

  if (!page.text_blocks.length) {
    blocksContainer.innerHTML = `
      <div class="empty-state">
        <span class="icon">🔍</span>
        <p>Nenhum bloco de texto encontrado nesta página.</p>
      </div>`;
    return;
  }

  page.text_blocks.forEach((block, idx) => {
    const el = document.createElement("div");
    el.className = "block-item";
    el.dataset.page  = block.page;
    el.dataset.index = block.block_index;

    el.innerHTML = `
      <div class="block-meta">
        <span class="tag">Bloco ${idx + 1}</span>
        <span>Pág. ${block.page + 1}</span>
        <span>x:${block.x0.toFixed(0)} y:${block.y0.toFixed(0)}</span>
        <span>${(block.x1 - block.x0).toFixed(0)}×${(block.y1 - block.y0).toFixed(0)} pt</span>
      </div>
      <textarea class="block-textarea" rows="3"
        data-original="${escapeHtml(block.original_text)}"
        spellcheck="false">${escapeHtml(block.edited_text)}</textarea>
      <div class="block-controls">
        <label>Fonte</label>
        <input type="number" class="font-size" value="${block.font_size.toFixed(0)}" min="4" max="144" title="Tamanho da fonte" />
        <label>Cor</label>
        <input type="color" class="font-color" value="${block.font_color}" title="Cor do texto" />
        <button class="btn btn-bold" title="Negritar seleção  (Ctrl+B)" data-bold>
          <b>N</b>
        </button>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:.75rem" data-reset>↩ Restaurar</button>
      </div>
      <p class="bold-hint">✦ Selecione parte do texto e clique <b>N</b> (ou <kbd>Ctrl+B</kbd>) para negritar só esse trecho</p>
    `;

    const textarea    = el.querySelector(".block-textarea");
    const originalText = block.original_text;

    // Marca bloco como modificado ao editar
    textarea.addEventListener("input", () => {
      el.classList.toggle("modified", textarea.value !== originalText);
      updateBoldPreview(textarea);
    });

    // Aplica preview inicial de negrito (destaca **markers** visualmente)
    updateBoldPreview(textarea);

    // Botão N → wraps seleção
    el.querySelector("[data-bold]").addEventListener("click", () => {
      wrapBold(textarea);
      updateBoldPreview(textarea);
    });

    // Ctrl+B atalho de teclado
    textarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        wrapBold(textarea);
        updateBoldPreview(textarea);
      }
    });

    // Restaurar
    el.querySelector("[data-reset]").addEventListener("click", () => {
      textarea.value = originalText;
      el.classList.remove("modified");
      updateBoldPreview(textarea);
      toast("Texto restaurado.", "info", 2000);
    });

    blocksContainer.appendChild(el);
  });
}

/**
 * Destaca visualmente os **marcadores** na textarea aplicando
 * font-weight bold ao elemento se ele tiver qualquer marcador.
 * (Como textarea não suporta rich text, usamos um overlay simples.)
 */
function updateBoldPreview(textarea) {
  // Quando há marcadores, aplica leve destaque de borda para indicar
  // que o bloco tem formatação inline — sem alterar o texto em si.
  const hasMarkers = /\*\*.+?\*\*/s.test(textarea.value);
  textarea.classList.toggle("has-bold", hasMarkers);
}

// ── Adicionar novo bloco ──────────────────────────────────────────────────────

const newTextarea = $("#new-text");

// Ctrl+B no textarea de novo texto
newTextarea.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "b") {
    e.preventDefault();
    wrapBold(newTextarea);
  }
});

$("#new-bold-btn").addEventListener("click", () => wrapBold(newTextarea));

$("#add-btn").addEventListener("click", () => {
  const text  = newTextarea.value.trim();
  const page  = parseInt(addPageSelect.value, 10);
  const x     = parseFloat($("#new-x").value);
  const y     = parseFloat($("#new-y").value);
  const size  = parseFloat($("#new-size").value);
  const color = $("#new-color").value;

  if (!text)                              { toast("Informe o texto a inserir.", "warn");              return; }
  if (isNaN(x) || isNaN(y))             { toast("Informe coordenadas X e Y válidas.", "warn");       return; }
  if (isNaN(size) || size < 4 || size > 144) { toast("Tamanho de fonte entre 4 e 144.", "warn");    return; }

  state.additions.push({ page, text, x, y, font_size: size, font_color: color });
  renderAdditionsList();

  newTextarea.value = "";
  toast(`Bloco adicionado à página ${page + 1}.`, "success", 2500);
});

function renderAdditionsList() {
  additionsListEl.innerHTML = "";
  if (!state.additions.length) {
    additionsListEl.innerHTML = `<p style="color:var(--c-text-muted);font-size:.8rem">Nenhum bloco novo adicionado.</p>`;
    return;
  }
  state.additions.forEach((a, i) => {
    const el = document.createElement("div");
    el.className = "addition-tag";
    // Remove markers for preview display
    const preview = a.text.replace(/\*\*(.+?)\*\*/gs, '$1');
    el.innerHTML = `
      <span class="preview">Pág.${a.page + 1} · "${preview.slice(0, 40)}${preview.length > 40 ? "…" : ""}"</span>
      <button class="btn btn-danger" data-idx="${i}">✕</button>
    `;
    el.querySelector("button").addEventListener("click", () => {
      state.additions.splice(i, 1);
      renderAdditionsList();
    });
    additionsListEl.appendChild(el);
  });
}

// ── Exportar ─────────────────────────────────────────────────────────────────

exportBtn.addEventListener("click", async () => {
  if (!state.sessionId) return;

  const edits = [];
  state.pages.forEach((page) => {
    page.text_blocks.forEach((block) => {
      const el = blocksContainer.querySelector(
        `.block-item[data-page="${block.page}"][data-index="${block.block_index}"]`
      );
      if (el) {
        const textarea  = el.querySelector(".block-textarea");
        const fontSize  = parseFloat(el.querySelector(".font-size").value) || block.font_size;
        const fontColor = el.querySelector(".font-color").value || block.font_color;
        edits.push({
          ...block,
          edited_text: textarea.value,
          font_size:   fontSize,
          font_color:  fontColor,
        });
        block.edited_text = textarea.value;
        block.font_size   = fontSize;
        block.font_color  = fontColor;
      } else {
        edits.push({ ...block });
      }
    });
  });

  exportBtn.disabled  = true;
  exportBtn.innerHTML = `<div class="spinner"></div> Exportando…`;

  try {
    const res = await fetch("/api/export", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        session_id: state.sessionId,
        edits,
        additions: state.additions,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || `Erro ${res.status}`);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${state.filename.replace(".pdf", "")}_editado.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast("PDF exportado com sucesso!", "success");
  } catch (err) {
    toast(`Falha na exportação: ${err.message}`, "error", 6000);
  } finally {
    exportBtn.disabled  = false;
    exportBtn.innerHTML = `<span>⬇️</span> Exportar PDF Modificado`;
  }
});

// ── Utilitários ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
