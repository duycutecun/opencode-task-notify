#!/usr/bin/env bash
# Installs the OpenCode task-notify skill on macOS / Linux.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install it from https://nodejs.org and run this script again." >&2
  exit 1
fi

exec node "$DIR/install.mjs" "$@"
