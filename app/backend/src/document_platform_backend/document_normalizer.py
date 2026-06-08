from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone
from typing import List, Optional

from .models import (
    CellPreview,
    NormalizedDocument,
    NormalizedField,
    NormalizedRecord,
    NormalizedSheet,
    NormalizedTable,
    NormalizedValue,
    NormalizeDocumentRequest,
    TablePreview,
    WorkbookPreview,
)


def normalize_workbook(
    workbook_preview: WorkbookPreview,
    request: NormalizeDocumentRequest,
) -> NormalizedDocument:
    document_warnings: List[str] = list(workbook_preview.warnings)
    normalized_sheets: List[NormalizedSheet] = []

    for sheet in workbook_preview.sheets:
        normalized_tables: List[NormalizedTable] = []
        for table in sheet.tables:
            normalized_tables.append(_normalize_table(sheet.name, table, request))

        normalized_sheets.append(
            NormalizedSheet(
                id=sheet.id,
                name=sheet.name,
                hidden=sheet.hidden,
                tables=normalized_tables,
            )
        )

    return NormalizedDocument(
        document_id=workbook_preview.document_id,
        source_name=workbook_preview.source_name,
        source_path=workbook_preview.source_path,
        sheet_count=workbook_preview.sheet_count,
        imported_at=workbook_preview.imported_at,
        normalized_at=datetime.now(timezone.utc),
        sheets=normalized_sheets,
        warnings=document_warnings,
    )


def _normalize_table(
    sheet_name: str,
    table: TablePreview,
    request: NormalizeDocumentRequest,
) -> NormalizedTable:
    warnings: List[str] = []
    header_row_offset = _select_header_row_offset(table, request)
    actual_header_row_index = None

    if header_row_offset is None:
        warnings.append("No suitable header row detected. Column keys were generated automatically.")
    else:
        actual_header_row_index = _range_start_row(table.range) + header_row_offset

    data_rows = _data_rows(table, header_row_offset)
    header_cells = _header_cells(table, header_row_offset)
    fields = _build_fields(header_cells, warnings)
    records = _build_records(
        table=table,
        data_rows=data_rows,
        fields=fields,
        include_empty_records=request.include_empty_records,
    )

    if not records:
        warnings.append("No non-empty data records were produced from this table.")

    return NormalizedTable(
        id=table.id,
        title=table.title,
        range=table.range,
        sheet_name=sheet_name,
        header_row_index=actual_header_row_index,
        fields=fields,
        records=records,
        warnings=warnings,
    )


def _select_header_row_offset(
    table: TablePreview,
    request: NormalizeDocumentRequest,
) -> Optional[int]:
    if not table.rows:
        return None

    if request.prefer_first_row_as_header:
        return 0

    if table.header_row_index is not None:
        offset = table.header_row_index - _range_start_row(table.range)
        if 0 <= offset < len(table.rows):
            return offset

    for offset, row in enumerate(table.rows):
        if _looks_like_header_row(row):
            return offset

    return 0 if table.rows else None


def _data_rows(table: TablePreview, header_row_offset: Optional[int]) -> List[tuple[int, List[CellPreview]]]:
    if not table.rows:
        return []

    start_row = _range_start_row(table.range)
    first_data_offset = (header_row_offset + 1) if header_row_offset is not None else 0

    data_rows: List[tuple[int, List[CellPreview]]] = []
    for offset, row in enumerate(table.rows[first_data_offset:], start=first_data_offset):
        data_rows.append((start_row + offset, row))

    return data_rows


def _header_cells(table: TablePreview, header_row_offset: Optional[int]) -> List[Optional[CellPreview]]:
    if not table.rows:
        return []

    if header_row_offset is None or header_row_offset >= len(table.rows):
        return [None for _ in table.rows[0]]

    return list(table.rows[header_row_offset])


def _build_fields(
    header_cells: List[Optional[CellPreview]],
    warnings: List[str],
) -> List[NormalizedField]:
    generated_keys: List[str] = []
    labels: List[str] = []

    for index, cell in enumerate(header_cells, start=1):
        label = _header_label(cell, index)
        labels.append(label)
        generated_keys.append(_field_key(label, index))

    duplicates = [label for label, count in Counter(generated_keys).items() if count > 1]
    if duplicates:
        warnings.append(
            "Duplicate header keys were detected and disambiguated: " + ", ".join(sorted(duplicates))
        )

    unique_keys = _deduplicate_keys(generated_keys)
    fields: List[NormalizedField] = []

    for index, cell in enumerate(header_cells, start=1):
        source_address = cell.address if cell else _column_address(index, 1)
        data_type = cell.data_type if cell else None
        fields.append(
            NormalizedField(
                key=unique_keys[index - 1],
                label=labels[index - 1],
                column_index=index,
                source_address=source_address,
                data_type=data_type,
            )
        )

    return fields


def _build_records(
    table: TablePreview,
    data_rows: List[tuple[int, List[CellPreview]]],
    fields: List[NormalizedField],
    include_empty_records: bool,
) -> List[NormalizedRecord]:
    records: List[NormalizedRecord] = []

    for row_index, row in data_rows:
        values: List[NormalizedValue] = []
        has_meaningful_content = False

        for column_offset, field in enumerate(fields):
            cell = row[column_offset] if column_offset < len(row) else None
            cell_value = cell.value if cell else None
            if _has_meaningful_value(cell_value):
                has_meaningful_content = True

            values.append(
                NormalizedValue(
                    field_key=field.key,
                    label=field.label,
                    value=cell_value,
                    source_address=cell.address if cell else _column_address(column_offset + 1, row_index),
                    data_type=cell.data_type if cell else None,
                    formula=cell.formula if cell else None,
                    is_merged=cell.is_merged if cell else False,
                    merge_parent=cell.merge_parent if cell else None,
                    merge_range=cell.merge_range if cell else None,
                    row_outline_level=cell.row_outline_level if cell else 0,
                    column_outline_level=cell.column_outline_level if cell else 0,
                    row_hidden=cell.row_hidden if cell else False,
                    column_hidden=cell.column_hidden if cell else False,
                    fill_color=cell.fill_color if cell else None,
                    font_color=cell.font_color if cell else None,
                )
            )

        if has_meaningful_content or include_empty_records:
            records.append(NormalizedRecord(row_index=row_index, values=values))

    return records


def _header_label(cell: Optional[CellPreview], column_index: int) -> str:
    if cell and _has_meaningful_value(cell.value):
        return str(cell.value).strip()

    return f"Column {column_index}"


def _field_key(label: str, column_index: int) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", label.strip().lower()).strip("_")
    if not normalized:
        normalized = f"column_{column_index}"

    if normalized[0].isdigit():
        normalized = f"column_{normalized}"

    return normalized


def _deduplicate_keys(keys: List[str]) -> List[str]:
    counts: Counter[str] = Counter()
    unique_keys: List[str] = []

    for key in keys:
        counts[key] += 1
        if counts[key] == 1:
            unique_keys.append(key)
        else:
            unique_keys.append(f"{key}_{counts[key]}")

    return unique_keys


def _looks_like_header_row(row: List[CellPreview]) -> bool:
    populated_values_by_source: dict[str, str] = {}
    for cell in row:
        if not _has_meaningful_value(cell.value):
            continue

        source_address = cell.merge_parent or cell.address
        populated_values_by_source[source_address] = str(cell.value).strip()

    populated_values = list(populated_values_by_source.values())
    if not populated_values:
        return False

    if len(populated_values) == 1 and len(row) > 1:
        return False

    alpha_like_count = sum(
        1
        for value in populated_values
        if any(character.isalpha() for character in value)
    )
    return alpha_like_count >= max(1, len(populated_values) // 2)


def _range_start_row(table_range: str) -> int:
    if ":" not in table_range:
        return 1

    start_cell = table_range.split(":", 1)[0]
    digits = "".join(character for character in start_cell if character.isdigit())
    return int(digits) if digits else 1


def _column_address(column_index: int, row_index: int) -> str:
    name = ""
    current = column_index

    while current > 0:
        current, remainder = divmod(current - 1, 26)
        name = chr(65 + remainder) + name

    return f"{name}{row_index}"


def _has_meaningful_value(value: object) -> bool:
    if value is None:
        return False

    if isinstance(value, str):
        return value.strip() != ""

    return True
