export interface ParseDocumentRequest {
  documentPath: string;
  sheetNames?: string[];
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
  maxTablesPerSheet?: number;
  includeHiddenSheets?: boolean;
}

export interface CellPreview {
  address: string;
  value: string | number | boolean | null;
  formula?: string | null;
  dataType?: string | null;
  comment?: string | null;
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

export interface TablePreview {
  id: string;
  title?: string | null;
  range: string;
  rowCount: number;
  columnCount: number;
  nonEmptyCellCount: number;
  headerRowIndex?: number | null;
  rows: CellPreview[][];
}

export interface SheetPreview {
  id: string;
  name: string;
  hidden: boolean;
  usedRange: string;
  rowCount: number;
  columnCount: number;
  mergedRanges: string[];
  truncated: boolean;
  tables: TablePreview[];
}

export interface WorkbookPreview {
  documentId: string;
  sourceName: string;
  sourcePath: string;
  sourceSizeBytes: number;
  sheetCount: number;
  importedAt: string;
  sheets: SheetPreview[];
  warnings: string[];
}
