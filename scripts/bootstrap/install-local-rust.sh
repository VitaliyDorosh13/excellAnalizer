#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLING_DIR="${ROOT_DIR}/.tooling"
RUSTUP_HOME="${TOOLING_DIR}/rustup"
CARGO_HOME="${TOOLING_DIR}/cargo"
TMP_DIR="${TOOLING_DIR}/tmp"
INSTALLER_PATH="${TMP_DIR}/rustup-init.sh"

mkdir -p "${RUSTUP_HOME}" "${CARGO_HOME}" "${TMP_DIR}"

if [[ -x "${CARGO_HOME}/bin/cargo" && -x "${CARGO_HOME}/bin/rustc" ]]; then
  echo "Local Rust toolchain already installed in ${CARGO_HOME}"
  exit 0
fi

echo "Downloading rustup installer..."
curl https://sh.rustup.rs -sSf -o "${INSTALLER_PATH}"

echo "Installing Rust toolchain into workspace-local directories..."
env \
  CARGO_HOME="${CARGO_HOME}" \
  RUSTUP_HOME="${RUSTUP_HOME}" \
  sh "${INSTALLER_PATH}" -y --profile minimal --default-toolchain stable --no-modify-path

echo "Installed local Rust:"
env CARGO_HOME="${CARGO_HOME}" RUSTUP_HOME="${RUSTUP_HOME}" "${CARGO_HOME}/bin/rustc" --version
env CARGO_HOME="${CARGO_HOME}" RUSTUP_HOME="${RUSTUP_HOME}" "${CARGO_HOME}/bin/cargo" --version
