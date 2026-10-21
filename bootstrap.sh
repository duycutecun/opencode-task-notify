#!/bin/sh
# Downloads task-notify from GitHub and runs its installer.
# Works without git: only curl (or wget) and Node.js 18+ are required.
#
#   curl -fsSL https://raw.githubusercontent.com/duycutecun/opencode-task-notify/main/bootstrap.sh | sh -s -- --token "123456:ABC..." --chat-id "7152973094"

set -eu

REF="${TASK_NOTIFY_REF:-main}"
URL="https://github.com/duycutecun/opencode-task-notify/archive/refs/heads/${REF}.zip"
TMP="$(mktemp -d 2>/dev/null || mktemp -d -t task-notify)"
trap 'rm -rf "$TMP"' EXIT INT TERM

echo "==> Downloading opencode-task-notify (${REF})"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMP/repo.zip"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$URL" -O "$TMP/repo.zip"
else
  echo "Need curl or wget to download the repository." >&2
  exit 1
fi

echo "==> Extracting"
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$TMP/repo.zip" -d "$TMP"
else
  python3 -m zipfile -e "$TMP/repo.zip" "$TMP"
fi

ROOT="$(find "$TMP" -maxdepth 1 -type d -name 'opencode-task-notify-*' | head -n 1)"
if [ -z "$ROOT" ] || [ ! -f "$ROOT/install.sh" ]; then
  echo "Could not find install.sh in the downloaded archive." >&2
  exit 1
fi

echo "==> Running installer"
chmod +x "$ROOT/install.sh"
"$ROOT/install.sh" "$@"

echo ""
echo "Done. Restart OpenCode, then verify:"
echo '  node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --whoami'
echo '  node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --test'
