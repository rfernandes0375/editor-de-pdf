"""
Configurações centralizadas lidas via variáveis de ambiente.
"""

import os
from pathlib import Path

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/tmp/pdf_uploads"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/tmp/pdf_outputs"))
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
ALLOWED_CONTENT_TYPE = "application/pdf"

# Garante que os diretórios existam
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
