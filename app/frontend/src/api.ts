import type {
  DocumentModel,
  ValidationResult
} from "../../shared/contracts/document-model";
import type {
  WorkbookPreview
} from "../../shared/contracts/document-preview";
import type {
  ValidateDocumentRequest
} from "../../shared/contracts/document-validation";
import type {
  ExportDocumentRequest,
  ExportResult
} from "../../shared/contracts/document-export";

export interface BackendCapability {
  id: string;
  description: string;
}

export interface BackendHealth {
  name: string;
  version: string;
  startedAt: string;
  capabilities: BackendCapability[];
}

export interface PluginSummary {
  pluginId: string;
  name?: string;
  version: string;
  apiVersion?: string;
  enabled: boolean;
  capabilities: string[];
  permissions?: string[];
  supportedFormats?: string[];
  entryPoint?: string;
  manifestPath?: string;
}

export interface PluginLoadIssue {
  manifestPath: string;
  severity: "warning" | "error";
  message: string;
  pluginId?: string | null;
}

export interface PluginListResponse {
  items: PluginSummary[];
  issues?: PluginLoadIssue[];
  pluginRoot?: string;
}

export interface DocumentOperationBase {
  documentPath: string;
  sheetNames?: string[];
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
  maxTablesPerSheet?: number;
  includeHiddenSheets?: boolean;
}

export interface NormalizeRequest extends DocumentOperationBase {
  includeEmptyRecords?: boolean;
  preferFirstRowAsHeader?: boolean;
}

export interface PreviewRequest extends DocumentOperationBase {}

export interface ChangeLogRecord {
  generatedAt: string;
  documentId: string;
  sourceName: string;
  sourcePath: string;
  changeType: "added" | "removed" | "modified";
  sheetName: string;
  tableId: string;
  rowIndex: number;
  fieldKey: string;
  label: string;
  sourceAddress: string;
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
}

export interface ChangeLogRequest {
  changes: ChangeLogRecord[];
}

export interface ChangeLogResponse {
  logPath: string;
  writtenCount: number;
}

const defaultRequestTimeoutMs = 15000;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), defaultRequestTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${defaultRequestTimeoutMs / 1000} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getHealth(baseUrl: string): Promise<BackendHealth> {
  return requestJson<BackendHealth>(`${baseUrl}/health`);
}

export function getPlugins(baseUrl: string): Promise<PluginListResponse> {
  return requestJson<PluginListResponse>(`${baseUrl}/plugins`);
}

export function previewDocument(baseUrl: string, payload: PreviewRequest): Promise<WorkbookPreview> {
  return requestJson<WorkbookPreview>(`${baseUrl}/documents/preview`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function normalizeDocument(baseUrl: string, payload: NormalizeRequest): Promise<DocumentModel> {
  return requestJson<DocumentModel>(`${baseUrl}/documents/normalize`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function validateDocument(baseUrl: string, payload: ValidateDocumentRequest): Promise<ValidationResult> {
  return requestJson<ValidationResult>(`${baseUrl}/documents/validate`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function exportDocument(baseUrl: string, payload: ExportDocumentRequest): Promise<ExportResult> {
  return requestJson<ExportResult>(`${baseUrl}/documents/export`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logDocumentChanges(baseUrl: string, payload: ChangeLogRequest): Promise<ChangeLogResponse> {
  return requestJson<ChangeLogResponse>(`${baseUrl}/changes/log`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
