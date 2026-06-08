from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .models import (
    NormalizedDocument,
    NormalizedRecord,
    NormalizedTable,
    NormalizedValue,
    ValidateDocumentRequest,
    ValidationFinding,
    ValidationResult,
    ValidationSummary,
)

SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_ERROR = "error"
SEVERITY_CRITICAL = "critical"


def validate_document(
    normalized_document: NormalizedDocument,
    request: ValidateDocumentRequest,
) -> ValidationResult:
    findings: List[ValidationFinding] = []
    warnings: List[str] = list(normalized_document.warnings)

    for sheet in normalized_document.sheets:
        for table in sheet.tables:
            findings.extend(_validate_table_structure(table, sheet.name, request))
            findings.extend(_validate_required_fields(table, sheet.name, request.required_field_keys))
            findings.extend(_validate_unique_field_sets(table, sheet.name, request.unique_field_sets))
            if request.detect_type_mismatches:
                findings.extend(_validate_type_consistency(table, sheet.name))
            if request.detect_outline_groups:
                findings.extend(_validate_outline_grouping(table, sheet.name))
            if request.detect_color_formatting:
                findings.extend(_validate_color_formatting(table, sheet.name))

    summary = _build_summary(findings)
    return ValidationResult(
        document_id=normalized_document.document_id,
        source_name=normalized_document.source_name,
        validated_at=datetime.now(timezone.utc),
        summary=summary,
        findings=findings,
        warnings=warnings,
    )


def _validate_table_structure(
    table: NormalizedTable,
    sheet_name: str,
    request: ValidateDocumentRequest,
) -> List[ValidationFinding]:
    findings: List[ValidationFinding] = []

    if not table.fields:
        findings.append(
            _finding(
                severity=SEVERITY_ERROR,
                code="table.no_fields",
                message="Table has no normalized fields and cannot be validated reliably.",
                sheet_name=sheet_name,
                table_id=table.id,
                rule_id="table-structure",
            )
        )

    if request.enforce_non_empty_tables and not table.records:
        findings.append(
            _finding(
                severity=SEVERITY_WARNING,
                code="table.no_records",
                message="Table produced no data records after normalization.",
                sheet_name=sheet_name,
                table_id=table.id,
                rule_id="table-structure",
            )
        )

    return findings


def _validate_required_fields(
    table: NormalizedTable,
    sheet_name: str,
    required_field_keys: Sequence[str],
) -> List[ValidationFinding]:
    if not required_field_keys:
        return []

    findings: List[ValidationFinding] = []
    table_field_keys = {field.key for field in table.fields}

    for field_key in required_field_keys:
        if field_key not in table_field_keys:
            findings.append(
                _finding(
                    severity=SEVERITY_ERROR,
                    code="field.missing_required_column",
                    message=f"Required field '{field_key}' is missing from the table.",
                    sheet_name=sheet_name,
                    table_id=table.id,
                    field_key=field_key,
                    rule_id="required-fields",
                )
            )
            continue

        for record in table.records:
            value = _find_record_value(record, field_key)
            if value is None or not _has_meaningful_value(value.value):
                findings.append(
                    _finding(
                        severity=SEVERITY_ERROR,
                        code="field.required_value_missing",
                        message=f"Required field '{field_key}' is empty.",
                        sheet_name=sheet_name,
                        table_id=table.id,
                        row_index=record.row_index,
                        field_key=field_key,
                        cell_address=value.source_address if value else None,
                        rule_id="required-fields",
                    )
                )

    return findings


def _validate_unique_field_sets(
    table: NormalizedTable,
    sheet_name: str,
    unique_field_sets: Sequence[Sequence[str]],
) -> List[ValidationFinding]:
    findings: List[ValidationFinding] = []
    if not unique_field_sets:
        unique_field_sets = _default_unique_field_sets(table)

    available_fields = {field.key for field in table.fields}

    for field_set in unique_field_sets:
        if not field_set:
            continue

        missing_fields = [field_key for field_key in field_set if field_key not in available_fields]
        if missing_fields:
            findings.append(
                _finding(
                    severity=SEVERITY_WARNING,
                    code="field.unique_set_missing_columns",
                    message=(
                        "Unique key set skipped because fields are missing: "
                        + ", ".join(missing_fields)
                    ),
                    sheet_name=sheet_name,
                    table_id=table.id,
                    rule_id="unique-fields",
                )
            )
            continue

        grouped_records: Dict[Tuple[str, ...], List[NormalizedRecord]] = defaultdict(list)
        for record in table.records:
            key_tuple = tuple(_normalized_key_part(_find_record_value(record, field_key)) for field_key in field_set)
            if not any(part for part in key_tuple):
                continue
            grouped_records[key_tuple].append(record)

        for key_tuple, records in grouped_records.items():
            if len(records) < 2:
                continue

            if _records_share_merged_key_span(records, field_set):
                continue

            display_key = ", ".join(f"{field}={value}" for field, value in zip(field_set, key_tuple))
            for record in records:
                first_value = _find_record_value(record, field_set[0])
                findings.append(
                    _finding(
                        severity=SEVERITY_ERROR,
                        code="record.duplicate_key",
                        message=f"Duplicate record detected for unique key set: {display_key}.",
                        sheet_name=sheet_name,
                        table_id=table.id,
                        row_index=record.row_index,
                        field_key=field_set[0],
                        cell_address=first_value.source_address if first_value else None,
                        rule_id="unique-fields",
                    )
                )

    return findings


def _validate_type_consistency(table: NormalizedTable, sheet_name: str) -> List[ValidationFinding]:
    findings: List[ValidationFinding] = []

    for field in table.fields:
        categorized_values: List[Tuple[int, NormalizedValue, str]] = []
        for record in table.records:
            value = _find_record_value(record, field.key)
            if value is None or not _has_meaningful_value(value.value):
                continue

            category = _type_category(value.value)
            categorized_values.append((record.row_index, value, category))

        if len(categorized_values) < 2:
            continue

        category_counts = Counter(category for _, _, category in categorized_values)
        if len(category_counts) == 1:
            continue

        dominant_category, dominant_count = category_counts.most_common(1)[0]
        mismatch_rows = [
            (row_index, value)
            for row_index, value, category in categorized_values
            if category != dominant_category
        ]

        if not mismatch_rows or dominant_count < 2:
            continue

        row_list = ", ".join(str(row_index) for row_index, _ in mismatch_rows[:8])
        more_suffix = "..." if len(mismatch_rows) > 8 else ""
        findings.append(
            _finding(
                severity=SEVERITY_WARNING,
                code="field.type_mismatch",
                message=(
                    f"Field '{field.key}' has mixed value types. Dominant type is "
                    f"'{dominant_category}', mismatches at rows {row_list}{more_suffix}."
                ),
                sheet_name=sheet_name,
                table_id=table.id,
                field_key=field.key,
                cell_address=mismatch_rows[0][1].source_address,
                rule_id="type-consistency",
            )
        )

    return findings


def _validate_outline_grouping(table: NormalizedTable, sheet_name: str) -> List[ValidationFinding]:
    findings: List[ValidationFinding] = []
    row_levels: Dict[int, List[NormalizedValue]] = defaultdict(list)
    column_levels: Dict[int, List[NormalizedValue]] = defaultdict(list)
    hidden_values: List[NormalizedValue] = []

    for record in table.records:
        for value in record.values:
            if value.row_outline_level > 0:
                row_levels[value.row_outline_level].append(value)
            if value.column_outline_level > 0:
                column_levels[value.column_outline_level].append(value)
            if value.row_hidden or value.column_hidden:
                hidden_values.append(value)

    for level, values in sorted(row_levels.items()):
        findings.append(
            _finding(
                severity=SEVERITY_INFO,
                code="outline.row_group",
                message=(
                    f"Row outline/group level {level} detected in {len(values)} normalized cells. "
                    f"Examples: {_cell_examples(values)}."
                ),
                sheet_name=sheet_name,
                table_id=table.id,
                cell_address=values[0].source_address,
                rule_id="outline-groups",
            )
        )

    for level, values in sorted(column_levels.items()):
        findings.append(
            _finding(
                severity=SEVERITY_INFO,
                code="outline.column_group",
                message=(
                    f"Column outline/group level {level} detected in {len(values)} normalized cells. "
                    f"Examples: {_cell_examples(values)}."
                ),
                sheet_name=sheet_name,
                table_id=table.id,
                cell_address=values[0].source_address,
                rule_id="outline-groups",
            )
        )

    if hidden_values:
        findings.append(
            _finding(
                severity=SEVERITY_WARNING,
                code="outline.hidden_group",
                message=(
                    f"Hidden grouped rows or columns affect {len(hidden_values)} normalized cells. "
                    f"Examples: {_cell_examples(hidden_values)}."
                ),
                sheet_name=sheet_name,
                table_id=table.id,
                cell_address=hidden_values[0].source_address,
                rule_id="outline-groups",
            )
        )

    return findings


def _validate_color_formatting(table: NormalizedTable, sheet_name: str) -> List[ValidationFinding]:
    findings: List[ValidationFinding] = []
    fill_colors: Dict[str, List[NormalizedValue]] = defaultdict(list)
    font_colors: Dict[str, List[NormalizedValue]] = defaultdict(list)

    for record in table.records:
        for value in record.values:
            if value.fill_color:
                fill_colors[value.fill_color].append(value)
            if value.font_color:
                font_colors[value.font_color].append(value)

    for color, values in sorted(fill_colors.items()):
        findings.append(
            _finding(
                severity=SEVERITY_INFO,
                code="format.fill_color",
                message=(
                    f"Fill color {color} detected in {len(values)} normalized cells. "
                    f"Examples: {_cell_examples(values)}."
                ),
                sheet_name=sheet_name,
                table_id=table.id,
                cell_address=values[0].source_address,
                rule_id="color-formatting",
            )
        )

    for color, values in sorted(font_colors.items()):
        findings.append(
            _finding(
                severity=SEVERITY_INFO,
                code="format.font_color",
                message=(
                    f"Font color {color} detected in {len(values)} normalized cells. "
                    f"Examples: {_cell_examples(values)}."
                ),
                sheet_name=sheet_name,
                table_id=table.id,
                cell_address=values[0].source_address,
                rule_id="color-formatting",
            )
        )

    return findings


def _default_unique_field_sets(table: NormalizedTable) -> List[List[str]]:
    candidate_keys = [field.key for field in table.fields]
    priority_keys = [
        key
        for key in candidate_keys
        if key in {"id", "code", "reference", "uid"}
        or key.endswith("_id")
        or key.endswith("_code")
        or key.endswith("_reference")
    ]

    if not priority_keys:
        return []

    return [[priority_keys[0]]]


def _find_record_value(record: NormalizedRecord, field_key: str) -> Optional[NormalizedValue]:
    for value in record.values:
        if value.field_key == field_key:
            return value
    return None


def _records_share_merged_key_span(records: Sequence[NormalizedRecord], field_set: Sequence[str]) -> bool:
    for field_key in field_set:
        merge_ranges: set[str] = set()

        for record in records:
            value = _find_record_value(record, field_key)
            if value is None or not _has_meaningful_value(value.value) or not value.merge_range:
                merge_ranges = set()
                break

            merge_ranges.add(value.merge_range)

        if len(merge_ranges) == 1:
            return True

    return False


def _cell_examples(values: Sequence[NormalizedValue], limit: int = 8) -> str:
    unique_addresses: List[str] = []
    seen_addresses: set[str] = set()

    for value in values:
        if value.source_address in seen_addresses:
            continue

        seen_addresses.add(value.source_address)
        unique_addresses.append(value.source_address)
        if len(unique_addresses) >= limit:
            break

    suffix = "..." if len(seen_addresses) < len(values) else ""
    return ", ".join(unique_addresses) + suffix


def _normalized_key_part(value: Optional[NormalizedValue]) -> str:
    if value is None or not _has_meaningful_value(value.value):
        return ""

    raw_value = value.value
    if isinstance(raw_value, bool):
        return "true" if raw_value else "false"
    if isinstance(raw_value, (int, float)):
        return str(raw_value)
    return str(raw_value).strip().lower()


def _type_category(value: object) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return "datetime"
    return "text"


def _build_summary(findings: Iterable[ValidationFinding]) -> ValidationSummary:
    summary = ValidationSummary()
    for finding in findings:
        if finding.severity == SEVERITY_INFO:
            summary.info_count += 1
        elif finding.severity == SEVERITY_WARNING:
            summary.warning_count += 1
        elif finding.severity == SEVERITY_ERROR:
            summary.error_count += 1
        elif finding.severity == SEVERITY_CRITICAL:
            summary.critical_count += 1

    return summary


def _finding(
    severity: str,
    code: str,
    message: str,
    sheet_name: Optional[str] = None,
    table_id: Optional[str] = None,
    row_index: Optional[int] = None,
    field_key: Optional[str] = None,
    cell_address: Optional[str] = None,
    rule_id: Optional[str] = None,
) -> ValidationFinding:
    digest = hashlib.sha1()
    digest.update("|".join(
        [
            severity,
            code,
            message,
            sheet_name or "",
            table_id or "",
            str(row_index or ""),
            field_key or "",
            cell_address or "",
            rule_id or "",
        ]
    ).encode("utf-8"))

    return ValidationFinding(
        id=digest.hexdigest()[:16],
        severity=severity,
        code=code,
        message=message,
        sheet_name=sheet_name,
        table_id=table_id,
        row_index=row_index,
        field_key=field_key,
        cell_address=cell_address,
        rule_id=rule_id,
    )


def _has_meaningful_value(value: object) -> bool:
    if value is None:
        return False

    if isinstance(value, str):
        return value.strip() != ""

    return True
