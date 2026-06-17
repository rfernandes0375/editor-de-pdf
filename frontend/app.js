/**
 * app.js — Frontend para o WYSIWYG Editor de PDF (Continuous Scroll)
 *
 * Fluxo:
 *  1. Upload → recebe estrutura (DocumentInfo)
 *  2. Renderiza imagem de fundo de TODAS as páginas
 *  3. Sobrepõe textareas com absolute positioning em cada página
 *  4. Duplo clique na página cria novos textareas
 *  5. Exportar coleta estado de todos os textareas
 */

"use strict";

const state = {
  sessionId: null,
  filename: null,
  pages: [],
  zoom: 1.0,
  activeBlock: null, // Referência ao textarea ativo
};

const $ = (sel) => document.querySelector(sel);

// Seletores
const dropZone = $("#drop-zone");
const fileInput = $("#file-input");
const editorSection = $("#wysiwyg-editor");
const exportSection = $("#export-section");
const canvasContainer = $("#canvas-container");
const canvasWrapper = $(".canvas-wrapper");
const docName = $("#doc-name");
const zoomLevel = $("#zoom-level");
const exportBtn = $("#export-btn");

const fToolbar = $("#floating-toolbar");
const ftSize = $("#ft-size");
const ftColor = $("#ft-color");
const ftBold = $("#ft-bold");
const ftDelete = $("#ft-delete");

// Proteção contra cache de navegador
if (!canvasContainer) {
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#ff4444;color:white;font-family:sans-serif;text-align:center;padding:20px;">
      <h1>⚠️ Erro de Atualização (Cache)</h1>
      <p style="font-size:1.2rem;max-width:600px;">Seu navegador guardou uma versão antiga da página. Para usar o novo recurso de rolagem, precisamos limpar essa memória.</p>
      <br>
      <h2>Pressione as teclas <br><br><kbd style="background:#fff;color:#000;padding:10px;border-radius:8px;">Ctrl + Shift + R</kbd></h2>
      <br>
      <p>Isso forçará o navegador a baixar a versão mais recente.</p>
    </div>
  `;
  throw new Error("Cache antigo detectado: canvasContainer é null.");
}

// ── Utilitários ─────────────────────────────────────────────────────────────

function toast(message, type = "info", duration = 4000) {
  const icons = { info: "ℹ️", success: "✅", error: "❌", warn: "⚠️" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  $("#toast-container").appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Upload ──────────────────────────────────────────────────────────────────

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
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || `Erro ${res.status}`);

    state.sessionId = data.session_id;
    state.filename = data.filename;
    state.pages = data.pages;
    state.zoom = 1.0;

    renderAllPages();

    editorSection.classList.remove("hidden");
    exportSection.classList.remove("hidden");
    docName.textContent = data.filename;
    exportBtn.disabled = false;

    // Scroll para o editor
    editorSection.scrollIntoView({ behavior: 'smooth' });
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

// ── Renderização do Canvas ──────────────────────────────────────────────────

function applyZoom() {
  canvasContainer.style.transform = `scale(${state.zoom})`;
  zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  hideToolbar();
}

$("#zoom-in").addEventListener("click", () => {
  state.zoom = Math.min(state.zoom + 0.2, 3.0);
  applyZoom();
});
$("#zoom-out").addEventListener("click", () => {
  state.zoom = Math.max(state.zoom - 0.2, 0.4);
  applyZoom();
});

function renderAllPages() {
  canvasContainer.innerHTML = "";
  
  state.pages.forEach((page) => {
    const pageNum = page.page_number;
    
    // Setup do container da pagina individual
    const pageEl = document.createElement("div");
    pageEl.className = "page-container";
    pageEl.dataset.page = pageNum;
    pageEl.style.width = `${page.width}px`;
    pageEl.style.height = `${page.height}px`;

    // Imagem de fundo
    const img = document.createElement("img");
    img.className = "pdf-page-image";
    img.src = `/api/document/${state.sessionId}/page/${pageNum}/image`;
    pageEl.appendChild(img);

    // Blocos existentes
    page.text_blocks.forEach((block) => {
      createOverlayBlock(block, false, pageEl);
    });

    // Duplo clique cria bloco na pagina especifica
    pageEl.addEventListener("dblclick", (e) => {
      if (e.target.classList.contains("text-block-overlay")) return;

      const rect = pageEl.getBoundingClientRect();
      const x = (e.clientX - rect.left) / state.zoom;
      const y = (e.clientY - rect.top) / state.zoom;

      const newBlock = {
        page: pageNum,
        text: "",
        x0: x,
        y0: y,
        font_size: 12.0,
        font_color: "#ff0000",
        font_family: "helv",
      };

      createOverlayBlock(newBlock, true, pageEl);
    });

    canvasContainer.appendChild(pageEl);
  });
}

// ── Criação e controle de blocos sobrepostos ───────────────────────────────

function createOverlayBlock(block, isNew, parentContainer) {
  const el = document.createElement("textarea");
  el.className = "text-block-overlay";
  el.spellcheck = false;
  
  el.dataset.page = block.page;
  if (!isNew) {
    el.dataset.index = block.block_index;
    el.dataset.original = block.original_text;
  } else {
    el.dataset.isNew = "true";
  }
  
  el.dataset.fontFamily = block.font_family || "helv";
  el.dataset.fontSize = block.font_size;
  el.dataset.fontColor = block.font_color;
  el.dataset.x0 = block.x0;
  el.dataset.y0 = block.y0;

  el.style.left = `${block.x0}px`;
  el.style.top = `${block.y0}px`;
  
  if (isNew) {
    el.style.width = "200px";
    el.style.height = "50px";
  } else {
    el.style.width = `${(block.x1 - block.x0) + 10}px`;
    el.style.height = `${(block.y1 - block.y0) + 20}px`;
  }

  const fontMap = {
    helv: "Arial, Helvetica, sans-serif",
    tiro: "'Times New Roman', Times, serif",
    cour: "Courier, monospace"
  };
  el.style.fontFamily = fontMap[el.dataset.fontFamily] || "inherit";
  el.style.fontSize = `${block.font_size}px`;
  
  el.style.setProperty("--text-color", block.font_color);
  el.value = block.edited_text !== undefined ? block.edited_text : block.text;

  if (!isNew && el.value !== block.original_text) {
    el.classList.add("modified");
  } else if (isNew) {
    el.classList.add("modified");
  }

  el.addEventListener("input", () => {
    updateBoldPreview(el);
    if (!isNew) {
      el.classList.toggle("modified", el.value !== el.dataset.original);
    }
  });

  el.addEventListener("focus", () => {
    state.activeBlock = el;
    showToolbar(el);
  });

  el.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      wrapBold(el);
    }
  });

  updateBoldPreview(el);
  parentContainer.appendChild(el);
  
  if (isNew) {
    el.focus();
  }
}

// ── Negrito Inline ──────────────────────────────────────────────────────────

function wrapBold(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  if (start === end) {
    toast("Selecione o trecho que deseja negritar antes de usar a ferramenta.", "warn", 3500);
    return;
  }

  const text = textarea.value;
  const before = text.slice(0, start);
  const sel = text.slice(start, end);
  const after = text.slice(end);

  if (sel.startsWith("**") && sel.endsWith("**") && sel.length > 4) {
    const inner = sel.slice(2, -2);
    textarea.value = before + inner + after;
    textarea.setSelectionRange(start, start + inner.length);
  } else {
    textarea.value = before + "**" + sel + "**" + after;
    textarea.setSelectionRange(start, end + 4);
  }

  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
}

function updateBoldPreview(textarea) {
  const hasMarkers = /\*\*.+?\*\*/s.test(textarea.value);
  textarea.classList.toggle("has-bold", hasMarkers);
}

// ── Toolbar Flutuante ───────────────────────────────────────────────────────

function showToolbar(el) {
  ftSize.value = parseFloat(el.dataset.fontSize).toFixed(0);
  ftColor.value = el.dataset.fontColor;

  fToolbar.classList.remove("hidden");
  
  const wrapperRect = canvasWrapper.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  fToolbar.style.left = `${elRect.left - wrapperRect.left + canvasWrapper.scrollLeft}px`;
  fToolbar.style.top = `${elRect.top - wrapperRect.top + canvasWrapper.scrollTop - 10}px`;
}

function hideToolbar() {
  fToolbar.classList.add("hidden");
  state.activeBlock = null;
}

canvasWrapper.addEventListener("mousedown", (e) => {
  if (e.target.classList.contains("text-block-overlay")) return;
  if (fToolbar.contains(e.target)) return;
  hideToolbar();
});

ftSize.addEventListener("change", (e) => {
  if (!state.activeBlock) return;
  const size = parseFloat(e.target.value);
  state.activeBlock.dataset.fontSize = size;
  state.activeBlock.style.fontSize = `${size}px`;
});

ftColor.addEventListener("change", (e) => {
  if (!state.activeBlock) return;
  const color = e.target.value;
  state.activeBlock.dataset.fontColor = color;
  state.activeBlock.style.color = color;
});

ftBold.addEventListener("click", () => {
  if (!state.activeBlock) return;
  wrapBold(state.activeBlock);
});

ftDelete.addEventListener("click", () => {
  if (!state.activeBlock) return;
  if (state.activeBlock.dataset.isNew === "true") {
    state.activeBlock.remove();
  } else {
    state.activeBlock.value = ""; 
    state.activeBlock.style.display = "none";
    toast("Bloco de texto excluído (será removido na exportação).", "info");
  }
  hideToolbar();
});

// ── Exportação ──────────────────────────────────────────────────────────────

exportBtn.addEventListener("click", async () => {
  if (!state.sessionId) return;

  const edits = [];
  const additions = [];

  saveAllPagesDOMState();

  state.pages.forEach((page) => {
    page.text_blocks.forEach((block) => {
      edits.push(block);
    });
    if (page.additions) {
      page.additions.forEach(add => additions.push(add));
    }
  });

  exportBtn.disabled = true;
  exportBtn.innerHTML = `<div class="spinner"></div> Exportando…`;

  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.sessionId,
        edits,
        additions,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || `Erro ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.filename.replace(".pdf", "")}_editado.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast("PDF exportado com sucesso!", "success");
  } catch (err) {
    toast(`Falha na exportação: ${err.message}`, "error", 6000);
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = `<span>⬇️</span> Exportar PDF Modificado`;
  }
});

function saveAllPagesDOMState() {
  state.pages.forEach(p => p.additions = []);

  const textareas = canvasContainer.querySelectorAll(".text-block-overlay");
  textareas.forEach(ta => {
    const pageNum = parseInt(ta.dataset.page, 10);
    const page = state.pages.find((p) => p.page_number === pageNum);
    if (!page) return;

    const val = ta.value.trim();
    if (ta.dataset.isNew === "true") {
      if (val !== "") {
        page.additions.push({
          page: pageNum,
          text: val,
          x: parseFloat(ta.dataset.x0),
          y: parseFloat(ta.dataset.y0),
          font_size: parseFloat(ta.dataset.fontSize),
          font_color: ta.dataset.fontColor,
          font_family: ta.dataset.fontFamily
        });
      }
    } else {
      const idx = parseInt(ta.dataset.index, 10);
      const originalBlock = page.text_blocks.find(b => b.block_index === idx);
      if (originalBlock) {
        originalBlock.edited_text = ta.value;
        originalBlock.font_size = parseFloat(ta.dataset.fontSize);
        originalBlock.font_color = ta.dataset.fontColor;
      }
    }
  });
}
