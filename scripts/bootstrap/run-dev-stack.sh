#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:4173}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
LOG_DIR="${ROOT_DIR}/tmp"
BACKEND_PID=""
FRONTEND_PID=""

mkdir -p "${LOG_DIR}"

is_healthy() {
  curl -fsS "$1" >/dev/null 2>&1
}

wait_for_service() {
  local name="$1"
  local url="$2"
  local log_file="$3"

  for _ in {1..60}; do
    if is_healthy "${url}"; then
      echo "${name} ready: ${url}"
      return 0
    fi
    sleep 1
  done

  echo "${name} did not become ready. Recent log output:" >&2
  tail -n 80 "${log_file}" >&2 || true
  return 1
}

cleanup() {
  if [[ -n "${FRONTEND_PID}" ]]; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if is_healthy "${BACKEND_URL}/health"; then
  echo "backend already running: ${BACKEND_URL}/health"
else
  echo "starting backend..."
  "${ROOT_DIR}/scripts/bootstrap/run-backend.sh" > "${LOG_DIR}/backend.log" 2>&1 &
  BACKEND_PID="$!"
fi

if is_healthy "${FRONTEND_URL}/"; then
  echo "frontend already running: ${FRONTEND_URL}/"
else
  echo "starting frontend..."
  "${ROOT_DIR}/scripts/bootstrap/run-frontend.sh" > "${LOG_DIR}/frontend.log" 2>&1 &
  FRONTEND_PID="$!"
fi

wait_for_service "backend" "${BACKEND_URL}/health" "${LOG_DIR}/backend.log"
wait_for_service "frontend" "${FRONTEND_URL}/" "${LOG_DIR}/frontend.log"

echo
echo "local stack is ready"
echo "frontend: ${FRONTEND_URL}/"
echo "backend:  ${BACKEND_URL}/health"
echo "logs:     ${LOG_DIR}/backend.log and ${LOG_DIR}/frontend.log"
echo
echo "Press Ctrl+C to stop services started by this script."

while true; do
  sleep 3600
done
