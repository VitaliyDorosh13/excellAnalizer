import { startTransition, useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { ExportDocumentRequest, ExportFieldMapping } from "../../shared/contracts/document-export";
import type {
  DocumentModel,
  NormalizedRecord,
  TableModel,
  ValidationFinding,
  ValidationResult
} from "../../shared/contracts/document-model";
import type { CellPreview, SheetPreview, TablePreview, WorkbookPreview } from "../../shared/contracts/document-preview";
import type { ValidateDocumentRequest } from "../../shared/contracts/document-validation";
import {
  exportDocument,
  getHealth,
  getPlugins,
  logDocumentChanges,
  normalizeDocument,
  previewDocument,
  validateDocument,
  type BackendHealth,
  type ChangeLogRecord,
  type PluginLoadIssue,
  type PluginSummary
} from "./api";
import {
  formatTimestamp,
  parseCommaSeparated,
  parseUniqueFieldSets,
  prettyJson,
  summarizeError
} from "./formatters";

type OperationKind = "preview" | "normalize" | "validate" | "export";
type ResultView = "preview" | "records" | "changes" | "findings" | "export" | "raw";
type PresetSettings = Omit<FormState, "documentPath" | "exportOutputPath">;
type ChangeKind = "added" | "removed" | "modified";

interface NormalizedValueSnapshot {
  key: string;
  documentId: string;
  sourceName: string;
  sourcePath: string;
  sheetName: string;
  tableId: string;
  rowIndex: number;
  fieldKey: string;
  label: string;
  sourceAddress: string;
  value: string | number | boolean | null;
}

interface NormalizedDocumentSnapshot {
  capturedAt: string;
  documentId: string;
  sourceName: string;
  sourcePath: string;
  values: Record<string, NormalizedValueSnapshot>;
}

interface DataChangeEntry {
  id: string;
  changeType: ChangeKind;
  sheetName: string;
  tableId: string;
  rowIndex: number;
  fieldKey: string;
  label: string;
  sourceAddress: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
}

interface DataChangeSet {
  generatedAt: string;
  documentId: string;
  sourceName: string;
  sourcePath: string;
  previousSnapshotAt: string | null;
  currentSnapshotAt: string;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  entries: DataChangeEntry[];
  logPath?: string;
  logError?: string;
}

interface ConfigurationPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: PresetSettings;
}

interface EnvironmentStatus {
  lastCheckedAt: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
  isChecking: boolean;
}

interface FormState {
  backendUrl: string;
  documentPath: string;
  sheetNames: string;
  maxRowsPerSheet: number;
  maxColumnsPerSheet: number;
  maxTablesPerSheet: number;
  includeHiddenSheets: boolean;
  includeEmptyRecords: boolean;
  preferFirstRowAsHeader: boolean;
  requiredFieldKeys: string;
  uniqueFieldSets: string;
  detectOutlineGroups: boolean;
  detectColorFormatting: boolean;
  exportFormat: ExportDocumentRequest["format"];
  exportMode: ExportDocumentRequest["outputMode"];
  exportOutputPath: string;
  exportDelimiter: string;
  exportMappingsJson: string;
  xmlRootElement: string;
  xmlRecordElement: string;
  includeMetadata: boolean;
}

const workflowSteps = [
  "Point the UI at the local Python backend service",
  "Run preview to inspect multi-sheet workbook structure",
  "Normalize detected tables into records and fields",
  "Validate data quality and export the result set"
];

const sampleExportMappings = `[
  { "targetField": "asset_id", "sourceFieldKey": "id", "transform": "string" },
  { "targetField": "asset_name", "sourceFieldKey": "name", "transform": "upper" },
  { "targetField": "source_system", "defaultValue": "document-platform" }
]`;

const configurationPresetStorageKey = "document-platform.configuration-presets.v1";
const normalizedSnapshotStoragePrefix = "document-platform.normalized-snapshot.v1:";
const environmentPollIntervalMs = 15000;

const initialForm: FormState = {
  backendUrl: "http://127.0.0.1:8000",
  documentPath: "",
  sheetNames: "",
  maxRowsPerSheet: 200,
  maxColumnsPerSheet: 50,
  maxTablesPerSheet: 12,
  includeHiddenSheets: true,
  includeEmptyRecords: false,
  preferFirstRowAsHeader: false,
  requiredFieldKeys: "id,name",
  uniqueFieldSets: "id",
  detectOutlineGroups: true,
  detectColorFormatting: true,
  exportFormat: "json",
  exportMode: "single-file",
  exportOutputPath: "",
  exportDelimiter: ",",
  exportMappingsJson: "",
  xmlRootElement: "records",
  xmlRecordElement: "record",
  includeMetadata: true
};

export default function App() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginRoot, setPluginRoot] = useState<string | null>(null);
  const [pluginIssues, setPluginIssues] = useState<PluginLoadIssue[]>([]);
  const [activeOperation, setActiveOperation] = useState<OperationKind>("preview");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [environmentStatus, setEnvironmentStatus] = useState<EnvironmentStatus>({
    lastCheckedAt: null,
    latencyMs: null,
    errorMessage: null,
    isChecking: false
  });
  const [previewResult, setPreviewResult] = useState<WorkbookPreview | null>(null);
  const [normalizedResult, setNormalizedResult] = useState<DocumentModel | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [exportResult, setExportResult] = useState<ReturnType<typeof buildExportSnapshot> | null>(null);
  const [changeSet, setChangeSet] = useState<DataChangeSet | null>(null);
  const [resultPayload, setResultPayload] = useState<unknown>(null);
  const [resultView, setResultView] = useState<ResultView>("preview");
  const [selectedPreviewSheetId, setSelectedPreviewSheetId] = useState<string | null>(null);
  const [selectedPreviewTableId, setSelectedPreviewTableId] = useState<string | null>(null);
  const [selectedNormalizedTableId, setSelectedNormalizedTableId] = useState<string | null>(null);
  const [selectedExportTableIds, setSelectedExportTableIds] = useState<string[]>([]);
  const [configurationPresets, setConfigurationPresets] = useState<ConfigurationPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const deferredJson = useDeferredValue(prettyJson(resultPayload));

  useEffect(() => {
    setConfigurationPresets(loadConfigurationPresets());
  }, []);

  useEffect(() => {
    void refreshEnvironment({ surfaceErrors: false });
    const intervalId = window.setInterval(() => {
      void refreshEnvironment({ surfaceErrors: false });
    }, environmentPollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [form.backendUrl]);

  async function refreshEnvironment(options: { surfaceErrors?: boolean } = {}) {
    const surfaceErrors = options.surfaceErrors ?? true;
    const startedAt = Date.now();
    if (surfaceErrors) {
      setErrorMessage(null);
    }
    setEnvironmentStatus((current) => ({ ...current, isChecking: true }));
    try {
      const [nextHealth, pluginResponse] = await Promise.all([
        getHealth(form.backendUrl),
        getPlugins(form.backendUrl)
      ]);
      startTransition(() => {
        setHealth(nextHealth);
        setPlugins(pluginResponse.items);
        setPluginRoot(pluginResponse.pluginRoot ?? null);
        setPluginIssues(pluginResponse.issues ?? []);
      });
      setEnvironmentStatus({
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        errorMessage: null,
        isChecking: false
      });
    } catch (error) {
      const message = summarizeError(error);
      setHealth(null);
      setPlugins([]);
      setPluginRoot(null);
      setPluginIssues([]);
      setEnvironmentStatus({
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        errorMessage: message,
        isChecking: false
      });
      if (surfaceErrors) {
        setErrorMessage(message);
      }
    }
  }

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setNoticeMessage(null);
  }

  function saveCurrentPreset() {
    const name = presetName.trim();
    if (!name) {
      setErrorMessage("Preset name is required.");
      return;
    }

    const now = new Date().toISOString();
    const settings = formToPresetSettings(form);
    const existingPreset = configurationPresets.find(
      (preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    const nextPreset: ConfigurationPreset = existingPreset
      ? { ...existingPreset, name, updatedAt: now, settings }
      : {
          id: crypto.randomUUID(),
          name,
          createdAt: now,
          updatedAt: now,
          settings
        };
    const nextPresets = existingPreset
      ? configurationPresets.map((preset) => (preset.id === existingPreset.id ? nextPreset : preset))
      : [...configurationPresets, nextPreset];

    persistConfigurationPresets(nextPresets);
    setConfigurationPresets(nextPresets);
    setPresetName(name);
    setErrorMessage(null);
    setNoticeMessage(`Configuration preset "${name}" saved.`);
  }

  function applyPreset(preset: ConfigurationPreset) {
    setForm((current) => ({
      ...preset.settings,
      documentPath: current.documentPath,
      exportOutputPath: current.exportOutputPath
    }));
    setPresetName(preset.name);
    setSelectedExportTableIds([]);
    setErrorMessage(null);
    setNoticeMessage(`Configuration preset "${preset.name}" loaded.`);
  }

  function deletePreset(presetId: string) {
    const preset = configurationPresets.find((item) => item.id === presetId);
    const nextPresets = configurationPresets.filter((item) => item.id !== presetId);
    persistConfigurationPresets(nextPresets);
    setConfigurationPresets(nextPresets);
    if (preset?.name === presetName) {
      setPresetName("");
    }
    setErrorMessage(null);
    setNoticeMessage(preset ? `Configuration preset "${preset.name}" deleted.` : "Configuration preset deleted.");
  }

  function resetConfiguration() {
    setForm((current) => ({
      ...initialForm,
      documentPath: current.documentPath,
      exportOutputPath: current.exportOutputPath
    }));
    setSelectedExportTableIds([]);
    setPresetName("");
    setErrorMessage(null);
    setNoticeMessage("Configuration reset to defaults. Workbook and output paths were preserved.");
  }

  async function pickWorkbook() {
    setErrorMessage(null);

    try {
      const selectedPath = await open({
        multiple: false,
        filters: [
          {
            name: "Excel workbooks",
            extensions: ["xlsx", "xlsm", "xltx", "xltm"]
          }
        ]
      });

      if (typeof selectedPath === "string") {
        updateField("documentPath", selectedPath);
      }
    } catch (error) {
      setErrorMessage(
        `File picker is available in the desktop app. In the browser, paste the absolute workbook path manually. ${summarizeError(error)}`
      );
    }
  }

  async function pickExportOutputPath() {
    setErrorMessage(null);

    try {
      const selectedPath = await save({
        defaultPath: defaultExportFileName(form.exportFormat),
        filters: [
          {
            name: `${form.exportFormat.toUpperCase()} export`,
            extensions: [form.exportFormat]
          }
        ]
      });

      if (typeof selectedPath === "string") {
        updateField("exportOutputPath", selectedPath);
      }
    } catch (error) {
      setErrorMessage(
        `Save dialog is available in the desktop app. In the browser, paste the export path manually. ${summarizeError(error)}`
      );
    }
  }

  function buildBaseRequest() {
    return {
      documentPath: form.documentPath.trim(),
      sheetNames: parseCommaSeparated(form.sheetNames),
      maxRowsPerSheet: Number(form.maxRowsPerSheet),
      maxColumnsPerSheet: Number(form.maxColumnsPerSheet),
      maxTablesPerSheet: Number(form.maxTablesPerSheet),
      includeHiddenSheets: form.includeHiddenSheets
    };
  }

  async function runPreview() {
    await runOperation("preview", async () => {
      const result = await previewDocument(form.backendUrl, buildBaseRequest());
      startTransition(() => {
        setPreviewResult(result);
        setSelectedPreviewSheetId(result.sheets[0]?.id ?? null);
        setSelectedPreviewTableId(result.sheets[0]?.tables[0]?.id ?? null);
        setResultView("preview");
        setResultPayload(result);
      });
    });
  }

  async function runNormalize() {
    await runOperation("normalize", async () => {
      const result = await normalizeDocument(form.backendUrl, {
        ...buildBaseRequest(),
        includeEmptyRecords: form.includeEmptyRecords,
        preferFirstRowAsHeader: form.preferFirstRowAsHeader
      });
      const previousSnapshot = loadNormalizedSnapshot(result.sourcePath);
      const nextSnapshot = buildNormalizedSnapshot(result);
      let nextChangeSet = buildDataChangeSet(previousSnapshot, nextSnapshot);
      persistNormalizedSnapshot(nextSnapshot);

      if (nextChangeSet.entries.length) {
        try {
          const logResponse = await logDocumentChanges(form.backendUrl, {
            changes: nextChangeSet.entries.map((entry) => changeEntryToLogRecord(nextChangeSet, entry))
          });
          nextChangeSet = { ...nextChangeSet, logPath: logResponse.logPath };
        } catch (error) {
          nextChangeSet = { ...nextChangeSet, logError: summarizeError(error) };
        }
      }

      startTransition(() => {
        setNormalizedResult(result);
        setChangeSet(nextChangeSet);
        setSelectedNormalizedTableId(firstNormalizedTableId(result));
        setSelectedExportTableIds([]);
        setResultView(nextChangeSet.entries.length ? "changes" : "records");
        setResultPayload(result);
      });
    });
  }

  async function runValidate() {
    await runOperation("validate", async () => {
      const request: ValidateDocumentRequest = {
        ...buildBaseRequest(),
        includeEmptyRecords: form.includeEmptyRecords,
        preferFirstRowAsHeader: form.preferFirstRowAsHeader,
        requiredFieldKeys: parseCommaSeparated(form.requiredFieldKeys),
        uniqueFieldSets: parseUniqueFieldSets(form.uniqueFieldSets),
        detectTypeMismatches: true,
        enforceNonEmptyTables: true,
        detectOutlineGroups: form.detectOutlineGroups,
        detectColorFormatting: form.detectColorFormatting
      };
      const result = await validateDocument(form.backendUrl, request);
      startTransition(() => {
        setValidationResult(result);
        setResultView("findings");
        setResultPayload(result);
      });
    });
  }

  async function runExport() {
    await runOperation("export", async () => {
      const request: ExportDocumentRequest = {
        ...buildBaseRequest(),
        includeEmptyRecords: form.includeEmptyRecords,
        preferFirstRowAsHeader: form.preferFirstRowAsHeader,
        format: form.exportFormat,
        outputMode: form.exportMode,
        includeMetadata: form.includeMetadata,
        delimiter: form.exportDelimiter,
        outputPath: form.exportOutputPath.trim() || null,
        tableIds: exportTableIdsForRequest(normalizedTables, selectedExportTableIds),
        mappings: parseExportMappings(form.exportMappingsJson),
        xmlRootElement: form.xmlRootElement.trim() || "records",
        xmlRecordElement: form.xmlRecordElement.trim() || "record"
      };
      const result = await exportDocument(form.backendUrl, request);
      const snapshot = buildExportSnapshot(result);
      startTransition(() => {
        setExportResult(snapshot);
        setResultView("export");
        setResultPayload(result);
      });
    });
  }

  async function runOperation(kind: OperationKind, callback: () => Promise<void>) {
    if (!form.documentPath.trim()) {
      setActiveOperation(kind);
      setErrorMessage("Document path is required.");
      return;
    }

    setActiveOperation(kind);
    setIsBusy(true);
    setErrorMessage(null);

    try {
      await callback();
    } catch (error) {
      setErrorMessage(summarizeError(error));
    } finally {
      setIsBusy(false);
    }
  }

  const stats = useMemo(() => {
    const previewSheets = previewResult?.sheets.length ?? 0;
    const normalizedTables =
      normalizedResult?.sheets.reduce((count, sheet) => count + sheet.tables.length, 0) ?? 0;
    const validationFindings = validationResult?.findings.length ?? 0;
    const exportArtifacts = exportResult?.artifactCount ?? 0;
    const dataChanges = changeSet?.entries.length ?? 0;

    return [
      { label: "Sheets previewed", value: String(previewSheets) },
      { label: "Tables normalized", value: String(normalizedTables) },
      { label: "Data changes", value: String(dataChanges) },
      { label: "Validation findings", value: String(validationFindings) },
      { label: "Export artifacts", value: String(exportArtifacts) }
    ];
  }, [changeSet, exportResult, normalizedResult, previewResult, validationResult]);

  const selectedPreviewSheet = useMemo(() => {
    if (!previewResult) {
      return null;
    }

    return (
      previewResult.sheets.find((sheet) => sheet.id === selectedPreviewSheetId) ??
      previewResult.sheets[0] ??
      null
    );
  }, [previewResult, selectedPreviewSheetId]);

  const selectedPreviewTable = useMemo(() => {
    if (!selectedPreviewSheet) {
      return null;
    }

    return (
      selectedPreviewSheet.tables.find((table) => table.id === selectedPreviewTableId) ??
      selectedPreviewSheet.tables[0] ??
      null
    );
  }, [selectedPreviewSheet, selectedPreviewTableId]);

  const normalizedTables = useMemo(
    () => flattenNormalizedTables(normalizedResult),
    [normalizedResult]
  );

  const selectedNormalizedTable = useMemo(() => {
    if (!normalizedTables.length) {
      return null;
    }

    return (
      normalizedTables.find((table) => table.id === selectedNormalizedTableId) ??
      normalizedTables[0] ??
      null
    );
  }, [normalizedTables, selectedNormalizedTableId]);

  function toggleExportTable(tableId: string, checked: boolean) {
    setSelectedExportTableIds((current) => {
      if (checked) {
        return current.includes(tableId) ? current : [...current, tableId];
      }

      return current.filter((id) => id !== tableId);
    });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">ALSTOM Document Platform</p>
        <h1>Operator console for workbook preview, normalization, validation, and export.</h1>
        <p className="hero-copy">
          The desktop shell is now wired for the Python backend contract. Point it to
          a running local service, provide a workbook path, and drive the full MVP
          pipeline from one screen.
        </p>
      </section>

      <section className="grid dashboard-grid">
        <article className="panel panel-accent span-4">
          <div className="section-header">
            <h2>Pipeline</h2>
            <button className="ghost-button" onClick={() => void refreshEnvironment({ surfaceErrors: true })} type="button">
              Refresh backend
            </button>
          </div>
          <ul className="step-list">
            {workflowSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <div className="stack-top">
            <StatusChip
              label={health ? "Backend online" : "Backend pending"}
              tone={health ? "success" : "muted"}
            />
            <StatusChip
              label={`${plugins.length} plugin${plugins.length === 1 ? "" : "s"}`}
              tone="info"
            />
          </div>
          <EnvironmentStatusPanel backendUrl={form.backendUrl} status={environmentStatus} />
        </article>

        <article className="panel span-8">
          <div className="section-header">
            <h2>Environment</h2>
            <span className="caption">
              {health ? `${health.name} ${health.version}` : "Waiting for backend"}
            </span>
          </div>
          <div className="stats-grid">
            {stats.map((stat) => (
              <div className="stat-card" key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
          <div className="info-grid">
            <div className="info-card">
              <h3>Backend capabilities</h3>
              <ul className="plain-list compact-list">
                {(health?.capabilities ?? []).map((capability) => (
                  <li key={capability.id}>
                    <strong>{capability.id}</strong>: {capability.description}
                  </li>
                ))}
              </ul>
            </div>
            <div className="info-card">
              <h3>Plugin registry</h3>
              <PluginRegistryPanel plugins={plugins} pluginRoot={pluginRoot} issues={pluginIssues} />
            </div>
          </div>
        </article>

        <article className="panel span-5">
          <div className="section-header">
            <h2>Document Input</h2>
            <span className="caption">Base request shared by all operations</span>
          </div>
          <PresetManager
            presets={configurationPresets}
            presetName={presetName}
            onPresetNameChange={setPresetName}
            onSave={saveCurrentPreset}
            onApply={applyPreset}
            onDelete={deletePreset}
            onReset={resetConfiguration}
          />
          <div className="form-grid">
            <label className="field span-full">
              <span>Backend URL</span>
              <input
                value={form.backendUrl}
                onChange={(event) => updateField("backendUrl", event.target.value)}
                placeholder="http://127.0.0.1:8000"
              />
            </label>
            <label className="field span-full">
              <span>Workbook path</span>
              <div className="input-action">
                <input
                  value={form.documentPath}
                  onChange={(event) => updateField("documentPath", event.target.value)}
                  placeholder="/absolute/path/to/workbook.xlsx"
                />
                <button className="ghost-button" onClick={() => void pickWorkbook()} type="button">
                  Browse
                </button>
              </div>
            </label>
            <label className="field span-full">
              <span>Sheet names</span>
              <input
                value={form.sheetNames}
                onChange={(event) => updateField("sheetNames", event.target.value)}
                placeholder="Sheet1, Sheet2"
              />
            </label>
            <NumberField
              label="Max rows"
              value={form.maxRowsPerSheet}
              onChange={(value) => updateField("maxRowsPerSheet", value)}
            />
            <NumberField
              label="Max columns"
              value={form.maxColumnsPerSheet}
              onChange={(value) => updateField("maxColumnsPerSheet", value)}
            />
            <NumberField
              label="Max tables"
              value={form.maxTablesPerSheet}
              onChange={(value) => updateField("maxTablesPerSheet", value)}
            />
            <ToggleField
              label="Include hidden sheets"
              checked={form.includeHiddenSheets}
              onChange={(checked) => updateField("includeHiddenSheets", checked)}
            />
            <ToggleField
              label="Include empty records"
              checked={form.includeEmptyRecords}
              onChange={(checked) => updateField("includeEmptyRecords", checked)}
            />
            <ToggleField
              label="First row as header"
              checked={form.preferFirstRowAsHeader}
              onChange={(checked) => updateField("preferFirstRowAsHeader", checked)}
            />
          </div>
        </article>

        <article className="panel span-7">
          <div className="section-header">
            <h2>Operations</h2>
            <span className="caption">
              {isBusy ? "Request in progress" : `Last mode: ${activeOperation}`}
            </span>
          </div>
          <div className="button-row">
            <button className="action-button" disabled={isBusy} onClick={() => void runPreview()} type="button">
              Preview
            </button>
            <button className="action-button" disabled={isBusy} onClick={() => void runNormalize()} type="button">
              Normalize
            </button>
            <button className="action-button" disabled={isBusy} onClick={() => void runValidate()} type="button">
              Validate
            </button>
            <button className="action-button" disabled={isBusy} onClick={() => void runExport()} type="button">
              Export
            </button>
          </div>

          <div className="form-grid stack-top">
            <label className="field span-full">
              <span>Required fields</span>
              <input
                value={form.requiredFieldKeys}
                onChange={(event) => updateField("requiredFieldKeys", event.target.value)}
                placeholder="id,name"
              />
            </label>
            <label className="field span-full">
              <span>Unique field sets</span>
              <input
                value={form.uniqueFieldSets}
                onChange={(event) => updateField("uniqueFieldSets", event.target.value)}
                placeholder="id; asset_id, revision"
              />
            </label>
            <ToggleField
              label="Detect outline groups"
              checked={form.detectOutlineGroups}
              onChange={(checked) => updateField("detectOutlineGroups", checked)}
            />
            <ToggleField
              label="Detect color formatting"
              checked={form.detectColorFormatting}
              onChange={(checked) => updateField("detectColorFormatting", checked)}
            />
            <label className="field">
              <span>Export format</span>
              <select
                value={form.exportFormat}
                onChange={(event) =>
                  updateField("exportFormat", event.target.value as FormState["exportFormat"])
                }
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="xml">XML</option>
              </select>
            </label>
            <label className="field">
              <span>Export mode</span>
              <select
                value={form.exportMode}
                onChange={(event) =>
                  updateField("exportMode", event.target.value as FormState["exportMode"])
                }
              >
                <option value="single-file">single-file</option>
                <option value="per-table">per-table</option>
              </select>
            </label>
            <label className="field">
              <span>CSV delimiter</span>
              <input
                value={form.exportDelimiter}
                onChange={(event) => updateField("exportDelimiter", event.target.value)}
                maxLength={1}
                placeholder=","
              />
            </label>
            <label className="field">
              <span>XML root</span>
              <input
                value={form.xmlRootElement}
                onChange={(event) => updateField("xmlRootElement", event.target.value)}
                placeholder="records"
              />
            </label>
            <label className="field">
              <span>XML record</span>
              <input
                value={form.xmlRecordElement}
                onChange={(event) => updateField("xmlRecordElement", event.target.value)}
                placeholder="record"
              />
            </label>
            <ToggleField
              label="Include export metadata"
              checked={form.includeMetadata}
              onChange={(checked) => updateField("includeMetadata", checked)}
            />
            <ExportTablePicker
              tables={normalizedTables}
              selectedTableIds={selectedExportTableIds}
              onToggle={toggleExportTable}
              onSelectAll={() => setSelectedExportTableIds(normalizedTables.map((table) => table.id))}
              onClear={() => setSelectedExportTableIds([])}
            />
            <label className="field span-full">
              <span>Output path</span>
              <div className="input-action">
                <input
                  value={form.exportOutputPath}
                  onChange={(event) => updateField("exportOutputPath", event.target.value)}
                  placeholder="/optional/output/path.json"
                />
                <button className="ghost-button" onClick={() => void pickExportOutputPath()} type="button">
                  Save as
                </button>
              </div>
            </label>
            <label className="field span-full">
              <span>Export mappings JSON</span>
              <textarea
                rows={8}
                value={form.exportMappingsJson}
                onChange={(event) => updateField("exportMappingsJson", event.target.value)}
                placeholder={sampleExportMappings}
              />
              <small className="field-hint">
                Leave empty to export every normalized field. Use mappings to rename fields, add defaults,
                or apply string, upper, and lower transforms.
              </small>
            </label>
          </div>
          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          {noticeMessage ? <p className="notice-banner">{noticeMessage}</p> : null}
        </article>

        <article className="panel span-12">
          <div className="section-header">
            <h2>Results</h2>
            <span className="caption">
              {health ? `Backend started ${formatTimestamp(health.startedAt)}` : "No backend response yet"}
            </span>
          </div>
          <ResultSummary
            preview={previewResult}
            normalized={normalizedResult}
            changeSet={changeSet}
            validation={validationResult}
            exportSnapshot={exportResult}
          />
          <ResultTabs activeView={resultView} onChange={setResultView} />
          {resultView === "preview" ? (
            <PreviewDrillDown
              preview={previewResult}
              selectedSheet={selectedPreviewSheet}
              selectedTable={selectedPreviewTable}
              onSelectSheet={(sheet) => {
                setSelectedPreviewSheetId(sheet.id);
                setSelectedPreviewTableId(sheet.tables[0]?.id ?? null);
              }}
              onSelectTable={(table) => setSelectedPreviewTableId(table.id)}
            />
          ) : null}
          {resultView === "records" ? (
            <RecordsDrillDown
              tables={normalizedTables}
              selectedTable={selectedNormalizedTable}
              onSelectTable={(table) => setSelectedNormalizedTableId(table.id)}
            />
          ) : null}
          {resultView === "changes" ? <ChangesView changeSet={changeSet} /> : null}
          {resultView === "findings" ? <FindingsView validation={validationResult} /> : null}
          {resultView === "export" ? <ExportArtifactsView exportSnapshot={exportResult} /> : null}
          {resultView === "raw" ? <pre className="result-console">{deferredJson}</pre> : null}
        </article>
      </section>
    </main>
  );
}

function firstNormalizedTableId(document: DocumentModel): string | null {
  return document.sheets.find((sheet) => sheet.tables.length > 0)?.tables[0]?.id ?? null;
}

function flattenNormalizedTables(document: DocumentModel | null): TableModel[] {
  if (!document) {
    return [];
  }

  return document.sheets.flatMap((sheet) => sheet.tables);
}

function buildNormalizedSnapshot(document: DocumentModel): NormalizedDocumentSnapshot {
  const values: Record<string, NormalizedValueSnapshot> = {};

  for (const sheet of document.sheets) {
    for (const table of sheet.tables) {
      for (const record of table.records) {
        for (const value of record.values) {
          const key = normalizedValueKey(sheet.name, table.id, record.rowIndex, value.fieldKey);
          values[key] = {
            key,
            documentId: document.documentId,
            sourceName: document.sourceName,
            sourcePath: document.sourcePath,
            sheetName: sheet.name,
            tableId: table.id,
            rowIndex: record.rowIndex,
            fieldKey: value.fieldKey,
            label: value.label,
            sourceAddress: value.sourceAddress,
            value: value.value ?? null
          };
        }
      }
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    documentId: document.documentId,
    sourceName: document.sourceName,
    sourcePath: document.sourcePath,
    values
  };
}

function buildDataChangeSet(
  previousSnapshot: NormalizedDocumentSnapshot | null,
  currentSnapshot: NormalizedDocumentSnapshot
): DataChangeSet {
  if (!previousSnapshot) {
    return {
      generatedAt: new Date().toISOString(),
      documentId: currentSnapshot.documentId,
      sourceName: currentSnapshot.sourceName,
      sourcePath: currentSnapshot.sourcePath,
      previousSnapshotAt: null,
      currentSnapshotAt: currentSnapshot.capturedAt,
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      entries: []
    };
  }

  const entries: DataChangeEntry[] = [];

  for (const [key, currentValue] of Object.entries(currentSnapshot.values)) {
    const previousValue = previousSnapshot.values[key];
    if (!previousValue) {
      entries.push(snapshotToChangeEntry("added", currentValue, null, currentValue.value));
      continue;
    }

    if (!scalarValuesEqual(previousValue.value, currentValue.value)) {
      entries.push(snapshotToChangeEntry("modified", currentValue, previousValue.value, currentValue.value));
    }
  }

  for (const [key, previousValue] of Object.entries(previousSnapshot.values)) {
    if (!currentSnapshot.values[key]) {
      entries.push(snapshotToChangeEntry("removed", previousValue, previousValue.value, null));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    documentId: currentSnapshot.documentId,
    sourceName: currentSnapshot.sourceName,
    sourcePath: currentSnapshot.sourcePath,
    previousSnapshotAt: previousSnapshot.capturedAt,
    currentSnapshotAt: currentSnapshot.capturedAt,
    addedCount: entries.filter((entry) => entry.changeType === "added").length,
    removedCount: entries.filter((entry) => entry.changeType === "removed").length,
    modifiedCount: entries.filter((entry) => entry.changeType === "modified").length,
    entries: entries.sort(compareChangeEntries)
  };
}

function snapshotToChangeEntry(
  changeType: ChangeKind,
  snapshot: NormalizedValueSnapshot,
  oldValue: string | number | boolean | null,
  newValue: string | number | boolean | null
): DataChangeEntry {
  return {
    id: `${changeType}:${snapshot.key}`,
    changeType,
    sheetName: snapshot.sheetName,
    tableId: snapshot.tableId,
    rowIndex: snapshot.rowIndex,
    fieldKey: snapshot.fieldKey,
    label: snapshot.label,
    sourceAddress: snapshot.sourceAddress,
    oldValue,
    newValue
  };
}

function changeEntryToLogRecord(changeSet: DataChangeSet, entry: DataChangeEntry): ChangeLogRecord {
  return {
    generatedAt: changeSet.generatedAt,
    documentId: changeSet.documentId,
    sourceName: changeSet.sourceName,
    sourcePath: changeSet.sourcePath,
    changeType: entry.changeType,
    sheetName: entry.sheetName,
    tableId: entry.tableId,
    rowIndex: entry.rowIndex,
    fieldKey: entry.fieldKey,
    label: entry.label,
    sourceAddress: entry.sourceAddress,
    oldValue: entry.oldValue,
    newValue: entry.newValue
  };
}

function loadNormalizedSnapshot(sourcePath: string): NormalizedDocumentSnapshot | null {
  try {
    const rawValue = localStorage.getItem(normalizedSnapshotStorageKey(sourcePath));
    if (!rawValue) {
      return null;
    }

    const parsed: unknown = JSON.parse(rawValue);
    return isNormalizedDocumentSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistNormalizedSnapshot(snapshot: NormalizedDocumentSnapshot) {
  try {
    localStorage.setItem(normalizedSnapshotStorageKey(snapshot.sourcePath), JSON.stringify(snapshot));
  } catch {
    // Local storage is a convenience cache; normalization should still succeed if it is unavailable.
  }
}

function normalizedSnapshotStorageKey(sourcePath: string): string {
  return `${normalizedSnapshotStoragePrefix}${encodeURIComponent(sourcePath)}`;
}

function normalizedValueKey(sheetName: string, tableId: string, rowIndex: number, fieldKey: string): string {
  return [sheetName, tableId, rowIndex, fieldKey].map((part) => String(part)).join("::");
}

function scalarValuesEqual(
  left: string | number | boolean | null,
  right: string | number | boolean | null
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function compareChangeEntries(left: DataChangeEntry, right: DataChangeEntry): number {
  return (
    left.sheetName.localeCompare(right.sheetName) ||
    left.tableId.localeCompare(right.tableId) ||
    left.rowIndex - right.rowIndex ||
    left.fieldKey.localeCompare(right.fieldKey) ||
    left.changeType.localeCompare(right.changeType)
  );
}

function isNormalizedDocumentSnapshot(value: unknown): value is NormalizedDocumentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const snapshot = value as Partial<NormalizedDocumentSnapshot>;
  return (
    typeof snapshot.capturedAt === "string" &&
    typeof snapshot.documentId === "string" &&
    typeof snapshot.sourceName === "string" &&
    typeof snapshot.sourcePath === "string" &&
    Boolean(snapshot.values) &&
    typeof snapshot.values === "object" &&
    !Array.isArray(snapshot.values)
  );
}

function buildExportSnapshot(result: Awaited<ReturnType<typeof exportDocument>>) {
  return {
    artifactCount: result.artifactCount,
    warnings: result.warnings,
    artifacts: result.artifacts.map((artifact) => ({
      fileName: artifact.fileName,
      recordCount: artifact.recordCount,
      mediaType: artifact.mediaType,
      targetPath: artifact.targetPath
    }))
  };
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        min={1}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ToggleField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function PresetManager(props: {
  presets: ConfigurationPreset[];
  presetName: string;
  onPresetNameChange: (value: string) => void;
  onSave: () => void;
  onApply: (preset: ConfigurationPreset) => void;
  onDelete: (presetId: string) => void;
  onReset: () => void;
}) {
  return (
    <section className="preset-manager" aria-label="Configuration presets">
      <div className="preset-manager-header">
        <div>
          <h3>Configuration presets</h3>
          <p className="caption compact-caption">Save import, validation, and export settings locally.</p>
        </div>
        <button className="ghost-button" onClick={props.onReset} type="button">
          Reset config
        </button>
      </div>
      <div className="input-action">
        <input
          aria-label="Preset name"
          value={props.presetName}
          onChange={(event) => props.onPresetNameChange(event.target.value)}
          placeholder="Preset name, e.g. Alstom PDF handover"
        />
        <button className="ghost-button" onClick={props.onSave} type="button">
          Save preset
        </button>
      </div>
      {props.presets.length ? (
        <div className="preset-list">
          {props.presets.map((preset) => (
            <article className="preset-row" key={preset.id}>
              <div>
                <strong>{preset.name}</strong>
                <small>Updated {formatTimestamp(preset.updatedAt)}</small>
              </div>
              <div className="button-row compact-actions">
                <button className="ghost-button" onClick={() => props.onApply(preset)} type="button">
                  Load
                </button>
                <button className="ghost-button" onClick={() => props.onDelete(preset.id)} type="button">
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="field-hint">No saved presets yet. Paths are intentionally not saved in presets.</p>
      )}
    </section>
  );
}

function ExportTablePicker(props: {
  tables: TableModel[];
  selectedTableIds: string[];
  onToggle: (tableId: string, checked: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const selectedCount = props.selectedTableIds.length;

  return (
    <section className="export-table-picker span-full" aria-label="Export table filter">
      <div className="section-header compact-header">
        <div>
          <h3>Export table filter</h3>
          <p className="caption">
            {props.tables.length
              ? selectedCount
                ? `${selectedCount} of ${props.tables.length} tables selected`
                : "No table selected means export all normalized tables"
              : "Run Normalize to choose specific tables for export"}
          </p>
        </div>
        <div className="button-row compact-actions">
          <button className="ghost-button" disabled={!props.tables.length} onClick={props.onSelectAll} type="button">
            Select all
          </button>
          <button className="ghost-button" disabled={!selectedCount} onClick={props.onClear} type="button">
            Clear
          </button>
        </div>
      </div>
      {props.tables.length ? (
        <div className="export-table-list">
          {props.tables.map((table) => (
            <label className="export-table-option" key={table.id}>
              <input
                type="checkbox"
                checked={props.selectedTableIds.includes(table.id)}
                onChange={(event) => props.onToggle(table.id, event.target.checked)}
              />
              <span>
                <strong>{table.title ?? table.sheetName}</strong>
                <small>
                  {table.sheetName} · {table.range} · {table.records.length} records
                </small>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="field-hint">The export endpoint can still export all tables directly from the workbook.</p>
      )}
    </section>
  );
}

function PluginRegistryPanel(props: {
  plugins: PluginSummary[];
  pluginRoot: string | null;
  issues: PluginLoadIssue[];
}) {
  return (
    <div className="plugin-registry">
      {props.pluginRoot ? <p className="caption compact-caption">Root: {props.pluginRoot}</p> : null}
      <div className="plugin-card-list">
        {props.plugins.length ? (
          props.plugins.map((plugin) => (
            <article className="plugin-card" key={plugin.pluginId}>
              <div className="card-header">
                <div>
                  <strong>{plugin.name ?? plugin.pluginId}</strong>
                  <p className="caption compact-caption">
                    {plugin.pluginId} · v{plugin.version}
                    {plugin.apiVersion ? ` · API ${plugin.apiVersion}` : ""}
                  </p>
                </div>
                <StatusChip label={plugin.enabled ? "enabled" : "disabled"} tone={plugin.enabled ? "success" : "muted"} />
              </div>
              <TokenRow label="Formats" values={plugin.supportedFormats ?? []} emptyLabel="No formats declared" />
              <TokenRow label="Capabilities" values={plugin.capabilities} emptyLabel="No capabilities declared" />
              <TokenRow label="Permissions" values={plugin.permissions ?? []} emptyLabel="No permissions requested" />
              <dl className="plugin-meta">
                <div>
                  <dt>Entry point</dt>
                  <dd>{plugin.entryPoint ?? "n/a"}</dd>
                </div>
                <div>
                  <dt>Manifest</dt>
                  <dd>{plugin.manifestPath ?? "n/a"}</dd>
                </div>
              </dl>
            </article>
          ))
        ) : (
          <EmptyState title="No plugins discovered" detail="Add plugin folders with manifest.json under the plugin root." />
        )}
      </div>
      {props.issues.length ? (
        <div className="plugin-issue-list">
          {props.issues.map((issue) => (
            <div className={`plugin-issue plugin-issue-${issue.severity}`} key={`${issue.manifestPath}-${issue.message}`}>
              <strong>{issue.severity.toUpperCase()}</strong>
              <span>{issue.pluginId ?? issue.manifestPath}</span>
              <p>{issue.message}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TokenRow(props: { label: string; values: string[]; emptyLabel: string }) {
  return (
    <div className="token-row">
      <span>{props.label}</span>
      <div>
        {props.values.length ? (
          props.values.map((value) => <code key={value}>{value}</code>)
        ) : (
          <em>{props.emptyLabel}</em>
        )}
      </div>
    </div>
  );
}

function StatusChip(props: { label: string; tone: "success" | "info" | "muted" }) {
  return <span className={`status-chip status-chip-${props.tone}`}>{props.label}</span>;
}

function EnvironmentStatusPanel(props: { backendUrl: string; status: EnvironmentStatus }) {
  return (
    <div className="environment-monitor">
      <div>
        <span>Backend URL</span>
        <strong>{props.backendUrl}</strong>
      </div>
      <div>
        <span>Last check</span>
        <strong>{props.status.lastCheckedAt ? formatTimestamp(props.status.lastCheckedAt) : "pending"}</strong>
      </div>
      <div>
        <span>Latency</span>
        <strong>
          {props.status.isChecking
            ? "checking..."
            : props.status.latencyMs !== null
              ? `${props.status.latencyMs} ms`
              : "n/a"}
        </strong>
      </div>
      {props.status.errorMessage ? <p>{props.status.errorMessage}</p> : null}
    </div>
  );
}

function ResultSummary(props: {
  preview: WorkbookPreview | null;
  normalized: DocumentModel | null;
  changeSet: DataChangeSet | null;
  validation: ValidationResult | null;
  exportSnapshot: {
    artifactCount: number;
    warnings: string[];
    artifacts: Array<{
      fileName: string;
      recordCount: number;
      mediaType: string;
      targetPath?: string | null;
    }>;
  } | null;
}) {
  const summaryCards = [
    {
      title: "Preview",
      body: props.preview
        ? `${props.preview.sheets.length} sheets, ${props.preview.warnings.length} warnings`
        : "No preview executed yet"
    },
    {
      title: "Normalize",
      body: props.normalized
        ? `${props.normalized.sheets.reduce((sum, sheet) => sum + sheet.tables.length, 0)} tables normalized`
        : "No normalization result yet"
    },
    {
      title: "Changes",
      body: props.changeSet
        ? `${props.changeSet.addedCount} added, ${props.changeSet.modifiedCount} modified, ${props.changeSet.removedCount} removed`
        : "No change baseline captured yet"
    },
    {
      title: "Validate",
      body: props.validation
        ? `${props.validation.summary.errorCount} errors, ${props.validation.summary.warningCount} warnings`
        : "No validation result yet"
    },
    {
      title: "Export",
      body: props.exportSnapshot
        ? `${props.exportSnapshot.artifactCount} artifacts generated`
        : "No export result yet"
    }
  ];

  return (
    <div className="card-list summary-list">
      {summaryCards.map((card) => (
        <div className="card" key={card.title}>
          <div className="card-header">
            <h3>{card.title}</h3>
          </div>
          <p>{card.body}</p>
        </div>
      ))}
    </div>
  );
}

function ResultTabs(props: {
  activeView: ResultView;
  onChange: (view: ResultView) => void;
}) {
  const tabs: Array<{ id: ResultView; label: string }> = [
    { id: "preview", label: "Preview" },
    { id: "records", label: "Records" },
    { id: "changes", label: "Changes" },
    { id: "findings", label: "Findings" },
    { id: "export", label: "Export" },
    { id: "raw", label: "Raw JSON" }
  ];

  return (
    <div className="tab-row" role="tablist" aria-label="Result views">
      {tabs.map((tab) => (
        <button
          className={props.activeView === tab.id ? "tab-button tab-button-active" : "tab-button"}
          key={tab.id}
          onClick={() => props.onChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function PreviewDrillDown(props: {
  preview: WorkbookPreview | null;
  selectedSheet: SheetPreview | null;
  selectedTable: TablePreview | null;
  onSelectSheet: (sheet: SheetPreview) => void;
  onSelectTable: (table: TablePreview) => void;
}) {
  if (!props.preview) {
    return <EmptyState title="No preview data" detail="Run Preview to inspect workbook sheets and table regions." />;
  }

  return (
    <div className="drilldown-layout">
      <aside className="navigator-pane">
        <h3>Sheets</h3>
        <div className="nav-list">
          {props.preview.sheets.map((sheet) => (
            <button
              className={props.selectedSheet?.id === sheet.id ? "nav-item nav-item-active" : "nav-item"}
              key={sheet.id}
              onClick={() => props.onSelectSheet(sheet)}
              type="button"
            >
              <span>{sheet.name}</span>
              <small>{sheet.tables.length} tables</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="detail-pane">
        <div className="section-header compact-header">
          <div>
            <h3>{props.selectedSheet?.name ?? "Sheet"}</h3>
            <p className="caption">
              {props.selectedSheet
                ? `${props.selectedSheet.usedRange || "empty"} · ${props.selectedSheet.rowCount} rows · ${props.selectedSheet.columnCount} columns`
                : "No sheet selected"}
            </p>
          </div>
        </div>
        <div className="table-selector">
          {(props.selectedSheet?.tables ?? []).map((table) => (
            <button
              className={props.selectedTable?.id === table.id ? "mini-button mini-button-active" : "mini-button"}
              key={table.id}
              onClick={() => props.onSelectTable(table)}
              type="button"
            >
              {table.range}
            </button>
          ))}
        </div>
        {props.selectedTable ? <PreviewTable table={props.selectedTable} /> : <EmptyState title="No table selected" />}
      </section>
    </div>
  );
}

function PreviewTable(props: { table: TablePreview }) {
  const rows = props.table.rows.slice(0, 25);
  const maxColumnCount = Math.max(...rows.map((row) => row.length), 0);

  return (
    <div className="table-frame">
      <div className="table-meta">
        <span>{props.table.title ?? "Detected table"}</span>
        <span>{props.table.nonEmptyCellCount} populated cells</span>
        <span>{props.table.headerRowIndex ? `Header row ${props.table.headerRowIndex}` : "Header unknown"}</span>
      </div>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Row</th>
              {Array.from({ length: maxColumnCount }, (_, index) => (
                <th key={index}>C{index + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${props.table.id}-${rowIndex}`}>
                <th>{rowIndex + 1}</th>
                {Array.from({ length: maxColumnCount }, (_, columnIndex) => (
                  <td
                    className={cellClassName(row[columnIndex])}
                    key={columnIndex}
                    style={cellStyle(row[columnIndex])}
                    title={cellMetadataTitle(row[columnIndex])}
                  >
                    {cellText(row[columnIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordsDrillDown(props: {
  tables: TableModel[];
  selectedTable: TableModel | null;
  onSelectTable: (table: TableModel) => void;
}) {
  if (!props.tables.length) {
    return <EmptyState title="No normalized records" detail="Run Normalize to convert detected tables into fields and records." />;
  }

  return (
    <div className="drilldown-layout">
      <aside className="navigator-pane">
        <h3>Tables</h3>
        <div className="nav-list">
          {props.tables.map((table) => (
            <button
              className={props.selectedTable?.id === table.id ? "nav-item nav-item-active" : "nav-item"}
              key={table.id}
              onClick={() => props.onSelectTable(table)}
              type="button"
            >
              <span>{table.title ?? table.sheetName}</span>
              <small>{table.records.length} records</small>
            </button>
          ))}
        </div>
      </aside>
      <section className="detail-pane">
        {props.selectedTable ? <RecordTable table={props.selectedTable} /> : <EmptyState title="No table selected" />}
      </section>
    </div>
  );
}

function RecordTable(props: { table: TableModel }) {
  const fields = props.table.fields;
  const records = props.table.records.slice(0, 50);

  return (
    <div className="table-frame">
      <div className="section-header compact-header">
        <div>
          <h3>{props.table.title ?? props.table.sheetName}</h3>
          <p className="caption">
            {props.table.range} · {props.table.fields.length} fields · {props.table.records.length} records
          </p>
        </div>
      </div>
      {props.table.warnings.length ? (
        <div className="warning-strip">{props.table.warnings.join(" ")}</div>
      ) : null}
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Row</th>
              {fields.map((field) => (
                <th key={field.key}>{field.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.rowIndex}>
                <th>{record.rowIndex}</th>
                {fields.map((field) => (
                  <td key={field.key}>{recordValue(record, field.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChangesView(props: { changeSet: DataChangeSet | null }) {
  if (!props.changeSet) {
    return <EmptyState title="No change data" detail="Run Normalize to capture a comparison baseline." />;
  }

  if (!props.changeSet.previousSnapshotAt) {
    return (
      <EmptyState
        title="Baseline captured"
        detail="This is the first normalized snapshot for the workbook. Run Normalize again after data changes to see a visual diff."
      />
    );
  }

  if (!props.changeSet.entries.length) {
    return (
      <EmptyState
        title="No data changes"
        detail={`Compared with baseline from ${formatTimestamp(props.changeSet.previousSnapshotAt)}.`}
      />
    );
  }

  return (
    <div className="changes-layout">
      <div className="change-summary-grid">
        <ChangeTile label="Added" value={props.changeSet.addedCount} tone="added" />
        <ChangeTile label="Modified" value={props.changeSet.modifiedCount} tone="modified" />
        <ChangeTile label="Removed" value={props.changeSet.removedCount} tone="removed" />
      </div>
      <div className={props.changeSet.logError ? "warning-strip" : "notice-banner"}>
        {props.changeSet.logError
          ? `Change log was not written: ${props.changeSet.logError}`
          : props.changeSet.logPath
            ? `Change log appended: ${props.changeSet.logPath}`
            : "Changes detected locally. Log file will be written when the backend accepts the audit request."}
      </div>
      <div className="change-list">
        {props.changeSet.entries.map((entry) => (
          <ChangeRow entry={entry} key={entry.id} />
        ))}
      </div>
    </div>
  );
}

function ChangeTile(props: {
  label: string;
  value: number;
  tone: ChangeKind;
}) {
  return (
    <div className={`change-tile change-tile-${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function ChangeRow(props: { entry: DataChangeEntry }) {
  return (
    <article className={`change-row change-row-${props.entry.changeType}`}>
      <div>
        <span className={`change-badge change-badge-${props.entry.changeType}`}>
          {changeTypeLabel(props.entry.changeType)}
        </span>
        <strong>{props.entry.label}</strong>
        <p>
          {props.entry.sheetName} · {props.entry.sourceAddress || "n/a"} · row {props.entry.rowIndex}
        </p>
      </div>
      <dl>
        <div>
          <dt>Table</dt>
          <dd>{props.entry.tableId}</dd>
        </div>
        <div>
          <dt>Field</dt>
          <dd>{props.entry.fieldKey}</dd>
        </div>
      </dl>
      <div className="change-values">
        <div>
          <span>Old</span>
          <code>{formatChangeValue(props.entry.oldValue)}</code>
        </div>
        <div>
          <span>New</span>
          <code>{formatChangeValue(props.entry.newValue)}</code>
        </div>
      </div>
    </article>
  );
}

function FindingsView(props: { validation: ValidationResult | null }) {
  if (!props.validation) {
    return <EmptyState title="No validation result" detail="Run Validate to review data quality findings." />;
  }

  return (
    <div className="findings-layout">
      <div className="severity-grid">
        <SeverityTile label="Critical" value={props.validation.summary.criticalCount} tone="critical" />
        <SeverityTile label="Errors" value={props.validation.summary.errorCount} tone="error" />
        <SeverityTile label="Warnings" value={props.validation.summary.warningCount} tone="warning" />
        <SeverityTile label="Info" value={props.validation.summary.infoCount} tone="info" />
      </div>
      <div className="finding-list">
        {props.validation.findings.length ? (
          props.validation.findings.map((finding) => <FindingRow finding={finding} key={finding.id} />)
        ) : (
          <EmptyState title="No findings" detail="The current validation profile did not report issues." />
        )}
      </div>
    </div>
  );
}

function ExportArtifactsView(props: {
  exportSnapshot: ReturnType<typeof buildExportSnapshot> | null;
}) {
  if (!props.exportSnapshot) {
    return <EmptyState title="No export result" detail="Run Export to generate CSV, JSON, or XML artifacts." />;
  }

  return (
    <div className="artifact-list">
      {props.exportSnapshot.artifacts.map((artifact) => (
        <div className="artifact-row" key={artifact.fileName}>
          <div>
            <strong>{artifact.fileName}</strong>
            <span>{artifact.mediaType}</span>
          </div>
          <div>
            <strong>{artifact.recordCount}</strong>
            <span>records</span>
          </div>
          <code>{artifact.targetPath ?? "in-memory artifact"}</code>
        </div>
      ))}
      {props.exportSnapshot.warnings.length ? (
        <div className="warning-strip">{props.exportSnapshot.warnings.join(" ")}</div>
      ) : null}
    </div>
  );
}

function SeverityTile(props: {
  label: string;
  value: number;
  tone: "critical" | "error" | "warning" | "info";
}) {
  return (
    <div className={`severity-tile severity-${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function FindingRow(props: { finding: ValidationFinding }) {
  return (
    <article className={`finding-row finding-${props.finding.severity}`}>
      <div>
        <strong>{props.finding.code}</strong>
        <p>{props.finding.message}</p>
      </div>
      <dl>
        <div>
          <dt>Sheet</dt>
          <dd>{props.finding.sheetName ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Row</dt>
          <dd>{props.finding.rowIndex ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Cell</dt>
          <dd>{props.finding.cellAddress ?? "n/a"}</dd>
        </div>
      </dl>
    </article>
  );
}

function EmptyState(props: { title: string; detail?: string }) {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      {props.detail ? <span>{props.detail}</span> : null}
    </div>
  );
}

function cellText(cell?: CellPreview): string {
  if (!cell || cell.value === null || cell.value === undefined) {
    return "";
  }

  return String(cell.value);
}

function cellClassName(cell?: CellPreview): string | undefined {
  const classNames = [];
  if (cell?.isMerged) {
    classNames.push("merged-cell");
  }
  if (cell?.fillColor || cell?.fontColor) {
    classNames.push("formatted-cell");
  }
  if ((cell?.rowOutlineLevel ?? 0) > 0 || (cell?.columnOutlineLevel ?? 0) > 0) {
    classNames.push("grouped-cell");
  }

  return classNames.length ? classNames.join(" ") : undefined;
}

function cellStyle(cell?: CellPreview): CSSProperties | undefined {
  if (!cell) {
    return undefined;
  }

  const style: CSSProperties = {};
  if (isCssHexColor(cell.fillColor)) {
    style.backgroundColor = cell.fillColor;
  }
  if (isCssHexColor(cell.fontColor)) {
    style.color = cell.fontColor;
  }

  return Object.keys(style).length ? style : undefined;
}

function cellMetadataTitle(cell?: CellPreview): string | undefined {
  if (!cell) {
    return undefined;
  }

  const metadata = [];
  if (cell.isMerged) {
    metadata.push(`Merged ${cell.mergeRange ?? ""}${cell.mergeParent ? `, parent ${cell.mergeParent}` : ""}`.trim());
  }
  if ((cell.rowOutlineLevel ?? 0) > 0) {
    metadata.push(`Row group level ${cell.rowOutlineLevel}`);
  }
  if ((cell.columnOutlineLevel ?? 0) > 0) {
    metadata.push(`Column group level ${cell.columnOutlineLevel}`);
  }
  if (cell.rowHidden) {
    metadata.push("Hidden row");
  }
  if (cell.columnHidden) {
    metadata.push("Hidden column");
  }
  if (cell.fillColor) {
    metadata.push(`Fill ${cell.fillColor}`);
  }
  if (cell.fontColor) {
    metadata.push(`Font ${cell.fontColor}`);
  }

  return metadata.length ? metadata.join(" | ") : undefined;
}

function isCssHexColor(value?: string | null): value is string {
  return Boolean(value?.match(/^#[0-9A-Fa-f]{6}$/));
}

function recordValue(record: NormalizedRecord, fieldKey: string): string {
  const value = record.values.find((item) => item.fieldKey === fieldKey)?.value;
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function changeTypeLabel(changeType: ChangeKind): string {
  if (changeType === "added") {
    return "Added";
  }
  if (changeType === "removed") {
    return "Removed";
  }

  return "Modified";
}

function formatChangeValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }

  return String(value);
}

function defaultExportFileName(format: ExportDocumentRequest["format"]): string {
  return `document-export.${format}`;
}

function formToPresetSettings(form: FormState): PresetSettings {
  const { documentPath: _documentPath, exportOutputPath: _exportOutputPath, ...settings } = form;
  return settings;
}

function loadConfigurationPresets(): ConfigurationPreset[] {
  try {
    const rawValue = localStorage.getItem(configurationPresetStorageKey);
    if (!rawValue) {
      return [];
    }

    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isConfigurationPreset);
  } catch {
    return [];
  }
}

function persistConfigurationPresets(presets: ConfigurationPreset[]) {
  localStorage.setItem(configurationPresetStorageKey, JSON.stringify(presets));
}

function isConfigurationPreset(value: unknown): value is ConfigurationPreset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const preset = value as Partial<ConfigurationPreset>;
  return (
    typeof preset.id === "string" &&
    typeof preset.name === "string" &&
    typeof preset.createdAt === "string" &&
    typeof preset.updatedAt === "string" &&
    isPresetSettings(preset.settings)
  );
}

function isPresetSettings(value: unknown): value is PresetSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const settings = value as Partial<PresetSettings>;
  return (
    typeof settings.backendUrl === "string" &&
    typeof settings.sheetNames === "string" &&
    typeof settings.maxRowsPerSheet === "number" &&
    typeof settings.maxColumnsPerSheet === "number" &&
    typeof settings.maxTablesPerSheet === "number" &&
    typeof settings.includeHiddenSheets === "boolean" &&
    typeof settings.includeEmptyRecords === "boolean" &&
    typeof settings.preferFirstRowAsHeader === "boolean" &&
    typeof settings.requiredFieldKeys === "string" &&
    typeof settings.uniqueFieldSets === "string" &&
    typeof settings.detectOutlineGroups === "boolean" &&
    typeof settings.detectColorFormatting === "boolean" &&
    ["json", "csv", "xml"].includes(String(settings.exportFormat)) &&
    ["single-file", "per-table"].includes(String(settings.exportMode)) &&
    typeof settings.exportDelimiter === "string" &&
    typeof settings.exportMappingsJson === "string" &&
    typeof settings.xmlRootElement === "string" &&
    typeof settings.xmlRecordElement === "string" &&
    typeof settings.includeMetadata === "boolean"
  );
}

function exportTableIdsForRequest(tables: TableModel[], selectedTableIds: string[]): string[] {
  if (!selectedTableIds.length) {
    return [];
  }

  const availableTableIds = new Set(tables.map((table) => table.id));
  return selectedTableIds.filter((tableId) => availableTableIds.has(tableId));
}

function parseExportMappings(value: string): ExportFieldMapping[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Export mappings JSON must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Export mappings JSON must be an array.");
  }

  return parsed.map((item, index) => normalizeExportMapping(item, index));
}

function normalizeExportMapping(item: unknown, index: number): ExportFieldMapping {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`Export mapping #${index + 1} must be an object.`);
  }

  const record = item as Record<string, unknown>;
  const targetField = typeof record.targetField === "string" ? record.targetField.trim() : "";
  if (!targetField) {
    throw new Error(`Export mapping #${index + 1} requires a targetField string.`);
  }

  const transform = record.transform ?? "none";
  if (!["none", "string", "upper", "lower"].includes(String(transform))) {
    throw new Error(`Export mapping #${index + 1} has an unsupported transform.`);
  }

  return {
    targetField,
    sourceFieldKey:
      typeof record.sourceFieldKey === "string" && record.sourceFieldKey.trim()
        ? record.sourceFieldKey.trim()
        : null,
    defaultValue: normalizeDefaultValue(record.defaultValue),
    transform: transform as ExportFieldMapping["transform"]
  };
}

function normalizeDefaultValue(value: unknown): ExportFieldMapping["defaultValue"] {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value ?? null;
  }

  throw new Error("Export mapping defaultValue must be a string, number, boolean, null, or omitted.");
}
