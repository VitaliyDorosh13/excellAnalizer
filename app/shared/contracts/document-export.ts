export type ExportFormat = "csv" | "json" | "xml";
export type ExportOutputMode = "single-file" | "per-table";
export type ExportTransform = "none" | "string" | "upper" | "lower";

export interface ExportFieldMapping {
  targetField: string;
  sourceFieldKey?: string | null;
  defaultValue?: string | number | boolean | null;
  transform?: ExportTransform;
}

export interface ExportDocumentRequest {
  documentPath: string;
  sheetNames?: string[];
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
  maxTablesPerSheet?: number;
  includeHiddenSheets?: boolean;
  includeEmptyRecords?: boolean;
  preferFirstRowAsHeader?: boolean;
  format: ExportFormat;
  outputMode?: ExportOutputMode;
  tableIds?: string[];
  includeMetadata?: boolean;
  delimiter?: string;
  outputPath?: string | null;
  mappings?: ExportFieldMapping[];
  xmlRootElement?: string;
  xmlRecordElement?: string;
}

export interface ExportArtifact {
  fileName: string;
  mediaType: string;
  content: string;
  recordCount: number;
  tableId?: string | null;
  targetPath?: string | null;
}

export interface ExportResult {
  documentId: string;
  sourceName: string;
  format: ExportFormat;
  exportedAt: string;
  artifactCount: number;
  artifacts: ExportArtifact[];
  warnings: string[];
}
