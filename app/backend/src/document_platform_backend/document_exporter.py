from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence
from xml.etree.ElementTree import Element, SubElement, tostring

from .models import (
    ExportArtifact,
    ExportDocumentRequest,
    ExportFieldMapping,
    ExportResult,
    NormalizedDocument,
    NormalizedTable,
)

MEDIA_TYPES = {
    "csv": "text/csv",
    "json": "application/json",
    "xml": "application/xml",
}

FILE_EXTENSIONS = {
    "csv": ".csv",
    "json": ".json",
    "xml": ".xml",
}


def export_document(
    normalized_document: NormalizedDocument,
    request: ExportDocumentRequest,
) -> ExportResult:
    warnings: List[str] = list(normalized_document.warnings)
    if request.format == "csv" and len(request.delimiter or ",") != 1:
        raise ValueError("CSV delimiter must be a single character.")

    selected_tables = _select_tables(normalized_document, request.table_ids)

    if request.table_ids:
        found_table_ids = {table.id for table in selected_tables}
        missing_ids = sorted(set(request.table_ids) - found_table_ids)
        if missing_ids:
            warnings.append("Requested table ids were not found: " + ", ".join(missing_ids))

    if request.output_mode == "per-table":
        artifacts = _export_per_table(normalized_document, selected_tables, request)
    else:
        artifacts = [_export_single_file(normalized_document, selected_tables, request)]

    output_path = Path(request.output_path).expanduser() if request.output_path else None
    if output_path is not None:
        _write_artifacts(artifacts, output_path, request)

    return ExportResult(
        document_id=normalized_document.document_id,
        source_name=normalized_document.source_name,
        format=request.format,
        exported_at=datetime.now(timezone.utc),
        artifact_count=len(artifacts),
        artifacts=artifacts,
        warnings=warnings,
    )


def _select_tables(
    normalized_document: NormalizedDocument,
    table_ids: Sequence[str],
) -> List[NormalizedTable]:
    selected_tables: List[NormalizedTable] = []
    selected_id_set = set(table_ids)

    for sheet in normalized_document.sheets:
        for table in sheet.tables:
            if selected_id_set and table.id not in selected_id_set:
                continue
            selected_tables.append(table)

    return selected_tables


def _export_single_file(
    normalized_document: NormalizedDocument,
    tables: Sequence[NormalizedTable],
    request: ExportDocumentRequest,
) -> ExportArtifact:
    flattened_records: List[Dict[str, object]] = []
    for table in tables:
        flattened_records.extend(_table_records_to_dicts(table, request))

    file_name = _sanitize_name(Path(normalized_document.source_name).stem) + FILE_EXTENSIONS[request.format]
    content = _serialize_records(flattened_records, request)

    return ExportArtifact(
        file_name=file_name,
        media_type=MEDIA_TYPES[request.format],
        content=content,
        record_count=len(flattened_records),
    )


def _export_per_table(
    normalized_document: NormalizedDocument,
    tables: Sequence[NormalizedTable],
    request: ExportDocumentRequest,
) -> List[ExportArtifact]:
    artifacts: List[ExportArtifact] = []
    base_stem = _sanitize_name(Path(normalized_document.source_name).stem)

    for index, table in enumerate(tables, start=1):
        rows = _table_records_to_dicts(table, request)
        table_name = _sanitize_name(table.title or table.id)
        file_name = f"{base_stem}_{index:02d}_{table_name}{FILE_EXTENSIONS[request.format]}"
        artifacts.append(
            ExportArtifact(
                file_name=file_name,
                media_type=MEDIA_TYPES[request.format],
                content=_serialize_records(rows, request),
                record_count=len(rows),
                table_id=table.id,
            )
        )

    return artifacts


def _table_records_to_dicts(
    table: NormalizedTable,
    request: ExportDocumentRequest,
) -> List[Dict[str, object]]:
    records: List[Dict[str, object]] = []
    field_order = [field.key for field in table.fields]

    for record in table.records:
        value_map = {value.field_key: value for value in record.values}
        exported: Dict[str, object] = {}

        if request.mappings:
            for mapping in request.mappings:
                exported[mapping.target_field] = _mapped_value(mapping, value_map)
        else:
            for field_key in field_order:
                value = value_map.get(field_key)
                exported[field_key] = value.value if value else None

        if request.include_metadata:
            exported["__sheetName"] = table.sheet_name
            exported["__tableId"] = table.id
            exported["__rowIndex"] = record.row_index

        records.append(exported)

    return records


def _mapped_value(mapping: ExportFieldMapping, value_map) -> object:
    value = None
    if mapping.source_field_key:
        source = value_map.get(mapping.source_field_key)
        value = source.value if source else None

    if value is None:
        value = mapping.default_value

    return _apply_transform(value, mapping.transform or "none")


def _apply_transform(value: object, transform: str) -> object:
    if value is None:
        return None

    if transform == "string":
        return str(value)
    if transform == "upper":
        return str(value).upper()
    if transform == "lower":
        return str(value).lower()
    return value


def _serialize_records(records: Sequence[Dict[str, object]], request: ExportDocumentRequest) -> str:
    if request.format == "csv":
        return _serialize_csv(records, request.delimiter)
    if request.format == "json":
        return json.dumps(list(records), indent=2, ensure_ascii=True, default=str)
    if request.format == "xml":
        return _serialize_xml(records, request.xml_root_element, request.xml_record_element)
    raise ValueError(f"Unsupported export format: {request.format}")


def _serialize_csv(records: Sequence[Dict[str, object]], delimiter: str) -> str:
    output = StringIO()
    fieldnames = _ordered_fieldnames(records)
    writer = csv.DictWriter(output, fieldnames=fieldnames, delimiter=delimiter or ",")
    writer.writeheader()
    for record in records:
        writer.writerow({field: _scalar_to_text(record.get(field)) for field in fieldnames})
    return output.getvalue()


def _serialize_xml(
    records: Sequence[Dict[str, object]],
    root_element: str,
    record_element: str,
) -> str:
    root = Element(_xml_safe_tag(root_element))
    for record in records:
        record_node = SubElement(root, _xml_safe_tag(record_element))
        for key, value in record.items():
            field_node = SubElement(record_node, _xml_safe_tag(key))
            field_node.text = _scalar_to_text(value)
    return tostring(root, encoding="unicode")


def _ordered_fieldnames(records: Sequence[Dict[str, object]]) -> List[str]:
    fieldnames: List[str] = []
    for record in records:
        for field in record.keys():
            if field not in fieldnames:
                fieldnames.append(field)
    return fieldnames


def _scalar_to_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _write_artifacts(
    artifacts: Sequence[ExportArtifact],
    output_path: Path,
    request: ExportDocumentRequest,
) -> None:
    if request.output_mode == "single-file":
        target_file = output_path
        if target_file.suffix.lower() != FILE_EXTENSIONS[request.format]:
            target_file = target_file.with_suffix(FILE_EXTENSIONS[request.format])
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_text(artifacts[0].content, encoding="utf-8")
        artifacts[0].target_path = str(target_file.resolve())
        return

    output_directory = output_path
    if output_directory.suffix:
        output_directory = output_directory.parent / output_directory.stem
    output_directory.mkdir(parents=True, exist_ok=True)

    for artifact in artifacts:
        artifact_path = output_directory / artifact.file_name
        artifact_path.write_text(artifact.content, encoding="utf-8")
        artifact.target_path = str(artifact_path.resolve())


def _sanitize_name(name: str) -> str:
    sanitized = "".join(character if character.isalnum() or character in {"-", "_"} else "_" for character in name)
    sanitized = sanitized.strip("_")
    return sanitized or "export"


def _xml_safe_tag(tag: object) -> str:
    text = str(tag).strip() or "field"
    safe = "".join(character if character.isalnum() or character in {"_", "-"} else "_" for character in text)
    if safe and safe[0].isdigit():
        safe = f"field_{safe}"
    return safe or "field"
