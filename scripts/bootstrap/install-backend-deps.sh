#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/app/backend"
VENV_DIR="${BACKEND_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PIP_CACHE_DIR="${ROOT_DIR}/.tooling/pip-cache"

mkdir -p "${PIP_CACHE_DIR}"

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "Creating backend virtual environment..."
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

echo "Installing backend dependencies..."
"${VENV_DIR}/bin/pip" install --cache-dir "${PIP_CACHE_DIR}" --upgrade pip setuptools wheel
"${VENV_DIR}/bin/pip" install --cache-dir "${PIP_CACHE_DIR}" -e "${BACKEND_DIR}"

echo "Installed backend dependencies into ${VENV_DIR}"
