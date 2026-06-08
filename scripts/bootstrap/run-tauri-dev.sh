#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export CODEX_PROJECT_ROOT="${ROOT_DIR}"
source "${ROOT_DIR}/scripts/bootstrap/dev-env.sh"

cd "${ROOT_DIR}/app/frontend"
npm run tauri:dev
