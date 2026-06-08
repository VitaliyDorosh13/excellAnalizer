# Roadmap and Backlog

## 1. Delivery Phases

### Phase 0. Discovery and Alignment

Duration: 2 to 3 weeks

Goals:

- Identify primary Excel templates and usage scenarios
- Define target integration systems
- Confirm compliance, security, and deployment constraints
- Collect representative sample documents

Deliverables:

- approved scope
- sample document catalog
- initial data dictionary
- integration shortlist

### Phase 1. Foundation and MVP Architecture

Duration: 2 weeks

Goals:

- Set up repository structure
- Define domain model and API contracts
- Establish Tauri, React, and Python integration
- Create local persistence and logging foundation

Deliverables:

- workspace skeleton
- core interfaces
- local settings store
- logging framework

### Phase 2. Excel Import and Parsing MVP

Duration: 3 to 5 weeks

Goals:

- Implement workbook ingestion
- Parse multiple sheets
- Detect tables and cell metadata
- Surface parsing diagnostics in UI

Deliverables:

- Excel parser v1
- document preview UI
- parser test dataset

### Phase 3. Normalization and Rule Engine

Duration: 3 to 4 weeks

Goals:

- Map workbook content into a unified schema
- Implement configurable validation rules
- Add cross-sheet consistency checks
- Present findings with severity and traceability

Deliverables:

- normalization engine v1
- rules engine v1
- saved mapping profiles
- findings dashboard

### Phase 4. Import/Export Framework

Duration: 3 to 5 weeks

Goals:

- Add export to CSV, JSON, and XML
- Define connector interface
- Build dry-run preview
- Support profile-based transformations

Deliverables:

- export engine v1
- connector SDK v1
- profile editor UI

### Phase 5. Plugin System and PDF Extension

Duration: 3 to 4 weeks

Goals:

- Implement plugin discovery and registration
- Add signed manifest validation
- Deliver sample PDF parser plugin
- Add plugin management UI

Deliverables:

- plugin manager v1
- plugin SDK v1
- PDF plugin proof of concept

### Phase 5A. PDF Parsing and Excel Comparison

Duration: 4 to 6 weeks

Goals:

- Parse text-based PDFs through the plugin system
- Normalize PDF tables into the shared comparison model
- Compare PDF records against Excel records by configured key fields
- Surface missing records, value mismatches, ambiguous matches, and low-confidence extraction findings
- Preserve traceability to PDF page regions and Excel cell addresses

Deliverables:

- PDF preview contract
- PDF parser plugin v1
- PDF normalization profile
- PDF-vs-Excel comparison endpoint
- side-by-side comparison UI
- comparison report export

### Phase 6. Hardening and Release Readiness

Duration: 2 to 3 weeks

Goals:

- Improve performance on large workbooks
- Strengthen logging and error recovery
- Complete packaging for supported OS targets
- Perform acceptance and regression testing

Deliverables:

- release candidate
- installation packages
- test report
- deployment guide

## 2. Backlog Structure

## Epic A. Platform Foundation

- Define repository layout for frontend, backend, shared contracts, and plugins
- Establish coding standards, branching strategy, and CI pipeline
- Create application settings and local storage layer
- Implement structured logging and run history

## Epic B. Document Ingestion

- Add workbook file selection and import workflow
- Parse workbook metadata
- Parse visible and hidden sheets
- Detect used ranges and candidate table regions
- Capture cell formatting, formulas, and merged-cell information
- Add parser error reporting

## Epic C. Data Modeling and Normalization

- Define internal document schema
- Define normalized business entity schema
- Build mapping profile structure
- Implement transformation pipeline for data types
- Support locale and unit normalization

## Epic D. Validation and Analysis

- Create rule definition format
- Implement mandatory field validation
- Implement type and range validation
- Implement duplicate detection
- Implement cross-sheet reference validation
- Build findings aggregation and severity scoring
- Add PDF-vs-Excel comparison findings and reconciliation summaries

## Epic E. User Experience

- Create import screen
- Create workbook explorer
- Create table preview view
- Create findings dashboard
- Create profile editor
- Create plugin management screen
- Create run history screen

## Epic F. Import/Export and Integrations

- Implement CSV export
- Implement JSON export
- Implement XML export
- Create REST connector contract
- Create database connector contract
- Add dry-run export validation

## Epic G. Plugin Platform

- Define plugin manifest schema
- Implement plugin loader
- Implement plugin permission model
- Implement compatibility checks
- Implement plugin install and enable flows
- Add sample rule plugin
- Add sample PDF parser plugin
- Add text-based PDF table parser plugin
- Add optional OCR plugin pathway for scanned PDFs

## Epic I. PDF and Excel Reconciliation

- Define PDF preview and normalization contracts
- Build PDF field mapping profile editor
- Implement exact and composite key matching
- Implement missing-record detection in both directions
- Implement field-level value mismatch detection
- Preserve traceability to Excel cell and PDF page coordinates
- Export comparison reports to JSON and CSV

## Epic H. Quality and Operations

- Build parser regression suite using sample workbooks
- Add performance benchmarks for large files
- Add telemetry and audit logging
- Create packaging and release automation
- Prepare user and admin documentation

## 3. Suggested Priorities

Priority 1:

- Foundation
- Excel parsing
- Internal model
- Basic validation
- CSV and JSON export

Priority 2:

- Profile editor
- XML export
- REST connectors
- Plugin manager
- PDF plugin
- PDF-vs-Excel comparison MVP

Priority 3:

- OCR pipeline
- Advanced anomaly detection
- Role-based access control
- Enterprise deployment options

## 4. Team Composition Suggestion

- 1 solution architect
- 1 frontend engineer
- 1 backend/data engineer
- 1 integration engineer
- 1 QA engineer
- 1 part-time product owner or business analyst

## 5. MVP Exit Criteria

- The application works on all target desktop platforms
- Sample Excel documents can be parsed and analyzed successfully
- Saved profiles can drive normalization and export
- Findings are visible and exportable
- A sample plugin can be installed and used without code changes in the core
