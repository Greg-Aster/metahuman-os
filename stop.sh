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

kill_repo_process_pattern() {
    local pattern="$1"
    local name="$2"
    local timeout="${3:-5}"
    local pids=""

    pids="$(matching_repo_pids "$pattern")"
    if [ -z "$pids" ]; then
        print_status "$name not running"
        return 0
    fi

    echo "Stopping $name (PIDs: $pids)..."
    kill_pids "$pids" TERM

    for i in $(seq 1 "$timeout"); do
        pids="$(live_pids "$pids")"
        if [ -z "$pids" ]; then
            print_status "$name stopped"
            return 0
        fi
        sleep 1
    done

    pids="$(live_pids "$pids")"
    if [ -n "$pids" ]; then
        print_warning "$name didn't stop gracefully, forcing..."
        kill_pids "$pids" KILL
        sleep 1
    fi

    pids="$(live_pids "$pids")"
    if [ -n "$pids" ]; then
        print_error "Failed to stop $name (PIDs: $pids)"
        return 1
    fi

    print_status "$name stopped (forced)"
    return 0
}

# Function to kill process on specific port
kill_repo_port() {
    local port="$1"
    local name="$2"
    local pid=""
    local pids=""
    local live=""

    for pid in $(lsof -i ":$port" -sTCP:LISTEN -t 2>/dev/null || true); do
        if is_repo_process "$pid"; then
            pids="${pids}${pids:+
}$pid"
        fi
    done

    if [ -n "$pids" ]; then
        echo "Stopping $name on port $port (PIDs: $pids)..."
        kill_pids "$pids" TERM
        sleep 2

        live="$(live_pids "$pids")"
        if [ -n "$live" ]; then
            kill_pids "$live" KILL
            print_status "$name stopped (forced)"
        else
            print_status "$name stopped"
        fi
    else
        print_status "$name not running on port $port for this repo"
    fi
}

run_with_timeout() {
    local seconds="$1"
    shift

    if command -v timeout >/dev/null 2>&1; then
        timeout "$seconds" "$@"
    else
        "$@"
    fi
}

stop_vllm() {
    local api_pattern="vllm.entrypoints.openai.api_server"
    local engine_pattern="VLLM::EngineCore"

    kill_vllm_pattern() {
        local pattern="$1"
        local name="$2"
        local timeout="${3:-10}"
        local pids=""

        pids=$(matching_repo_pids "$pattern")
        if [ -z "$pids" ]; then
            print_status "$name not running"
            return 0
        fi

        echo "Stopping $name (PIDs: $pids)..."
        kill_pids "$pids" TERM

        for i in $(seq 1 "$timeout"); do
            pids=$(live_pids "$pids")
            if [ -z "$pids" ]; then
                print_status "$name stopped"
                return 0
            fi
            sleep 1
        done

        pids=$(live_pids "$pids")
        if [ -n "$pids" ]; then
            print_warning "$name didn't stop gracefully, forcing..."
            kill_pids "$pids" KILL
            sleep 1
        fi

        pids=$(live_pids "$pids")
        if [ -n "$pids" ]; then
            print_error "Failed to stop $name (PIDs: $pids)"
            return 1
        fi

        print_status "$name stopped (forced)"
        return 0
    }

    echo "Stopping vLLM server..."
    if [ -x "$REPO_ROOT/bin/mh" ]; then
        run_with_timeout 20 "$REPO_ROOT/bin/mh" vllm stop 2>/dev/null || print_warning "vLLM CLI stop did not exit cleanly; continuing with process cleanup"
    else
        print_warning "mh CLI not found, stopping vLLM manually..."
    fi

    kill_vllm_pattern "$api_pattern" "vLLM API Server" 10
    kill_vllm_pattern "$engine_pattern" "vLLM EngineCore" 10
    kill_repo_port 8000 "vLLM Server"
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
    run_with_timeout 15 "$REPO_ROOT/bin/mh" agent stop --all 2>/dev/null || print_warning "Agent CLI stop did not exit cleanly; continuing with process cleanup"
else
    print_warning "mh CLI not found, stopping agents manually..."
fi

# Stop scheduler-service specifically (main agent coordinator)
kill_repo_process_pattern "scheduler-service" "Scheduler Service"

# Stop audio-organizer
kill_repo_process_pattern "audio-organizer" "Audio Organizer"

# Stop any running agents by pattern
kill_repo_process_pattern "brain/agents" "Background Agents"

# Stop terminal server
echo "Stopping terminal server..."
if [ -x "$REPO_ROOT/bin/stop-terminal" ]; then
    "$REPO_ROOT/bin/stop-terminal" 2>/dev/null || true
fi
kill_repo_port 3001 "Terminal Server"
print_status "Skipped broad terminal-server process match"

# Stop Big Brother terminal (port 3099)
echo "Stopping Big Brother terminal..."
kill_repo_port 3099 "Big Brother Terminal"
BB_PID_FILE="$REPO_ROOT/logs/run/big-brother-terminal.pid"
if [ -f "$BB_PID_FILE" ]; then
    rm -f "$BB_PID_FILE"
fi

# Stop vLLM before voice/web cleanup so GPU memory is released promptly.
stop_vllm

# Stop voice servers
kill_repo_process_pattern "sovits" "SoVits Server"
kill_repo_process_pattern "rvc-server" "RVC Server"
kill_repo_process_pattern "whisper" "Whisper Server"
kill_repo_process_pattern "kokoro" "Kokoro Server"

# Stop Cloudflare tunnel
kill_repo_process_pattern "cloudflared" "Cloudflare Tunnel"

# Stop web servers
echo "Stopping web servers..."
kill_repo_port 4321 "Astro Production Server"
kill_repo_process_pattern "astro dev" "Astro Dev Server"
kill_repo_process_pattern "apps/site/dist/server/entry.mjs" "Production Server"

# Stop launcher wrappers that can remain after their child services exit.
kill_repo_process_pattern "start.sh" "Startup Wrapper"
kill_repo_process_pattern "bin/start-services --background" "Background Services Launcher"
kill_repo_process_pattern "bin/start-services" "Terminal Services Launcher"
kill_repo_process_pattern "mh start --no-restart" "MetaHuman Start Command"
kill_repo_process_pattern "src/mh-new.ts start --no-restart" "MetaHuman Start Command Launcher"
kill_repo_process_pattern "mh vllm start" "vLLM Start Command"
kill_repo_process_pattern "src/mh-new.ts vllm start" "vLLM Start Command Launcher"

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
