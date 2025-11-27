#!/bin/bash

# MetaHuman OS Startup Script
# This script initializes and starts the MetaHuman OS web interface

set -e  # Exit on any error

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

# Optional per-user config
START_CONFIG_FILE="$REPO_ROOT/.start-config"
if [ -f "$START_CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    source "$START_CONFIG_FILE"
fi

# Optional skips (can be provided via env or .start-config)
SKIP_DEP_INSTALL=${SKIP_DEP_INSTALL:-0}
SKIP_PYTHON_DEPS=${SKIP_PYTHON_DEPS:-$SKIP_DEP_INSTALL}
SKIP_NODE_DEPS=${SKIP_NODE_DEPS:-$SKIP_DEP_INSTALL}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  MetaHuman OS Startup Script  ${NC}"
echo -e "${BLUE}================================${NC}"
echo

# Function to print status messages
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a process is running
is_running() {
    pgrep -f "$1" >/dev/null 2>&1
}

# Track child process for cleanup
SERVER_PID=""

# Cleanup function for graceful shutdown
cleanup_services() {
    echo ""
    echo "Shutting down MetaHuman services..."

    # Kill the server first if running
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Stopping web server (PID: $SERVER_PID)..."
        kill "$SERVER_PID" 2>/dev/null || true
        # Wait briefly for graceful shutdown
        for i in 1 2 3; do
            kill -0 "$SERVER_PID" 2>/dev/null || break
            sleep 1
        done
        # Force kill if still running
        kill -9 "$SERVER_PID" 2>/dev/null || true
    fi

    # Stop agents with timeout
    timeout 5 "$REPO_ROOT/bin/mh" agent stop --all 2>/dev/null || true

    # Stop terminal server
    "$REPO_ROOT/bin/stop-terminal" 2>/dev/null || true

    # Force kill any remaining agents
    pkill -f "brain/agents" 2>/dev/null || true
    pkill -f "scheduler-service" 2>/dev/null || true
    pkill -f "audio-organizer" 2>/dev/null || true

    echo "Goodbye!"
    exit 0
}

trap cleanup_services INT TERM
trap 'exit 0' EXIT

wait_for_exit() {
    local pattern="$1"
    local attempts="${2:-5}"
    local delay="${3:-1}"

    for _ in $(seq 1 "$attempts"); do
        if ! is_running "$pattern"; then
            return 0
        fi
        sleep "$delay"
    done

    return 1
}

# Check if we're in the right directory structure
if [ ! -f "$REPO_ROOT/package.json" ] || [ ! -d "$REPO_ROOT/apps/site" ]; then
    print_error "This script must be run from the MetaHuman OS root directory"
    print_error "Current directory: $REPO_ROOT"
    print_error "Make sure package.json and apps/site/ exist"
    exit 1
fi

echo "Repository root: $REPO_ROOT"
echo

# Check for required tools
echo "Checking for required tools..."
REQUIRED_TOOLS=("node" "pnpm" "python3")

MISSING_TOOLS=()
for tool in "${REQUIRED_TOOLS[@]}"; do
    if command_exists "$tool"; then
        VERSION=$($tool --version 2>/dev/null || echo "unknown")
        print_status "$tool ($VERSION)"
    else
        MISSING_TOOLS+=("$tool")
    fi
done

if [ ${#MISSING_TOOLS[@]} -ne 0 ]; then
    echo
    print_error "Missing required tools: ${MISSING_TOOLS[*]}"
    print_warning "Please install the following:"
    for tool in "${MISSING_TOOLS[@]}"; do
        case "$tool" in
            "node")
                echo "  - Node.js (https://nodejs.org/)"
                ;;
            "pnpm")
                echo "  - pnpm (npm install -g pnpm)"
                ;;
            "python3")
                echo "  - Python 3 (https://www.python.org/downloads/)"
                ;;
        esac
    done
    exit 1
fi

echo

# Create and setup Python virtual environment if it doesn't exist
VENV_PATH="$REPO_ROOT/venv"
if [ ! -d "$VENV_PATH" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV_PATH"
    print_status "Virtual environment created at $VENV_PATH"
    echo
fi

# Activate virtual environment
echo "Activating Python virtual environment..."
source "$VENV_PATH/bin/activate"
print_status "Virtual environment activated ($(basename $VIRTUAL_ENV))"
echo

# Install Python dependencies if requirements.txt exists
if [ -f "$REPO_ROOT/requirements.txt" ]; then
    echo "Checking Python dependencies..."
    if [ "$SKIP_PYTHON_DEPS" = "1" ]; then
        print_warning "Skipping Python dependency installation (SKIP_PYTHON_DEPS=1)"
        echo
    elif [ ! -f "$VENV_PATH/installed_packages" ] || [ "$REPO_ROOT/requirements.txt" -nt "$VENV_PATH/installed_packages" ]; then
        echo "Installing Python dependencies from requirements.txt..."
        pip install --upgrade pip setuptools wheel
        pip install -r "$REPO_ROOT/requirements.txt"
        touch "$VENV_PATH/installed_packages"
        print_status "Python dependencies installed"
        echo
    else
        print_status "Python dependencies already installed"
        echo
    fi
else
    print_warning "requirements.txt not found - skipping Python dependency installation"
    echo
fi

# Check if Ollama is running
echo "Checking Ollama status..."
if command_exists "ollama" && ollama list >/dev/null 2>&1; then
    print_status "Ollama is running"
else
    print_warning "Ollama is not running or not installed"
    print_warning "The web interface may have limited functionality"
    print_warning "Install Ollama from: https://ollama.ai"
    echo
fi

# Check if we need to install Node.js dependencies
echo "Checking for Node.js dependencies..."
LOCK_FILE="$REPO_ROOT/pnpm-lock.yaml"
STAMP_FILE="$REPO_ROOT/node_modules/.install-stamp"
NEED_NODE_INSTALL=false

if [ "$SKIP_NODE_DEPS" = "1" ]; then
    NEED_NODE_INSTALL=false
elif [ ! -d "$REPO_ROOT/node_modules" ] || [ ! -d "$REPO_ROOT/apps/site/node_modules" ]; then
    NEED_NODE_INSTALL=true
elif [ -f "$LOCK_FILE" ]; then
    if [ ! -f "$STAMP_FILE" ] || [ "$LOCK_FILE" -nt "$STAMP_FILE" ]; then
        NEED_NODE_INSTALL=true
    fi
fi

if [ "$SKIP_NODE_DEPS" = "1" ]; then
    print_warning "Skipping Node.js dependency installation (SKIP_NODE_DEPS=1)"
    echo
elif [ "$NEED_NODE_INSTALL" = true ]; then
    echo "Installing Node.js dependencies (pnpm install)..."
    cd "$REPO_ROOT"
    pnpm install
    mkdir -p "$REPO_ROOT/node_modules"
    touch "$STAMP_FILE"
    print_status "Dependencies installed"
    echo
else
    print_status "Node.js dependencies already installed"
    echo
fi

# Check if MetaHuman is initialized
echo "Checking MetaHuman initialization..."
PERSONA_CORE="$REPO_ROOT/persona/core.json"
if [ ! -f "$PERSONA_CORE" ]; then
    print_warning "MetaHuman not initialized"
    echo "Initializing MetaHuman OS..."
    cd "$REPO_ROOT"
    ./bin/mh init
    print_status "MetaHuman initialized"
    echo
    print_warning "Remember to customize your persona in persona/core.json"
else
    print_status "MetaHuman already initialized"
    echo
fi

# Function to stop existing processes
stop_existing() {
    echo "Checking for existing processes..."

    # Kill any existing Astro dev servers
    if is_running "astro dev"; then
        echo "Stopping existing Astro dev server..."
        pkill -f "astro dev" 2>/dev/null || true
        sleep 2
    fi

    # Kill any existing production servers
    if is_running "node dist/server/entry.mjs"; then
        echo "Stopping existing production server..."
        pkill -f "node dist/server/entry.mjs" 2>/dev/null || true
        if ! wait_for_exit "node dist/server/entry.mjs" 5 1; then
            echo "Force killing production server..."
            pkill -9 -f "node dist/server/entry.mjs" 2>/dev/null || true
            sleep 1
        fi
    fi

    # Kill any existing mh agents
    if is_running "mh agent"; then
        echo "Stopping existing MetaHuman agents..."
        ./bin/mh agent stop --all 2>/dev/null || true
        sleep 2
    fi

    # Ensure port 4321 is available before starting
    PORT_PIDS=$(lsof -i :4321 -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$PORT_PIDS" ]; then
        echo "Port 4321 in use (PIDs: $PORT_PIDS). Terminating..."
        echo "$PORT_PIDS" | xargs -r kill 2>/dev/null || true
        for _ in $(seq 1 5); do
            if ! lsof -i :4321 -sTCP:LISTEN >/dev/null 2>&1; then
                break
            fi
            sleep 1
        done

        if lsof -i :4321 -sTCP:LISTEN >/dev/null 2>&1; then
            echo "Force killing processes on port 4321..."
            echo "$PORT_PIDS" | xargs -r kill -9 2>/dev/null || true
            sleep 1
        fi
    fi

    print_status "Existing processes stopped"
    echo
}

# Function to check if production build is needed
needs_rebuild() {
    DIST_DIR="$REPO_ROOT/apps/site/dist"
    SRC_DIR="$REPO_ROOT/apps/site/src"

    # If dist doesn't exist, we need to build
    if [ ! -d "$DIST_DIR" ]; then
        return 0
    fi

    # If any source file is newer than dist, we need to rebuild
    if [ -n "$(find "$SRC_DIR" -newer "$DIST_DIR/server/entry.mjs" 2>/dev/null | head -1)" ]; then
        return 0
    fi

    # No rebuild needed
    return 1
}

# Stop existing processes
stop_existing

# Clean up stale PID and lock files before starting
echo "Cleaning up stale process files..."
cleanup_stale_files() {
    # Clean up stale PID files
    PID_DIR="$REPO_ROOT/logs/run"
    if [ -d "$PID_DIR" ]; then
        for pidfile in "$PID_DIR"/*.pid; do
            [ -f "$pidfile" ] || continue
            pid=$(cat "$pidfile" 2>/dev/null || echo "")
            if [ -n "$pid" ]; then
                if ! kill -0 "$pid" 2>/dev/null; then
                    rm -f "$pidfile"
                fi
            else
                rm -f "$pidfile"
            fi
        done
    fi

    # Clean up stale lock files
    LOCK_DIR="$REPO_ROOT/logs/run/locks"
    if [ -d "$LOCK_DIR" ]; then
        for lockfile in "$LOCK_DIR"/*.lock; do
            [ -f "$lockfile" ] || continue
            pid=$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$lockfile" 2>/dev/null | grep -o '[0-9]*' || echo "")
            if [ -n "$pid" ]; then
                if ! kill -0 "$pid" 2>/dev/null; then
                    rm -f "$lockfile"
                fi
            else
                rm -f "$lockfile"
            fi
        done
    fi

    # Clean up agent registry
    REGISTRY_FILE="$REPO_ROOT/logs/agents/running.json"
    if [ -f "$REGISTRY_FILE" ] && command -v node >/dev/null 2>&1; then
        node -e "
const fs = require('fs');
try {
    const registry = JSON.parse(fs.readFileSync('$REGISTRY_FILE', 'utf-8'));
    const clean = {};
    for (const [name, info] of Object.entries(registry)) {
        try { process.kill(info.pid, 0); clean[name] = info; } catch (e) {}
    }
    fs.writeFileSync('$REGISTRY_FILE', JSON.stringify(clean, null, 2));
} catch (e) {}
" 2>/dev/null || true
    fi
}
cleanup_stale_files
print_status "Stale files cleaned"
echo

# Start agents and services (like run-with-agents does for pnpm dev)
echo "Starting MetaHuman agents and services..."

# Check headless mode before starting agents
RUNTIME_CONFIG="$REPO_ROOT/etc/runtime.json"
if [ -f "$RUNTIME_CONFIG" ]; then
  HEADLESS=$(grep -o '"headless"[[:space:]]*:[[:space:]]*true' "$RUNTIME_CONFIG" || echo "")
  if [ -n "$HEADLESS" ]; then
    print_warning "Headless mode active - skipping agent startup"
  else
    "$REPO_ROOT/bin/mh" start --restart 2>/dev/null || print_warning "Failed to start agents"
  fi
else
  "$REPO_ROOT/bin/mh" start --restart 2>/dev/null || print_warning "Failed to start agents"
fi

# Auto-start Cloudflare tunnel if enabled
"$REPO_ROOT/bin/start-cloudflare" 2>/dev/null || true

# Auto-start voice server based on active TTS provider
"$REPO_ROOT/bin/start-voice-server" 2>/dev/null || true

# Auto-start terminal server
"$REPO_ROOT/bin/start-terminal" 2>/dev/null || true

print_status "Services started"
echo

# Start the web server
echo "Starting MetaHuman OS web interface..."
echo

cd "$REPO_ROOT/apps/site"

# Check if we need to build
if needs_rebuild; then
    print_status "Building production bundle..."
    pnpm build
    if [ $? -ne 0 ]; then
        print_error "Build failed. Falling back to development server."
        exec pnpm dev
    fi
    print_status "Production build complete"
    echo
fi

print_status "Starting production server..."
print_status "Web interface will be available at: http://localhost:4321"
echo

# Display helpful information
echo "=========================================="
echo "  MetaHuman OS Production Server          "
echo "=========================================="
echo "URL: http://localhost:4321"
echo "Press Ctrl+C to stop the server"
echo
echo "Features available:"
echo "  - Chat with your digital personality"
echo "  - Task management"
echo "  - Memory browsing"
echo "  - Persona customization"
echo "  - Agent monitoring"
echo
echo "To stop the server, press Ctrl+C"
echo "=========================================="
echo

open_browser_when_ready() {
  local opener="$1"
  if [ -z "$opener" ]; then
    return
  fi
  (
    until curl -sSf "http://localhost:4321" >/dev/null 2>&1; do
      sleep 1
    done
    "$opener" "http://localhost:4321" >/dev/null 2>&1
  ) &
}

if command -v xdg-open >/dev/null 2>&1; then
  open_browser_when_ready "xdg-open"
elif command -v open >/dev/null 2>&1; then
  open_browser_when_ready "open"
fi

# Start the production server (run in foreground, not exec, so trap works)
node dist/server/entry.mjs &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"

# Wait for server to exit
wait $SERVER_PID
