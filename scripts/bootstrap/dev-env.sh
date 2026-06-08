#!/usr/bin/env bash

if [[ -n "${CODEX_PROJECT_ROOT:-}" ]]; then
  ROOT_DIR="${CODEX_PROJECT_ROOT}"
else
  ROOT_DIR="$(pwd)"
fi

if [[ ! -d "${ROOT_DIR}/app/frontend" || ! -d "${ROOT_DIR}/app/backend" ]]; then
  echo "dev-env.sh expects CODEX_PROJECT_ROOT to be set or to be sourced from the repository root." >&2
  return 1 2>/dev/null || exit 1
fi

export PATH="${ROOT_DIR}/.tooling/node/bin:${ROOT_DIR}/.tooling/cargo/bin:${PATH}"
export CARGO_HOME="${ROOT_DIR}/.tooling/cargo"
export RUSTUP_HOME="${ROOT_DIR}/.tooling/rustup"

if [[ -d "${ROOT_DIR}/app/backend/.venv" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/app/backend/.venv/bin/activate"
fi
