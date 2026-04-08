#!/usr/bin/env bash
# Topgun AI — dev starter
#
# Starts the FastAPI backend and Next.js frontend in two background
# processes. Kills both on Ctrl-C. For more control, run each app by hand
# per the README.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[topgun] starting backend on :8000"
(
  cd "$ROOT/backend"
  if [[ ! -d .venv ]]; then
    echo "[topgun] creating backend venv"
    python -m venv .venv
    ./.venv/bin/pip install -q -r requirements.txt
  fi
  ./.venv/bin/uvicorn app.main:app --reload --port 8000
) &
BACKEND_PID=$!

echo "[topgun] starting frontend on :3000"
(
  cd "$ROOT/frontend"
  if [[ ! -d node_modules ]]; then
    echo "[topgun] installing frontend deps"
    npm install
  fi
  npm run dev
) &
FRONTEND_PID=$!

wait
