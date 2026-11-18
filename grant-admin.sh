#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "Usage: bash grant-admin.sh USERNAME" >&2; exit 2; fi
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"
export SCARAIM_DATA_DIR="${SCARAIM_DATA_DIR:-$ROOT/backend/data}"
cargo run --locked -- --set-admin "$1"
