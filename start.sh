#!/usr/bin/env bash
# Run this script with the user's active bash environment.

set -euo pipefail
# Stop on command errors, unset variables, and failed pipeline commands.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve the absolute directory containing this script.
REPO_ROOT="$SCRIPT_DIR"
# Treat the script directory as the MetaHuman repository root.
SERVER_ENTRY="$REPO_ROOT/apps/site/dist/server/entry.mjs"
# Point to the prebuilt Astro/Node production server entrypoint.
NODE_VERSION_FILE="$REPO_ROOT/.nvmrc"
# Pin the supported Node.js line for interactive and desktop launches.
NODE_VERSION_CHECK="$REPO_ROOT/scripts/check-node-runtime.mjs"
# Keep the executable runtime check shared with pnpm installs and CI.
LOG_DIR="$REPO_ROOT/logs"
# Store general runtime logs under logs/.
RUN_LOG_DIR="$LOG_DIR/run"
# Store launcher and PID-style runtime logs under logs/run/.
START_LOCK_FILE="$RUN_LOG_DIR/start.lock"
# Prevent overlapping launcher instances with a kernel lock that survives PID namespaces.
START_LOCK_FD=9
# Keep the lock on a dedicated file descriptor for the lifetime of this launcher.
SERVER_LOG="$LOG_DIR/server.log"
# Mirror web server output into this file for the in-app service console.
STARTED=false
# Track whether this script has started services and should clean them up.
CLEANING_UP=false
# Prevent the shutdown handler from running more than once.
START_LOCK_HELD=false
# Track whether this launcher owns the startup lock.

RED='\033[0;31m'
# Terminal color for errors.
GREEN='\033[0;32m'
# Terminal color for success/status messages.
YELLOW='\033[1;33m'
# Terminal color for warnings.
BLUE='\033[0;34m'
# Terminal color for the startup banner.
NC='\033[0m'
# Reset terminal color.

print_status() {
  # Print a successful status line.
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  # Print a warning status line.
  echo -e "${YELLOW}!${NC} $1"
}

print_error() {
  # Print an error status line.
  echo -e "${RED}✗${NC} $1"
}

command_exists() {
  # Return success when the named executable is available on PATH.
  command -v "$1" >/dev/null 2>&1
}

activate_repo_node_runtime() {
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  local requested_version=""

  if command_exists node && node "$NODE_VERSION_CHECK" --quiet >/dev/null 2>&1; then
    node "$NODE_VERSION_CHECK"
    return
  fi

  if [ ! -r "$NODE_VERSION_FILE" ]; then
    print_error "Node.js version file is missing: $NODE_VERSION_FILE"
    exit 1
  fi

  requested_version="$(tr -d '[:space:]' < "$NODE_VERSION_FILE")"
  if [ ! -s "$nvm_dir/nvm.sh" ]; then
    print_error "MetaHuman OS requires Node.js >=22.3.0 <23"
    if command_exists node; then
      print_warning "Found $(node --version) at $(command -v node)"
    else
      print_warning "Node.js was not found on PATH"
    fi
    print_warning "Install Node.js $requested_version or install NVM at $nvm_dir"
    exit 1
  fi

  print_warning "Activating MetaHuman OS Node.js $requested_version with NVM"
  set +u
  # shellcheck disable=SC1090
  source "$nvm_dir/nvm.sh"
  set -u

  if ! nvm use --silent "$requested_version" >/dev/null; then
    print_error "Node.js $requested_version is not installed in NVM"
    print_warning "Run: nvm install $requested_version"
    exit 1
  fi

  hash -r
  if ! node "$NODE_VERSION_CHECK"; then
    exit 1
  fi
}

process_command() {
  local pid="$1"

  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true
  fi
}

process_cwd() {
  local pid="$1"

  readlink "/proc/$pid/cwd" 2>/dev/null || true
}

is_repo_process() {
  local pid="$1"
  local cmd=""
  local cwd=""

  [ "$pid" != "$$" ] || return 1

  cmd="$(process_command "$pid")"
  cwd="$(process_cwd "$pid")"

  case "$cmd" in
    *"$REPO_ROOT"*) return 0 ;;
  esac

  case "$cwd" in
    "$REPO_ROOT"|"$REPO_ROOT"/*) return 0 ;;
  esac

  return 1
}

matching_repo_pids() {
  local pattern="$1"
  local pid=""

  pgrep -f -- "$pattern" 2>/dev/null | while read -r pid; do
    [ -n "$pid" ] || continue
    if is_repo_process "$pid"; then
      echo "$pid"
    fi
  done
}

release_start_lock() {
  if [ "$START_LOCK_HELD" != true ]; then
    return
  fi

  flock -u "$START_LOCK_FD" 2>/dev/null || true
  exec 9>&-
  START_LOCK_HELD=false
}

acquire_start_lock() {
  local legacy_pid=""

  if ! command_exists flock; then
    print_error "The flock command is required for safe MetaHuman startup locking"
    exit 1
  fi

  # Migrate the older PID-directory lock only after the HTTP preflight has
  # established that no MetaHuman web server is responding.
  if [ -d "$START_LOCK_FILE" ]; then
    legacy_pid="$(cat "$START_LOCK_FILE/pid" 2>/dev/null || true)"
    if [ -n "$legacy_pid" ]; then
      print_warning "Removing legacy MetaHuman startup lock (recorded PID $legacy_pid)"
    else
      print_warning "Removing legacy MetaHuman startup lock"
    fi
    rm -f "$START_LOCK_FILE/pid"
    if ! rmdir "$START_LOCK_FILE" 2>/dev/null; then
      print_error "Legacy startup lock contains unexpected files: $START_LOCK_FILE"
      exit 1
    fi
  fi

  exec 9>"$START_LOCK_FILE"
  if ! flock -n "$START_LOCK_FD"; then
    exec 9>&-
    print_error "Another MetaHuman OS launcher is starting or running"
    print_warning "Use ./stop.sh before starting another MetaHuman OS launcher"
    exit 1
  fi

  START_LOCK_HELD=true
}

kill_pids() {
  local pids="$1"
  local signal="${2:-TERM}"

  [ -n "$pids" ] || return 0
  echo "$pids" | xargs -r kill "-$signal" 2>/dev/null || true
}

live_pids() {
  local pids="$1"
  local pid=""

  echo "$pids" | while read -r pid; do
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
    fi
  done
}

run_with_timeout() {
  local seconds="$1"
  shift

  if command_exists timeout; then
    timeout "$seconds" "$@" || true
  else
    "$@" || true
  fi
}

kill_pattern_fast() {
  local pattern="$1"
  local pids=""

  pids="$(matching_repo_pids "$pattern")"
  if [ -z "$pids" ]; then
    return
  fi

  kill_pids "$pids" TERM
  sleep 1
  pids="$(live_pids "$pids")"
  if [ -n "$pids" ]; then
    kill_pids "$pids" KILL
  fi
}

clean_stale_runtime_files() {
  local pid_dir="$RUN_LOG_DIR"
  local lock_dir="$RUN_LOG_DIR/locks"
  local registry_file="$REPO_ROOT/logs/agents/running.json"
  local pid=""
  local pidfile=""
  local lockfile=""

  if [ -d "$pid_dir" ]; then
    for pidfile in "$pid_dir"/*.pid; do
      [ -f "$pidfile" ] || continue
      pid="$(cat "$pidfile" 2>/dev/null || true)"
      if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$pidfile"
      fi
    done
  fi

  if [ -d "$lock_dir" ]; then
    for lockfile in "$lock_dir"/*.lock; do
      [ -f "$lockfile" ] || continue
      pid="$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$lockfile" 2>/dev/null | grep -o '[0-9]*' || true)"
      if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$lockfile"
      fi
    done
  fi

  if [ -f "$registry_file" ] && command_exists node; then
    node -e "
const fs = require('fs');
const registryFile = process.argv[1];
const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
const clean = {};
for (const [name, info] of Object.entries(registry)) {
  try {
    process.kill(info.pid, 0);
    clean[name] = info;
  } catch {
    // stale entry
  }
}
fs.writeFileSync(registryFile, JSON.stringify(clean, null, 2));
" "$registry_file" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  # Stop child services when this launcher exits after startup began.
  if [ "$STARTED" != true ] || [ "$CLEANING_UP" = true ]; then
    # Do nothing before services start or during repeated signal handling.
    release_start_lock
    return
  fi

  CLEANING_UP=true
  trap '' INT TERM HUP
  # Mark cleanup active so repeated Ctrl+C/TERM signals do not stack.
  echo
  # Separate shutdown output from the running server log.
  print_warning "Stopping MetaHuman services"
  # Stop only the services this startup path triggers. Do not call stop.sh here:
  # stop.sh is the full-system shutdown path and also stops terminal sessions.
  {
    echo "[$(date -Is)] startup cleanup begin"
    kill_pattern_fast "vllm.entrypoints.openai.api_server"
    kill_pattern_fast "VLLM::EngineCore"
    rm -f "$RUN_LOG_DIR/vllm.pid" "$RUN_LOG_DIR/vllm.starting"
    run_with_timeout 5 "$REPO_ROOT/bin/mh" agent stop --all
    kill_pattern_fast "brain/scripts/_bootstrap.ts"
    kill_pattern_fast "maintenance-service"
    kill_pattern_fast "audio-organizer"
    kill_pattern_fast "mh start --no-restart"
    kill_pattern_fast "src/mh-new.ts start --no-restart"
    kill_pattern_fast "bin/start-services --background"
    kill_pattern_fast "mh vllm start"
    kill_pattern_fast "src/mh-new.ts vllm start"
    kill_pattern_fast "mh backend start"
    kill_pattern_fast "src/mh-new.ts backend start"
    run_with_timeout 5 "$REPO_ROOT/bin/stop-local-models"
    run_with_timeout 5 "$REPO_ROOT/bin/stop-voice-server"
    run_with_timeout 3 "$REPO_ROOT/bin/stop-event-bus"
    kill_pattern_fast "cloudflared"
    clean_stale_runtime_files
    echo "[$(date -Is)] startup cleanup complete"
  } >> "$RUN_LOG_DIR/startup-shutdown.log" 2>&1
  # Report completion even if there was nothing left to stop.
  print_status "MetaHuman services stopped"
  release_start_lock
}

trap cleanup EXIT
# Run cleanup when the shell exits normally or because the web server exits.
trap 'cleanup; exit 130' INT
# Run cleanup on Ctrl+C and exit with the conventional interrupt code.
trap 'cleanup; exit 143' TERM HUP
# Run cleanup on termination/hangup and exit with a signal-style code.

echo -e "${BLUE}================================${NC}"
# Print banner top border.
echo -e "${BLUE}  MetaHuman OS                  ${NC}"
# Print banner title.
echo -e "${BLUE}================================${NC}"
# Print banner bottom border.
echo
# Add a blank line after the banner.

START_CONFIG_FILE="$REPO_ROOT/.start-config"
# Optional local startup preferences live here.
if [ -f "$START_CONFIG_FILE" ]; then
  # Only load the local startup config when it exists.
  # shellcheck disable=SC1090
  source "$START_CONFIG_FILE"
  # Import local shell variables from .start-config.
fi

ENV_FILE="$REPO_ROOT/.env"
# Main environment variables live here.
if [ -f "$ENV_FILE" ]; then
  # Only load .env when it exists.
  set -a
  # Automatically export sourced variables to child processes.
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  # Import environment variables for the server and services.
  set +a
  # Stop auto-exporting newly assigned variables.
fi

export PORT="${PORT:-4321}"
# Resolve the web port before lock and listener checks.

activate_repo_node_runtime
# Never let a desktop or non-interactive launch fall back to an unsupported system Node.

if ! command_exists pnpm; then
  # Full-system launchers call the workspace CLI, so pnpm is required even when
  # the prebuilt web entrypoint itself can run with node alone.
  print_error "pnpm is required to start MetaHuman OS background services"
  print_warning "Enable the repository-pinned pnpm release with: corepack enable pnpm"
  exit 1
fi

if ! command_exists python3; then
  # Python is mandatory because the local voice/model tooling is isolated in venv.
  print_error "Python 3 is required to create the isolated runtime environment"
  exit 1
fi

VENV_PATH="$REPO_ROOT/venv"
# Use the repository-local virtual environment for Python isolation.
if [ ! -d "$VENV_PATH" ]; then
  # Create the venv only if it does not already exist.
  print_status "Creating isolated Python environment"
  python3 -m venv "$VENV_PATH"
  # Build the isolated Python environment without installing packages here.
fi

# Keep child services isolated without doing dependency installation at startup.
# Dependency repair belongs to setup/build, not the fast launch path.
# shellcheck disable=SC1091
source "$VENV_PATH/bin/activate"
# Activate the repository-local Python environment for child services.
print_status "Using Python environment: $VENV_PATH"
# Show which Python environment is active.

if [ ! -f "$SERVER_ENTRY" ]; then
  # Do not build during startup; fail fast when the server bundle is absent.
  print_error "Production server bundle is missing"
  echo "Run: pnpm --dir apps/site build"
  exit 1
fi

mkdir -p "$LOG_DIR" "$RUN_LOG_DIR"
# Ensure log folders exist before background launchers or cleanup write logs.

if command_exists curl && curl --max-time 2 --silent --show-error --output /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
  # A direct HTTP response is more reliable than lsof in constrained runtimes.
  print_error "MetaHuman OS is already responding on port $PORT"
  print_warning "Use ./stop.sh before starting another server"
  exit 1
fi

acquire_start_lock
# Refuse overlapping launcher instances before starting background services.

if command_exists lsof && lsof -n -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  # Refuse to start if another process already owns the web port.
  print_error "Port $PORT is already in use"
  lsof -n -i ":$PORT" -sTCP:LISTEN
  # Show the process currently listening on the web port.
  exit 1
fi

print_status "Starting background services"
# Announce the non-blocking service trigger.
if ! (exec 9>&-; "$REPO_ROOT/bin/start-services" --background) >> "$RUN_LOG_DIR/background-services.trigger.log" 2>&1; then
  print_warning "One or more background service launchers could not be started"
fi
# Start each service launcher before the web server, while the long-running
# services themselves continue in the background.
STARTED=true
# Mark that cleanup should run when this launcher exits.

print_status "Starting web server"
# Announce the foreground web server.
export MH_EXPOSURE_MODE="${MH_EXPOSURE_MODE:-local}"
if [ "$MH_EXPOSURE_MODE" = "shared" ]; then
  export HOST="${HOST:-0.0.0.0}"
  print_warning "Shared exposure mode enabled; configure MH_ALLOWED_HOSTS and MH_ALLOWED_ORIGINS for browser access"
else
  export HOST="${HOST:-127.0.0.1}"
fi

print_status "Exposure mode: $MH_EXPOSURE_MODE"
print_status "Web interface: http://localhost:$PORT"
# Show the URL without opening a browser automatically.
print_warning "Use ./stop.sh to stop MetaHuman services"
# Tell the operator how to stop everything if not using Ctrl+C.
echo
# Add a blank line before server output begins.

cd "$REPO_ROOT/apps/site"
# Run the server from the site package directory.
(exec 9>&-; node "$SERVER_ENTRY" 2>&1) | (exec 9>&-; tee "$SERVER_LOG")
# Start the web server in the foreground and mirror output to logs/server.log.
