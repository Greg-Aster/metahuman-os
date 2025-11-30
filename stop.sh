#!/bin/bash

# MetaHuman OS Shutdown Script
# This script cleanly stops all MetaHuman OS services and processes

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  MetaHuman OS Shutdown Script  ${NC}"
echo -e "${BLUE}================================${NC}"
echo

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to check if a process is running
is_running() {
    pgrep -f "$1" >/dev/null 2>&1
}

# Function to kill process by pattern with timeout
kill_process_pattern() {
    local pattern="$1"
    local name="$2"
    local timeout="${3:-5}"

    if is_running "$pattern"; then
        echo "Stopping $name..."
        pkill -f "$pattern" 2>/dev/null || true

        # Wait for graceful shutdown
        for i in $(seq 1 "$timeout"); do
            if ! is_running "$pattern"; then
                print_status "$name stopped"
                return 0
            fi
            sleep 1
        done

        # Force kill if still running
        if is_running "$pattern"; then
            print_warning "$name didn't stop gracefully, forcing..."
            pkill -9 -f "$pattern" 2>/dev/null || true
            sleep 1
            if is_running "$pattern"; then
                print_error "Failed to stop $name"
                return 1
            fi
        fi
        print_status "$name stopped (forced)"
    else
        print_status "$name not running"
    fi
    return 0
}

# Function to kill process on specific port
kill_port() {
    local port="$1"
    local name="$2"

    local pids=$(lsof -i ":$port" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "Stopping $name on port $port (PIDs: $pids)..."
        echo "$pids" | xargs -r kill 2>/dev/null || true
        sleep 2

        # Check if still running
        pids=$(lsof -i ":$port" -sTCP:LISTEN -t 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs -r kill -9 2>/dev/null || true
            print_status "$name stopped (forced)"
        else
            print_status "$name stopped"
        fi
    else
        print_status "$name not running on port $port"
    fi
}

# Stop PM2 processes if PM2 is installed
if command -v pm2 &> /dev/null; then
    if pm2 list 2>/dev/null | grep -q "metahuman-web"; then
        echo "Stopping PM2 web server..."
        pm2 stop metahuman-web 2>/dev/null || true
        pm2 delete metahuman-web 2>/dev/null || true
        print_status "PM2 web server stopped"
    fi
fi

# Stop all MetaHuman agents via CLI
echo "Stopping MetaHuman agents..."
if [ -x "$REPO_ROOT/bin/mh" ]; then
    "$REPO_ROOT/bin/mh" agent stop --all 2>/dev/null || print_warning "Failed to stop agents via CLI"
else
    print_warning "mh CLI not found, stopping agents manually..."
fi

# Stop scheduler-service specifically (main agent coordinator)
kill_process_pattern "scheduler-service" "Scheduler Service"

# Stop audio-organizer
kill_process_pattern "audio-organizer" "Audio Organizer"

# Stop any running agents by pattern
kill_process_pattern "brain/agents" "Background Agents"

# Stop terminal server
echo "Stopping terminal server..."
if [ -x "$REPO_ROOT/bin/stop-terminal" ]; then
    "$REPO_ROOT/bin/stop-terminal" 2>/dev/null || true
fi
kill_process_pattern "terminal-server" "Terminal Server"

# Stop Big Brother terminal (port 3099)
echo "Stopping Big Brother terminal..."
kill_port 3099 "Big Brother Terminal"
BB_PID_FILE="$REPO_ROOT/logs/run/big-brother-terminal.pid"
if [ -f "$BB_PID_FILE" ]; then
    rm -f "$BB_PID_FILE"
fi

# Stop voice servers
kill_process_pattern "sovits" "SoVits Server"
kill_process_pattern "rvc-server" "RVC Server"
kill_process_pattern "whisper" "Whisper Server"
kill_process_pattern "kokoro" "Kokoro Server"

# Stop Cloudflare tunnel
kill_process_pattern "cloudflared" "Cloudflare Tunnel"

# Stop web servers
echo "Stopping web servers..."
kill_port 4321 "Astro Production Server"
kill_process_pattern "astro dev" "Astro Dev Server"
kill_process_pattern "node dist/server/entry.mjs" "Production Server"

# Clean up stale PID files
echo "Cleaning up stale PID files..."
PID_DIR="$REPO_ROOT/logs/run"
if [ -d "$PID_DIR" ]; then
    for pidfile in "$PID_DIR"/*.pid; do
        [ -f "$pidfile" ] || continue
        pid=$(cat "$pidfile" 2>/dev/null || echo "")
        if [ -n "$pid" ]; then
            if ! kill -0 "$pid" 2>/dev/null; then
                rm -f "$pidfile"
                print_status "Removed stale PID file: $(basename "$pidfile")"
            fi
        else
            rm -f "$pidfile"
        fi
    done
fi

# Clean up stale lock files
echo "Cleaning up stale lock files..."
LOCK_DIR="$REPO_ROOT/logs/run/locks"
if [ -d "$LOCK_DIR" ]; then
    for lockfile in "$LOCK_DIR"/*.lock; do
        [ -f "$lockfile" ] || continue
        # Extract PID from JSON lock file
        pid=$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$lockfile" 2>/dev/null | grep -o '[0-9]*' || echo "")
        if [ -n "$pid" ]; then
            if ! kill -0 "$pid" 2>/dev/null; then
                rm -f "$lockfile"
                print_status "Removed stale lock file: $(basename "$lockfile")"
            fi
        else
            rm -f "$lockfile"
        fi
    done
fi

# Clean up agent registry
echo "Cleaning up agent registry..."
REGISTRY_FILE="$REPO_ROOT/logs/agents/running.json"
if [ -f "$REGISTRY_FILE" ]; then
    # Create clean registry with only running processes
    if command -v node >/dev/null 2>&1; then
        node -e "
const fs = require('fs');
const registry = JSON.parse(fs.readFileSync('$REGISTRY_FILE', 'utf-8'));
const clean = {};
for (const [name, info] of Object.entries(registry)) {
    try {
        process.kill(info.pid, 0);
        clean[name] = info;
    } catch (e) {
        console.log('Removed stale registry entry:', name);
    }
}
fs.writeFileSync('$REGISTRY_FILE', JSON.stringify(clean, null, 2));
" 2>/dev/null || true
    fi
fi

echo
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  MetaHuman OS Shutdown Complete${NC}"
echo -e "${GREEN}================================${NC}"
echo
print_status "All services stopped"
print_status "Stale files cleaned up"
echo
