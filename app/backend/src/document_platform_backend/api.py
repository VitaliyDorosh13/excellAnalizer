from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .change_logger import append_change_log
from .document_exporter import export_document
from .document_normalizer import normalize_workbook
from .document_validator import validate_document
from .models import (
    Capability,
    ChangeLogRequest,
    ChangeLogResponse,
    ExportDocumentRequest,
    ExportResult,
    NormalizedDocument,
    NormalizeDocumentRequest,
    ParseDocumentRequest,
    PluginListResponse,
    ServiceStatus,
    ValidateDocumentRequest,
    ValidationResult,
    WorkbookPreview,
)
from .plugin_registry import discover_plugins
from .workbook_parser import (
    ParserDependencyError,
    WorkbookParserError,
    preview_workbook,
)

app = FastAPI(title="Document Analysis Platform Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "tauri://localhost",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
STARTED_AT = datetime.now(timezone.utc)
PROJECT_ROOT = Path(__file__).resolve().parents[4]
PLUGIN_ROOT = PROJECT_ROOT / "plugins"
CHANGE_LOG_PATH = PROJECT_ROOT / "tmp" / "document-change-log.jsonl"


@app.get("/health", response_model=ServiceStatus)
def health() -> ServiceStatus:
    return ServiceStatus(
        name="document-platform-backend",
        version="0.1.0",
        started_at=STARTED_AT,
        capabilities=[
            Capability(id="excel-import", description="Workbook ingestion scaffold"),
            Capability(id="export-engine", description="CSV/JSON/XML export engine v1"),
            Capability(id="validation-engine", description="Rule-based validation engine v1"),
            Capability(id="plugin-manager", description="Plugin discovery scaffold"),
        ],
    )


@app.get("/plugins", response_model=PluginListResponse)
def plugins() -> PluginListResponse:
    return discover_plugins(PLUGIN_ROOT)


@app.post("/changes/log", response_model=ChangeLogResponse)
def changes_log(request: ChangeLogRequest) -> ChangeLogResponse:
    written_count = append_change_log(CHANGE_LOG_PATH, request.changes)
    return ChangeLogResponse(log_path=str(CHANGE_LOG_PATH), written_count=written_count)


@app.post("/documents/preview", response_model=WorkbookPreview)
def document_preview(request: ParseDocumentRequest) -> WorkbookPreview:
    try:
        return preview_workbook(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ParserDependencyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WorkbookParserError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/documents/normalize", response_model=NormalizedDocument)
def document_normalize(request: NormalizeDocumentRequest) -> NormalizedDocument:
    try:
        workbook_preview = preview_workbook(request)
        return normalize_workbook(workbook_preview, request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ParserDependencyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WorkbookParserError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/documents/validate", response_model=ValidationResult)
def document_validate(request: ValidateDocumentRequest) -> ValidationResult:
    try:
        workbook_preview = preview_workbook(request)
        normalized_document = normalize_workbook(workbook_preview, request)
        return validate_document(normalized_document, request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ParserDependencyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WorkbookParserError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/documents/export", response_model=ExportResult)
def document_export(request: ExportDocumentRequest) -> ExportResult:
    try:
        workbook_preview = preview_workbook(request)
        normalized_document = normalize_workbook(workbook_preview, request)
        return export_document(normalized_document, request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ParserDependencyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except WorkbookParserError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
