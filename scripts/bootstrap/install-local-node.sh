#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLING_DIR="${ROOT_DIR}/.tooling"
NODE_DIR="${TOOLING_DIR}/node"
TMP_DIR="${TOOLING_DIR}/tmp"
ARCH="$(uname -m)"
PLATFORM="darwin"

mkdir -p "${NODE_DIR}" "${TMP_DIR}"

case "${ARCH}" in
  arm64)
    NODE_ARCH="arm64"
    ;;
  x86_64)
    NODE_ARCH="x64"
    ;;
  *)
    echo "Unsupported architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

if [[ -x "${NODE_DIR}/bin/node" && -x "${NODE_DIR}/bin/npm" ]]; then
  echo "Local Node toolchain already installed in ${NODE_DIR}"
  exit 0
fi

echo "Resolving latest Node 22.x binary for ${PLATFORM}-${NODE_ARCH}..."
SHASUMS_URL="https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt"
SHASUMS_FILE="${TMP_DIR}/node-shasums.txt"
curl -fsSL "${SHASUMS_URL}" -o "${SHASUMS_FILE}"

ARCHIVE_NAME="$(python3 - <<'PY' "${SHASUMS_FILE}" "${PLATFORM}" "${NODE_ARCH}"
import pathlib
import sys

shasums_path = pathlib.Path(sys.argv[1])
platform = sys.argv[2]
arch = sys.argv[3]
needle = f"{platform}-{arch}.tar.gz"

for line in shasums_path.read_text(encoding="utf-8").splitlines():
    candidate = line.split()[-1]
    if candidate.startswith("node-v") and candidate.endswith(needle):
        print(candidate)
        raise SystemExit(0)

raise SystemExit("Unable to resolve a Node archive name from SHASUMS256.txt")
PY
)"

ARCHIVE_URL="https://nodejs.org/dist/latest-v22.x/${ARCHIVE_NAME}"
ARCHIVE_PATH="${TMP_DIR}/${ARCHIVE_NAME}"

echo "Downloading ${ARCHIVE_NAME}..."
curl -fsSL "${ARCHIVE_URL}" -o "${ARCHIVE_PATH}"

echo "Extracting Node toolchain into ${NODE_DIR}..."
rm -rf "${NODE_DIR}"
mkdir -p "${NODE_DIR}"
tar -xzf "${ARCHIVE_PATH}" -C "${NODE_DIR}" --strip-components=1

echo "Installed local Node:"
"${NODE_DIR}/bin/node" --version
"${NODE_DIR}/bin/npm" --version
