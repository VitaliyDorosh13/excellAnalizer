#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export CODEX_PROJECT_ROOT="${ROOT_DIR}"
source "${ROOT_DIR}/scripts/bootstrap/dev-env.sh"

FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"

cd "${ROOT_DIR}/app/frontend"
npm run dev -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}"
