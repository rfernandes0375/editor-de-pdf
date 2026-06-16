"""
Modelos Pydantic usados nos endpoints da API.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class TextBlock(BaseModel):
    """Bloco de texto já existente extraído do PDF."""

    page: int = Field(..., description="Número da página (0-indexado)")
    block_index: int = Field(..., description="Índice do bloco na página")
    original_text: str = Field(..., description="Texto original do bloco")
    edited_text: str = Field(..., description="Texto editado pelo usuário")
    x0: float = Field(..., description="Coordenada X esquerda do bloco")
    y0: float = Field(..., description="Coordenada Y topo do bloco")
    x1: float = Field(..., description="Coordenada X direita do bloco")
    y1: float = Field(..., description="Coordenada Y base do bloco")
    font_size: float = Field(12.0, description="Tamanho da fonte")
    font_color: str = Field("#000000", description="Cor da fonte em hex")
    font_family: str = Field("helv", description="Nome base14 da fonte detectada no PDF original")
    # Negrito inline: envolva trechos em **marcadores** no texto editado.


class NewTextBlock(BaseModel):
    """Novo bloco de texto a ser inserido no PDF."""

    page: int = Field(..., description="Número da página (0-indexado)")
    text: str = Field(..., min_length=1, description="Texto a inserir")
    x: float = Field(..., description="Coordenada X de inserção")
    y: float = Field(..., description="Coordenada Y de inserção")
    font_size: float = Field(12.0, ge=4.0, le=144.0, description="Tamanho da fonte")
    font_color: str = Field("#000000", description="Cor da fonte em hex (#rrggbb)")
    font_family: str = Field("helv", description="Nome base14 da fonte para inserção")
    # Negrito inline: envolva trechos em **marcadores** no texto.


class ExportRequest(BaseModel):
    """Payload enviado pelo cliente para exportar o PDF modificado."""

    session_id: str = Field(..., description="ID da sessão de edição")
    edits: List[TextBlock] = Field(
        default_factory=list,
        description="Blocos de texto existentes com edições",
    )
    additions: List[NewTextBlock] = Field(
        default_factory=list,
        description="Novos blocos de texto a inserir",
    )


class PageInfo(BaseModel):
    """Informações de uma página do PDF."""

    page_number: int
    width: float
    height: float
    text_blocks: List[TextBlock]


class DocumentInfo(BaseModel):
    """Metadados e conteúdo extraído do PDF."""

    session_id: str
    filename: str
    page_count: int
    pages: List[PageInfo]
