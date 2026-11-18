#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v cargo >/dev/null || { echo "Install Rust using rustup first." >&2; exit 1; }
command -v npm >/dev/null || { echo "Install Node.js 22.12+ first." >&2; exit 1; }
cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then npm ci; fi
npm run build
cd "$ROOT/backend"
cargo build --locked
export SCARAIM_DATA_DIR="${SCARAIM_DATA_DIR:-$ROOT/backend/data}"
export FRONTEND_DIR="${FRONTEND_DIR:-$ROOT/frontend/dist}"
exec "${CARGO_TARGET_DIR:-target}/debug/scaraim" "$@"
