#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_BIN="${VENV_BIN:-$ROOT_DIR/.venv/bin}"

cd "$ROOT_DIR"
exec "$VENV_BIN/gunicorn" -c "$ROOT_DIR/gunicorn.conf.py" wsgi:app
