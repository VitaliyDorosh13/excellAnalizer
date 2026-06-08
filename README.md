# Document Analysis Platform

Cross-platform desktop application concept for reading, analyzing, importing, exporting, and extending processing of Excel-based engineering documents with optional plugins for PDF and other formats.

## Documents

- [Requirements Specification](./docs/requirements-spec.md)
- [Architecture Overview](./docs/architecture.md)
- [Roadmap and Backlog](./docs/roadmap-backlog.md)
- [PDF Parsing and Excel Comparison Plan](./docs/pdf-excel-comparison-plan.md)
- [Project Structure](./docs/project-structure.md)
- [Bootstrap Guide](./docs/bootstrap.md)

## Proposed Technology Stack

- Desktop shell: Tauri
- Frontend: React + TypeScript
- Processing engine: Python
- Local storage: SQLite
- Plugin packaging: signed plugin bundles with manifest-based registration

## Scope of the First Iteration

- Import multi-sheet Excel workbooks
- Normalize workbook structure into a common internal model
- Visually compare normalized workbook changes between runs
- Run configurable validation and analysis rules
- Support import/export profiles for external systems
- Prepare plugin SDK for PDF and future formats

## Repository Modules

- `app/frontend`: Tauri + React desktop shell
- `app/backend`: Python processing engine and local API
- `app/shared`: shared contracts and schemas
- `plugins`: sample and future extension packages

## Local Development

Start or recover the local web stack:

```bash
./scripts/bootstrap/run-dev-stack.sh
```

Check whether the local frontend and backend are currently reachable:

```bash
./scripts/bootstrap/check-local-stack.sh
```

Change tracking audit entries are appended to `tmp/document-change-log.jsonl` after a second and later Normalize run detects added, modified, or removed normalized values for the same workbook path.
