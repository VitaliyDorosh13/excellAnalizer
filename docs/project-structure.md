# Suggested Repository Structure

```text
.
|-- README.md
|-- .gitignore
|-- docs/
|   |-- requirements-spec.md
|   |-- architecture.md
|   |-- roadmap-backlog.md
|   |-- pdf-excel-comparison-plan.md
|   |-- bootstrap.md
|   `-- project-structure.md
|-- app/
|   |-- frontend/
|   |   |-- package.json
|   |   |-- tsconfig.json
|   |   |-- vite.config.ts
|   |   |-- index.html
|   |   |-- src/
|   |   `-- src-tauri/
|   |-- backend/
|   |   |-- pyproject.toml
|   |   `-- src/
|   `-- shared/
|       |-- README.md
|       `-- contracts/
`-- plugins/
    |-- README.md
    `-- sample-pdf-plugin/
```

## Notes

- `app/frontend` will host the Tauri + React desktop UI.
- `app/backend` will host the Python processing engine.
- `app/shared` will contain contracts and schemas shared between modules.
- `plugins` will contain optional extension packages and sample plugin implementations.
