#!/usr/bin/env bash
# Install, start, stop and inspect the Telegram <-> OpenCode bridge on macOS/Linux.
#
#   ./bridge.sh install --owner 123456789 --machine PC-02
#   ./bridge.sh start
#   ./bridge.sh status
#   ./bridge.sh logs
#   ./bridge.sh stop
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
CONFIG="$CONFIG_DIR/bridge.json"
PIDFILE="$CONFIG_DIR/bridge.pid"
LOG="$CONFIG_DIR/bridge.log"
ACTION="${1:-status}"
shift || true

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 18+ is required. Install it from https://nodejs.org." >&2
    exit 1
  fi
}

bridge_pid() {
  [ -f "$PIDFILE" ] && cat "$PIDFILE" 2>/dev/null || true
}

is_running() {
  pid="$(bridge_pid)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

show_tail() {
  lines="${1:-12}"
  if [ -f "$LOG" ]; then
    echo "--- last log lines ---"
    tail -n "$lines" "$LOG"
  fi
}

config_value() {
  file="$1"
  key="$2"
  BRIDGE_CONFIG="$file" BRIDGE_KEY="$key" node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.env.BRIDGE_CONFIG, "utf8").replace(/^\uFEFF/, ""));
      const v = c[process.env.BRIDGE_KEY];
      process.stdout.write(Array.isArray(v) ? v.join(", ") : String(v ?? ""));
    } catch {}
  '
}

install_bridge() {
  need_node
  OWNER=""
  MACHINE="$(hostname 2>/dev/null || echo unknown)"
  WORKDIR="$HOME/opencode-workspace"
  TOKEN=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --owner) OWNER="${2:-}"; shift 2 ;;
      --machine) MACHINE="${2:-}"; shift 2 ;;
      --workdir) WORKDIR="${2:-}"; shift 2 ;;
      --token) TOKEN="${2:-}"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
  done

  if [ -f "$CONFIG" ]; then
    echo "Config already exists: $CONFIG"
  else
    if [ -z "$OWNER" ]; then
      echo "Pass --owner <numeric Telegram user id> so only you can command the bot." >&2
      exit 2
    fi
    if [ -z "$TOKEN" ] && [ -f "$CONFIG_DIR/notify.json" ]; then
      TOKEN="$(config_value "$CONFIG_DIR/notify.json" bot_token)"
    fi
    mkdir -p "$CONFIG_DIR" "$WORKDIR"
    BRIDGE_CONFIG="$CONFIG" BRIDGE_TOKEN="$TOKEN" BRIDGE_MACHINE="$MACHINE" \
      BRIDGE_OWNER="$OWNER" BRIDGE_WORKDIR="$WORKDIR" node -e '
        const fs = require("fs");
        const config = {
          bot_token: process.env.BRIDGE_TOKEN || "",
          machine: process.env.BRIDGE_MACHINE,
          allowed_user_ids: [process.env.BRIDGE_OWNER],
          workdir: process.env.BRIDGE_WORKDIR,
          auto_approve: true,
          require_mention_in_groups: true,
          max_minutes: 15,
        };
        fs.writeFileSync(process.env.BRIDGE_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf8");
      '
    echo "Wrote $CONFIG"
    if [ ! -s "$CONFIG_DIR/notify.json" ] && [ -z "$TOKEN" ]; then
      echo "Warning: no bot token found. Add bot_token to bridge.json or notify.json." >&2
    fi
  fi

  echo ""
  echo "Next:"
  echo "  1. In a group, mention the bot or use /command@BotName."
  echo "  2. Start it:  ./bridge.sh start"
  echo "  3. Check:     ./bridge.sh status"
}

start_bridge() {
  need_node
  if is_running; then
    echo "Already running (PID $(bridge_pid))."
    return
  fi
  if [ ! -f "$CONFIG" ]; then
    echo "No config yet. Run: ./bridge.sh install --owner <your id>" >&2
    exit 2
  fi
  [ -f "$LOG" ] && mv "$LOG" "$LOG.1" 2>/dev/null || true
  nohup node "$DIR/bridge.mjs" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 3
  if ! is_running; then
    rm -f "$PIDFILE"
    echo "Bridge exited immediately." >&2
    show_tail 20
    exit 1
  fi
  echo "Started bridge (PID $(bridge_pid))."
  show_tail 5
}

stop_bridge() {
  if ! is_running; then
    echo "Not running."
    rm -f "$PIDFILE"
    return
  fi
  pid="$(bridge_pid)"
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PIDFILE"
  echo "Stopped PID $pid."
}

show_status() {
  if is_running; then
    echo "Bridge running (PID $(bridge_pid))."
  else
    echo "Bridge not running."
  fi
  if [ -f "$CONFIG" ]; then
    echo "Machine: $(config_value "$CONFIG" machine)"
    echo "Workdir: $(config_value "$CONFIG" workdir)"
    echo "Allowed users: $(config_value "$CONFIG" allowed_user_ids)"
    if [ -n "$(config_value "$CONFIG" bot_token)" ]; then
      echo "Bot token: configured (in bridge.json)"
    elif [ -f "$CONFIG_DIR/notify.json" ] && [ -n "$(config_value "$CONFIG_DIR/notify.json" bot_token)" ]; then
      echo "Bot token: configured (from notify.json)"
    else
      echo "Bot token: MISSING"
    fi
  else
    echo "No config: $CONFIG"
  fi
  show_tail 10
}

case "$ACTION" in
  install) install_bridge "$@" ;;
  start) start_bridge ;;
  stop) stop_bridge ;;
  restart) stop_bridge; sleep 1; start_bridge ;;
  status) show_status ;;
  logs) show_tail 40 ;;
  *)
    echo "Usage: ./bridge.sh {install|start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
