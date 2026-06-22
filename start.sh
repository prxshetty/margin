#!/usr/bin/env bash
# start.sh — works on macOS and Linux
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# ── Python environment ──────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

# ── Node environment ────────────────────────────────────────────────────────
if [ ! -d "ui/node_modules" ]; then
  echo "Installing frontend dependencies..."
  (cd ui && npm install)
fi

# ── Launch ──────────────────────────────────────────────────────────────────
echo ""
echo "Starting SLM Writing Engine..."
echo "  API  → http://localhost:8000"
echo "  UI   → http://localhost:5173"
echo ""

# Run API and UI in parallel; kill both when either exits
trap 'kill 0' EXIT

uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload &
(cd ui && npm run dev) &

wait
