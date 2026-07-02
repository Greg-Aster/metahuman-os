#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/robot-friend.config.json"
EXAMPLE_CONFIG="$SCRIPT_DIR/robot-friend.config.example.json"
HOST_OVERRIDE="${ROBOT_FRIEND_HOST:-0.0.0.0}"
PORT_OVERRIDE="${ROBOT_FRIEND_PORT:-}"
HTTPS_OVERRIDE="${ROBOT_FRIEND_HTTPS:-}"
HTTPS_KEY="${ROBOT_FRIEND_HTTPS_KEY:-}"
HTTPS_CERT="${ROBOT_FRIEND_HTTPS_CERT:-}"

usage() {
  cat <<USAGE
Usage: ./start.sh [--local] [--https --key PATH --cert PATH] [--host HOST] [--port PORT]

Options:
  --local       Listen only on this computer.
  --https       Serve HTTPS. Requires --key and --cert, or config app.https paths.
  --http        Force plain HTTP.
  --key PATH    TLS private key path, relative to apps/robot-friend or absolute.
  --cert PATH   TLS certificate path, relative to apps/robot-friend or absolute.
  --host HOST   Override app.host for this run.
  --port PORT   Override app.port for this run.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      HOST_OVERRIDE="127.0.0.1"
      shift
      ;;
    --https)
      HTTPS_OVERRIDE="1"
      shift
      ;;
    --http)
      HTTPS_OVERRIDE="0"
      shift
      ;;
    --key)
      HTTPS_KEY="${2:-}"
      shift 2
      ;;
    --cert)
      HTTPS_CERT="${2:-}"
      shift 2
      ;;
    --host)
      HOST_OVERRIDE="${2:-}"
      shift 2
      ;;
    --port)
      PORT_OVERRIDE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[robot-friend] Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cd "$SCRIPT_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[robot-friend] No robot-friend.config.json found."
  echo "[robot-friend] Copy the example when you are ready to connect:"
  echo "  cp \"$EXAMPLE_CONFIG\" \"$CONFIG_FILE\""
  echo
  echo "[robot-friend] Starting with safe defaults for UI preview."
fi

if [[ -f "$CONFIG_FILE" ]]; then
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$CONFIG_FILE" >/dev/null || {
    echo "[robot-friend] robot-friend.config.json is not valid JSON." >&2
    echo "[robot-friend] Fix the file or copy a fresh example from:" >&2
    echo "  $EXAMPLE_CONFIG" >&2
    exit 1
  }
fi

if [[ ! -f "$SCRIPT_DIR/dist/index.html" || ! -f "$SCRIPT_DIR/dist-server/server/index.js" ]]; then
  echo "[robot-friend] Build output missing; building first..."
  pnpm build
fi

export ROBOT_FRIEND_HOST="$HOST_OVERRIDE"

if [[ -n "$PORT_OVERRIDE" ]]; then
  export ROBOT_FRIEND_PORT="$PORT_OVERRIDE"
fi

if [[ -n "$HTTPS_OVERRIDE" ]]; then
  export ROBOT_FRIEND_HTTPS="$HTTPS_OVERRIDE"
fi

if [[ -n "$HTTPS_KEY" ]]; then
  export ROBOT_FRIEND_HTTPS_KEY="$HTTPS_KEY"
fi

if [[ -n "$HTTPS_CERT" ]]; then
  export ROBOT_FRIEND_HTTPS_CERT="$HTTPS_CERT"
fi

if [[ "${ROBOT_FRIEND_HTTPS:-}" == "1" || "${ROBOT_FRIEND_HTTPS:-}" == "true" ]]; then
  echo "[robot-friend] HTTPS mode enabled."
fi

if [[ "${ROBOT_FRIEND_HOST:-}" == "0.0.0.0" || "${ROBOT_FRIEND_HOST:-}" == "::" ]]; then
  echo "[robot-friend] LAN mode enabled. Use only on a trusted Wi-Fi network."
fi

echo "[robot-friend] Starting..."
exec pnpm start
