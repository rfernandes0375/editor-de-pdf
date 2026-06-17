"""
Ponto de entrada da aplicação FastAPI.
Monta o frontend estático e registra os routers da API.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.router import router

# ── aplicação ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Editor de PDF Rodrigo Ferreira",
    description="API para upload, edição e exportação de documentos PDF.",
    version="1.0.0",
)

# Permite requisições do mesmo host (frontend servido pelo mesmo servidor)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registra as rotas REST
app.include_router(router)

# Serve o frontend estático em /
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
