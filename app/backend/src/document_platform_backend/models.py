from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(field_name: str) -> str:
    parts = field_name.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


class AppModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )


class Capability(AppModel):
    id: str
    description: str


class ServiceStatus(AppModel):
    name: str
    version: str
    started_at: datetime
    capabilities: List[Capability] = Field(default_factory=list)


class PluginLoadIssue(AppModel):
    manifest_path: str
    severity: Literal["warning", "error"]
    message: str
    plugin_id: Optional[str] = None


class PluginSummary(AppModel):
    plugin_id: str
    name: str
    version: str
    api_version: str
    enabled: bool
    capabilities: List[str] = Field(default_factory=list)
    permissions: List[str] = Field(default_factory=list)
    supported_formats: List[str] = Field(default_factory=list)
    entry_point: str
    manifest_path: str


class PluginListResponse(AppModel):
    plugin_root: str
    items: List[PluginSummary] = Field(default_factory=list)
    issues: List[PluginLoadIssue] = Field(default_factory=list)


class ParseDocumentRequest(AppModel):
    document_path: str
    sheet_names: List[str] = Field(default_factory=list)
    max_rows_per_sheet: int = Field(default=200, ge=1, le=2000)
    max_columns_per_sheet: int = Field(default=50, ge=1, le=200)
    max_tables_per_sheet: int = Field(default=12, ge=1, le=100)
    include_hidden_sheets: bool = True


class NormalizeDocumentRequest(ParseDocumentRequest):
    include_empty_records: bool = False
    prefer_first_row_as_header: bool = False


class ValidateDocumentRequest(NormalizeDocumentRequest):
    required_field_keys: List[str] = Field(default_factory=list)
    unique_field_sets: List[List[str]] = Field(default_factory=list)
    detect_type_mismatches: bool = True
    enforce_non_empty_tables: bool = True
    detect_outline_groups: bool = True
    detect_color_formatting: bool = True


class ExportFieldMapping(AppModel):
    target_field: str
    source_field_key: Optional[str] = None
    default_value: Optional[Union[str, int, float, bool]] = None
    transform: Optional[Literal["none", "string", "upper", "lower"]] = "none"


class ExportDocumentRequest(NormalizeDocumentRequest):
    format: Literal["csv", "json", "xml"]
    output_mode: Literal["single-file", "per-table"] = "single-file"
    table_ids: List[str] = Field(default_factory=list)
    include_metadata: bool = True
    delimiter: str = ","
    output_path: Optional[str] = None
    mappings: List[ExportFieldMapping] = Field(default_factory=list)
    xml_root_element: str = "records"
    xml_record_element: str = "record"


class CellPreview(AppModel):
    address: str
    value: Optional[Union[str, int, float, bool]] = None
    formula: Optional[str] = None
    data_type: Optional[str] = None
    comment: Optional[str] = None
    is_merged: bool = False
    merge_parent: Optional[str] = None
    merge_range: Optional[str] = None
    row_outline_level: int = 0
    column_outline_level: int = 0
    row_hidden: bool = False
    column_hidden: bool = False
    fill_color: Optional[str] = None
    font_color: Optional[str] = None


class TablePreview(AppModel):
    id: str
    title: Optional[str] = None
    range: str
    row_count: int
    column_count: int
    non_empty_cell_count: int
    header_row_index: Optional[int] = None
    rows: List[List[CellPreview]] = Field(default_factory=list)


class SheetPreview(AppModel):
    id: str
    name: str
    hidden: bool
    used_range: str
    row_count: int
    column_count: int
    merged_ranges: List[str] = Field(default_factory=list)
    truncated: bool = False
    tables: List[TablePreview] = Field(default_factory=list)


class WorkbookPreview(AppModel):
    document_id: str
    source_name: str
    source_path: str
    source_size_bytes: int
    sheet_count: int
    imported_at: datetime
    sheets: List[SheetPreview] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class NormalizedField(AppModel):
    key: str
    label: str
    column_index: int
    source_address: str
    data_type: Optional[str] = None


class NormalizedValue(AppModel):
    field_key: str
    label: str
    value: Optional[Union[str, int, float, bool]] = None
    source_address: str
    data_type: Optional[str] = None
    formula: Optional[str] = None
    is_merged: bool = False
    merge_parent: Optional[str] = None
    merge_range: Optional[str] = None
    row_outline_level: int = 0
    column_outline_level: int = 0
    row_hidden: bool = False
    column_hidden: bool = False
    fill_color: Optional[str] = None
    font_color: Optional[str] = None


class NormalizedRecord(AppModel):
    row_index: int
    values: List[NormalizedValue] = Field(default_factory=list)


class NormalizedTable(AppModel):
    id: str
    title: Optional[str] = None
    range: str
    sheet_name: str
    header_row_index: Optional[int] = None
    fields: List[NormalizedField] = Field(default_factory=list)
    records: List[NormalizedRecord] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class NormalizedSheet(AppModel):
    id: str
    name: str
    hidden: bool
    tables: List[NormalizedTable] = Field(default_factory=list)


class NormalizedDocument(AppModel):
    document_id: str
    source_name: str
    source_path: str
    sheet_count: int
    imported_at: datetime
    normalized_at: datetime
    sheets: List[NormalizedSheet] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ValidationFinding(AppModel):
    id: str
    severity: str
    code: str
    message: str
    sheet_name: Optional[str] = None
    table_id: Optional[str] = None
    row_index: Optional[int] = None
    field_key: Optional[str] = None
    cell_address: Optional[str] = None
    rule_id: Optional[str] = None


class ValidationSummary(AppModel):
    info_count: int = 0
    warning_count: int = 0
    error_count: int = 0
    critical_count: int = 0


class ValidationResult(AppModel):
    document_id: str
    source_name: str
    validated_at: datetime
    summary: ValidationSummary
    findings: List[ValidationFinding] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ChangeLogRecord(AppModel):
    generated_at: datetime
    document_id: str
    source_name: str
    source_path: str
    change_type: Literal["added", "removed", "modified"]
    sheet_name: str
    table_id: str
    row_index: int
    field_key: str
    label: str
    source_address: str
    old_value: Optional[Union[str, int, float, bool]] = None
    new_value: Optional[Union[str, int, float, bool]] = None


class ChangeLogRequest(AppModel):
    changes: List[ChangeLogRecord] = Field(default_factory=list)


class ChangeLogResponse(AppModel):
    log_path: str
    written_count: int


class ExportArtifact(AppModel):
    file_name: str
    media_type: str
    content: str
    record_count: int
    table_id: Optional[str] = None
    target_path: Optional[str] = None


class ExportResult(AppModel):
    document_id: str
    source_name: str
    format: str
    exported_at: datetime
    artifact_count: int
    artifacts: List[ExportArtifact] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
