# Bootstrap Guide

## Current State

The repository contains a manual starter skeleton for a Tauri + React + Python desktop application. It is structured so the team can begin implementation even before the local machine has all required package managers and compilers installed.

## Required Tooling

- Node.js 20+
- npm or pnpm
- Rust toolchain with `cargo` and `rustc`
- Python 3.9+

## Workspace-Local Bootstrap

This repository now includes scripts that install toolchains into the workspace instead of the global system.

From the repository root:

```bash
./scripts/bootstrap/install-local-node.sh
./scripts/bootstrap/install-local-rust.sh
./scripts/bootstrap/install-backend-deps.sh
./scripts/bootstrap/install-frontend-deps.sh
source ./scripts/bootstrap/dev-env.sh
```

## Recommended Setup Steps

### Quick Local Web Stack

To start or recover the local browser-based development stack:

```bash
./scripts/bootstrap/run-dev-stack.sh
```

This starts the backend on `http://127.0.0.1:8000` and the frontend on `http://127.0.0.1:4173`.
If either service is already running, the script reuses it and only starts the missing part. Logs are written to `tmp/backend.log` and `tmp/frontend.log`.

To diagnose the current local status without starting anything:

```bash
./scripts/bootstrap/check-local-stack.sh
```

### 1. Frontend and Tauri

From `app/frontend`:

```bash
npm install
npm run tauri:dev
```

### 2. Backend

From `app/backend`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
python -m document_platform_backend.main
```

Workbook preview endpoint after startup:

```bash
curl -X POST http://127.0.0.1:8000/documents/preview \
  -H "Content-Type: application/json" \
  -d '{
    "document_path": "/absolute/path/to/workbook.xlsx",
    "max_rows_per_sheet": 100,
    "max_columns_per_sheet": 40,
    "max_tables_per_sheet": 12,
    "include_hidden_sheets": true
  }'
```

The preview response now includes sheet metadata and a `tables` array with heuristic table regions detected inside each sheet.

Normalized document endpoint:

```bash
curl -X POST http://127.0.0.1:8000/documents/normalize \
  -H "Content-Type: application/json" \
  -d '{
    "document_path": "/absolute/path/to/workbook.xlsx",
    "max_rows_per_sheet": 100,
    "max_columns_per_sheet": 40,
    "max_tables_per_sheet": 12,
    "include_hidden_sheets": true,
    "include_empty_records": false,
    "prefer_first_row_as_header": false
  }'
```

This response adds normalized `fields` and row-level `records` for each extracted table.

Validation endpoint:

```bash
curl -X POST http://127.0.0.1:8000/documents/validate \
  -H "Content-Type: application/json" \
  -d '{
    "document_path": "/absolute/path/to/workbook.xlsx",
    "required_field_keys": ["id", "name"],
    "unique_field_sets": [["id"]],
    "detect_type_mismatches": true,
    "enforce_non_empty_tables": true
  }'
```

Validation v1 currently checks:

- missing required columns
- empty required values
- duplicate records for configured or inferred key fields
- mixed data types inside a normalized field
- empty normalized tables

Export endpoint:

```bash
curl -X POST http://127.0.0.1:8000/documents/export \
  -H "Content-Type: application/json" \
  -d '{
    "document_path": "/absolute/path/to/workbook.xlsx",
    "format": "json",
    "output_mode": "per-table",
    "include_metadata": true,
    "mappings": [
      {
        "target_field": "asset_id",
        "source_field_key": "id"
      },
      {
        "target_field": "asset_name",
        "source_field_key": "name",
        "transform": "string"
      }
    ]
  }'
```

Export v1 currently supports:

- `CSV`, `JSON`, and `XML`
- `single-file` or `per-table` artifacts
- field mappings with rename and default values
- simple text transforms: `string`, `upper`, `lower`
- optional write-to-disk via `output_path`

### 3. Development Workflow

- Run the Python backend on `http://127.0.0.1:8000`
- Run the Tauri frontend in dev mode
- Use plugin manifests from `plugins/`

### 4. Recommended Local Run Commands

After `source ./scripts/bootstrap/dev-env.sh`:

```bash
cd app/backend
python -m document_platform_backend.main
```

In a second terminal:

```bash
source ./scripts/bootstrap/dev-env.sh
cd app/frontend
npm run tauri:dev
```

Equivalent convenience scripts:

```bash
./scripts/bootstrap/run-backend.sh
./scripts/bootstrap/run-frontend.sh
./scripts/bootstrap/run-tauri-dev.sh
```

For the browser-based local console, prefer:

```bash
./scripts/bootstrap/run-dev-stack.sh
```

## Suggested Next Build Steps

1. Install missing Node package manager and Rust toolchain
2. Initialize frontend dependencies
3. Initialize backend virtual environment
4. Wire frontend health check to backend service
5. Add Excel parser v1 and plugin registry tests
