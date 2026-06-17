# 📝 Editor de PDF Rodrigo Ferreira

Ferramenta interna para upload, edição e exportação de documentos PDF.  
Roda **100% localmente** — sem dados saindo do seu ambiente.

---

## 🏗️ Estrutura de Diretórios

```
EDITORDEPDF/
├── backend/
│   ├── __init__.py       # Package marker
│   ├── config.py         # Variáveis de ambiente e configurações
│   ├── schemas.py        # Modelos Pydantic (request/response)
│   ├── pdf_service.py    # Toda a lógica PyMuPDF (extração + edição)
│   ├── router.py         # Endpoints FastAPI (/api/upload, /api/export)
│   └── main.py           # Ponto de entrada, CORS, static files
├── frontend/
│   ├── index.html        # Interface principal
│   ├── style.css         # Estilos (dark mode, animações)
│   └── app.js            # Lógica do frontend (upload, edição, export)
├── Dockerfile            # Build multi-stage otimizado
├── docker-compose.yml    # Orquestração com volumes persistentes
├── .dockerignore
├── requirements.txt
└── README.md
```

---

## 🚀 Execução Rápida (Docker — recomendado)

### Pré-requisitos
- Docker Desktop instalado e rodando.

### 1. Build e start

```bash
docker compose up --build
```

A primeira build leva ~2–4 minutos (instalação do PyMuPDF).
Builds subsequentes são rápidas graças ao cache de camadas.

### 2. Acessar a aplicação

Abra o navegador em: **http://localhost:8000**

### 3. Parar

```bash
docker compose down
```

---

## 🖥️ Execução Local (sem Docker)

### Pré-requisitos
- Python 3.10+ e pip

```bash
# 1. Criar ambiente virtual
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux/macOS

# 2. Instalar dependências
pip install -r requirements.txt

# 3. Iniciar o servidor
uvicorn backend.main:app --reload --port 8000
```

Acesse: **http://localhost:8000**

---

## ⚙️ Variáveis de Ambiente

| Variável           | Padrão              | Descrição                          |
|--------------------|---------------------|------------------------------------|
| UPLOAD_DIR         | /tmp/pdf_uploads    | Diretório para PDFs enviados       |
| OUTPUT_DIR         | /tmp/pdf_outputs    | Diretório para PDFs exportados     |
| MAX_FILE_SIZE_MB   | 50                  | Tamanho máximo de arquivo em MB    |

---

## 📋 Funcionalidades

| Funcionalidade               | Descrição                                              |
|------------------------------|--------------------------------------------------------|
| Upload com drag-and-drop     | Arraste ou clique para selecionar um PDF               |
| Extração de texto            | Todos os blocos extraídos com coordenadas              |
| Edição inline                | Edite o conteúdo de cada bloco diretamente             |
| Controle de fonte            | Ajuste tamanho e cor de cada bloco individualmente     |
| Restaurar original           | Reverte qualquer bloco à versão original               |
| Novos blocos de texto        | Adicione texto em qualquer posição e página            |
| Exportação                   | Download automático do PDF modificado                  |
| Validação de erros           | Feedbacks claros para arquivos inválidos               |

---

## 🔌 API Endpoints

| Método | Rota          | Descrição                             |
|--------|---------------|---------------------------------------|
| POST   | /api/upload   | Envia PDF e retorna blocos extraídos  |
| POST   | /api/export   | Aplica edições e retorna PDF baixável |
| GET    | /api/health   | Health check                          |
| GET    | /docs         | Documentação Swagger interativa       |

---

## 🛠️ Troubleshooting

**Porta 8000 ocupada?**
Edite o docker-compose.yml: `ports: "9000:8000"`

**PDF não abre?**
Verifique se o arquivo não está protegido por senha.

**Texto não aparece?**
PDFs baseados em imagem (scaneados) não contêm texto extraível.
