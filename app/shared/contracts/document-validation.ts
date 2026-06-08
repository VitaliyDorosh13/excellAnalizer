export interface ValidateDocumentRequest {
  documentPath: string;
  sheetNames?: string[];
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
  maxTablesPerSheet?: number;
  includeHiddenSheets?: boolean;
  includeEmptyRecords?: boolean;
  preferFirstRowAsHeader?: boolean;
  requiredFieldKeys?: string[];
  uniqueFieldSets?: string[][];
  detectTypeMismatches?: boolean;
  enforceNonEmptyTables?: boolean;
  detectOutlineGroups?: boolean;
  detectColorFormatting?: boolean;
}
