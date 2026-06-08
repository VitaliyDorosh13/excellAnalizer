#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/app/frontend"
NODE_BIN="${ROOT_DIR}/.tooling/node/bin/node"
NPM_BIN="${ROOT_DIR}/.tooling/node/bin/npm"
PATH="${ROOT_DIR}/.tooling/node/bin:${ROOT_DIR}/.tooling/cargo/bin:${PATH}"

if [[ ! -x "${NODE_BIN}" || ! -x "${NPM_BIN}" ]]; then
  echo "Local Node toolchain is missing. Run install-local-node.sh first." >&2
  exit 1
fi

echo "Installing frontend dependencies..."
cd "${FRONTEND_DIR}"
"${NPM_BIN}" install

echo "Frontend dependencies installed."
