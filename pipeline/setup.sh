#!/usr/bin/env bash
# One-time setup for macOS / Linux: creates .venv with pinned dependencies.
# Usage (from the repository root):   bash pipeline/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo "==> 'uv' not found - installing it (https://docs.astral.sh/uv/)"
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh || true
  fi
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi

if command -v uv >/dev/null 2>&1; then
  echo "==> Creating .venv with Python 3.12 (uv downloads Python if needed)"
  uv venv --python 3.12 --allow-existing .venv
  uv pip install --python .venv -r requirements.txt
else
  echo "==> uv unavailable - falling back to python -m venv + pip"
  PY="$(command -v python3 || command -v python || true)"
  if [ -z "$PY" ]; then echo "ERROR: install Python 3.10+ first (https://www.python.org/downloads/)"; exit 1; fi
  "$PY" -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"'
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
fi

[ -f .env ] || cp .env.example .env

cat <<'MSG'

==> Setup complete. Next steps (from the repository root):

    source .venv/bin/activate
    python -m pipeline doctor
    python -m pipeline run --quick
    python -m pipeline run
    python -m pipeline publish

MSG
