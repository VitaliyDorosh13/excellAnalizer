export type FindingSeverity = "info" | "warning" | "error" | "critical";

export interface NormalizedField {
  key: string;
  label: string;
  columnIndex: number;
  sourceAddress: string;
  dataType?: string | null;
}

export interface NormalizedValue {
  fieldKey: string;
  label: string;
  value: string | number | boolean | null;
  sourceAddress: string;
  dataType?: string | null;
  formula?: string | null;
  isMerged?: boolean;
  mergeParent?: string | null;
  mergeRange?: string | null;
  rowOutlineLevel?: number;
  columnOutlineLevel?: number;
  rowHidden?: boolean;
  columnHidden?: boolean;
  fillColor?: string | null;
  fontColor?: string | null;
}

export interface NormalizedRecord {
  rowIndex: number;
  values: NormalizedValue[];
}

export interface TableModel {
  id: string;
  title?: string | null;
  range: string;
  sheetName: string;
  headerRowIndex?: number | null;
  fields: NormalizedField[];
  records: NormalizedRecord[];
  warnings: string[];
}

export interface SheetModel {
  id: string;
  name: string;
  hidden: boolean;
  tables: TableModel[];
}

export interface DocumentModel {
  documentId: string;
  sourceName: string;
  sourcePath: string;
  sheetCount: number;
  importedAt: string;
  normalizedAt: string;
  sheets: SheetModel[];
  warnings: string[];
}

export interface ValidationFinding {
  id: string;
  severity: FindingSeverity;
  code: string;
  message: string;
  sheetName?: string;
  tableId?: string;
  rowIndex?: number;
  fieldKey?: string;
  cellAddress?: string;
  ruleId?: string;
}

export interface ValidationSummary {
  infoCount: number;
  warningCount: number;
  errorCount: number;
  criticalCount: number;
}

export interface ValidationResult {
  documentId: string;
  sourceName: string;
  validatedAt: string;
  summary: ValidationSummary;
  findings: ValidationFinding[];
  warnings: string[];
}
