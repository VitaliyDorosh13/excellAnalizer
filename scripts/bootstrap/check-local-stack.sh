#!/usr/bin/env bash
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:4173}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"

EXIT_CODE=0

if curl -fsSI "${FRONTEND_URL}/" >/dev/null; then
  echo "frontend ok: ${FRONTEND_URL}/"
else
  echo "frontend unavailable: ${FRONTEND_URL}/" >&2
  EXIT_CODE=1
fi

if curl -fsS "${BACKEND_URL}/health" >/dev/null; then
  echo "backend ok: ${BACKEND_URL}/health"
else
  echo "backend unavailable: ${BACKEND_URL}/health" >&2
  EXIT_CODE=1
fi

exit "${EXIT_CODE}"
