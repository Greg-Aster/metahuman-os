#!/bin/bash
#
# MetaHuman Mobile Development Workflow
#
# Runs emulator + Metro bundler with hot reloading and visual debug logs
#
# Usage:
#   ./scripts/dev.sh              # Start emulator + Metro + auto-install
#   ./scripts/dev.sh --no-emu     # Use physical device (already connected)
#   ./scripts/dev.sh --rebuild    # Force rebuild before starting
#   ./scripts/dev.sh --cold       # Cold start (clear Metro cache)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RN_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$RN_DIR/../.."

# Android SDK paths
ANDROID_SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
EMULATOR="$ANDROID_SDK/emulator/emulator"
ADB="$ANDROID_SDK/platform-tools/adb"
JAVA_HOME="${JAVA_HOME:-/home/greggles/android-studio/jbr}"

# AVD name (first available)
AVD_NAME=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Parse arguments
USE_EMULATOR=true
FORCE_REBUILD=false
COLD_START=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-emu|--device)
            USE_EMULATOR=false
            shift
            ;;
        --rebuild)
            FORCE_REBUILD=true
            shift
            ;;
        --cold)
            COLD_START=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "MetaHuman Mobile Dev Workflow"
            echo ""
            echo "Usage: ./scripts/dev.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --no-emu, --device   Use physical device instead of emulator"
            echo "  --rebuild            Force rebuild handlers before starting"
            echo "  --cold               Clear Metro cache (cold start)"
            echo "  --verbose, -v        Show verbose output"
            echo "  --help, -h           Show this help"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Print header
print_header() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║           MetaHuman Mobile Development Environment           ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Hot Reload: Yes  │  Debug Logs: Yes  │  Metro Bundler      ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Log with timestamp and color
log() {
    local level=$1
    local msg=$2
    local timestamp=$(date '+%H:%M:%S')

    case $level in
        INFO)  echo -e "${CYAN}[$timestamp]${NC} ${GREEN}✓${NC} $msg" ;;
        WARN)  echo -e "${CYAN}[$timestamp]${NC} ${YELLOW}⚠${NC} $msg" ;;
        ERROR) echo -e "${CYAN}[$timestamp]${NC} ${RED}✗${NC} $msg" ;;
        CMD)   echo -e "${CYAN}[$timestamp]${NC} ${MAGENTA}▶${NC} $msg" ;;
        DEBUG) echo -e "${CYAN}[$timestamp]${NC} ${BLUE}•${NC} $msg" ;;
        *)     echo -e "${CYAN}[$timestamp]${NC} $msg" ;;
    esac
}

# Cleanup function
cleanup() {
    log INFO "Shutting down..."

    # Kill Metro if running
    if [[ -n "$METRO_PID" ]]; then
        log DEBUG "Stopping Metro bundler (PID: $METRO_PID)"
        kill $METRO_PID 2>/dev/null || true
    fi

    # Kill logcat if running
    if [[ -n "$LOGCAT_PID" ]]; then
        log DEBUG "Stopping logcat (PID: $LOGCAT_PID)"
        kill $LOGCAT_PID 2>/dev/null || true
    fi

    echo ""
    log INFO "Development session ended"
}

trap cleanup EXIT INT TERM

# Check prerequisites
check_prereqs() {
    log INFO "Checking prerequisites..."

    # Check Android SDK
    if [[ ! -d "$ANDROID_SDK" ]]; then
        log ERROR "Android SDK not found at $ANDROID_SDK"
        log ERROR "Set ANDROID_HOME environment variable"
        exit 1
    fi

    # Check emulator
    if [[ ! -x "$EMULATOR" ]]; then
        log ERROR "Android emulator not found at $EMULATOR"
        exit 1
    fi

    # Check ADB
    if [[ ! -x "$ADB" ]]; then
        log ERROR "ADB not found at $ADB"
        exit 1
    fi

    # Check Java
    if [[ ! -d "$JAVA_HOME" ]]; then
        log WARN "JAVA_HOME not found at $JAVA_HOME"
        log WARN "Android builds may fail"
    fi

    # Check Node.js
    if ! command -v node &> /dev/null; then
        log ERROR "Node.js not found"
        exit 1
    fi

    # Get AVD name
    AVD_NAME=$("$EMULATOR" -list-avds | head -1)
    if [[ -z "$AVD_NAME" ]]; then
        log ERROR "No Android Virtual Devices found"
        log ERROR "Create one in Android Studio: Tools → Device Manager → Create Device"
        exit 1
    fi

    log INFO "Prerequisites OK (AVD: $AVD_NAME)"
}

# Start emulator
start_emulator() {
    if [[ "$USE_EMULATOR" != "true" ]]; then
        log INFO "Skipping emulator (using physical device)"

        # Check if device is connected
        local devices=$("$ADB" devices | grep -v "List" | grep -v "^$" | wc -l)
        if [[ $devices -eq 0 ]]; then
            log ERROR "No devices connected. Connect a device or remove --no-emu"
            exit 1
        fi

        log INFO "Using connected device(s)"
        return
    fi

    log INFO "Starting Android emulator ($AVD_NAME)..."

    # Check if emulator is already running
    local running=$("$ADB" devices | grep "emulator" | wc -l)
    if [[ $running -gt 0 ]]; then
        log INFO "Emulator already running"
        return
    fi

    # Start emulator in background
    log CMD "emulator -avd $AVD_NAME -no-snapshot-load -gpu auto"
    "$EMULATOR" -avd "$AVD_NAME" -no-snapshot-load -gpu auto &
    EMULATOR_PID=$!

    # Wait for emulator to boot
    log INFO "Waiting for emulator to boot..."
    local timeout=120
    local elapsed=0

    while [[ $elapsed -lt $timeout ]]; do
        local boot_complete=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
        if [[ "$boot_complete" == "1" ]]; then
            log INFO "Emulator booted successfully"
            return
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        printf "."
    done

    echo ""
    log ERROR "Emulator failed to boot within ${timeout}s"
    exit 1
}

# Build handlers (if needed)
build_handlers() {
    local handlers_built="$SCRIPT_DIR/.handlers_built"
    local core_src="$ROOT_DIR/packages/core/src"

    # Check if rebuild is needed
    local need_rebuild=false

    if [[ "$FORCE_REBUILD" == "true" ]]; then
        need_rebuild=true
        log INFO "Force rebuild requested"
    elif [[ ! -f "$handlers_built" ]]; then
        need_rebuild=true
        log INFO "Handlers not built yet"
    elif [[ -n $(find "$core_src" -name "*.ts" -newer "$handlers_built" 2>/dev/null | head -1) ]]; then
        need_rebuild=true
        log INFO "Core source files changed"
    fi

    if [[ "$need_rebuild" == "true" ]]; then
        log CMD "Building mobile handlers..."
        cd "$ROOT_DIR"
        node "$SCRIPT_DIR/build-handlers.mjs"
        touch "$handlers_built"
        log INFO "Handlers built"
    else
        log INFO "Handlers up to date (skip with --rebuild to force)"
    fi
}

# Install app on device/emulator
install_app() {
    local apk_path="$RN_DIR/android/app/build/outputs/apk/debug/app-debug.apk"

    if [[ ! -f "$apk_path" ]]; then
        log WARN "Debug APK not found, building..."
        cd "$RN_DIR/android"
        export JAVA_HOME
        export PATH="$JAVA_HOME/bin:$PATH"
        ./gradlew assembleDebug
    fi

    log CMD "Installing app on device..."
    "$ADB" install -r "$apk_path" 2>&1 | while read -r line; do
        if [[ "$line" == *"Success"* ]]; then
            log INFO "App installed successfully"
        elif [[ "$line" == *"Failure"* ]]; then
            log ERROR "Install failed: $line"
        fi
    done
}

# Kill existing Metro bundler if running
kill_existing_metro() {
    local metro_pid=$(lsof -t -i:8081 2>/dev/null | head -1)
    if [[ -n "$metro_pid" ]]; then
        log WARN "Killing existing Metro bundler (PID: $metro_pid)"
        kill $metro_pid 2>/dev/null || true
        sleep 1
        # Force kill if still running
        if kill -0 $metro_pid 2>/dev/null; then
            kill -9 $metro_pid 2>/dev/null || true
        fi
    fi
}

# Start Metro bundler
start_metro() {
    log INFO "Starting Metro bundler..."
    cd "$RN_DIR"

    # Kill any existing Metro instance first
    kill_existing_metro

    local metro_args=()

    if [[ "$COLD_START" == "true" ]]; then
        metro_args+=("--reset-cache")
        log INFO "Cold start: clearing Metro cache"
    fi

    # Start Metro in background with colored output
    log CMD "npx react-native start ${metro_args[*]}"

    # Use script to preserve colors in background
    npx react-native start "${metro_args[@]}" 2>&1 &
    METRO_PID=$!

    # Wait for Metro to be ready
    log INFO "Waiting for Metro to initialize..."
    sleep 5

    if ! kill -0 $METRO_PID 2>/dev/null; then
        log ERROR "Metro bundler failed to start"
        exit 1
    fi

    log INFO "Metro bundler running (PID: $METRO_PID)"
}

# Start logcat for React Native logs
start_logcat() {
    log INFO "Starting debug log stream..."

    # Filter for React Native and our app
    local filters=(
        "ReactNative:V"
        "ReactNativeJS:V"
        "NodeJS:V"
        "MetaHuman:V"
        "System.err:W"
        "*:S"  # Silence everything else
    )

    echo ""
    echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${MAGENTA}                     LIVE DEBUG LOGS                            ${NC}"
    echo -e "${BOLD}${MAGENTA}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Press Ctrl+C to stop  │  R in Metro terminal to reload${NC}"
    echo -e "${MAGENTA}═══════════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run logcat with color formatting
    "$ADB" logcat -v time "${filters[@]}" 2>&1 | while IFS= read -r line; do
        # Color code based on log level
        if [[ "$line" == *" E/"* ]] || [[ "$line" == *"Error"* ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ "$line" == *" W/"* ]] || [[ "$line" == *"Warning"* ]]; then
            echo -e "${YELLOW}$line${NC}"
        elif [[ "$line" == *" I/"* ]]; then
            echo -e "${GREEN}$line${NC}"
        elif [[ "$line" == *" D/"* ]]; then
            echo -e "${CYAN}$line${NC}"
        elif [[ "$line" == *"NodeJS"* ]] || [[ "$line" == *"nodejs"* ]]; then
            echo -e "${MAGENTA}[Node.js]${NC} $line"
        elif [[ "$line" == *"ReactNativeJS"* ]]; then
            echo -e "${BLUE}[JS]${NC} $line"
        else
            echo "$line"
        fi
    done &
    LOGCAT_PID=$!
}

# Launch app on device
launch_app() {
    log INFO "Launching MetaHuman app..."

    local package="com.metahumanrn"
    local activity=".MainActivity"

    "$ADB" shell am start -n "${package}/${activity}" 2>&1 | while read -r line; do
        if [[ "$line" == *"Starting"* ]]; then
            log INFO "App launched"
        elif [[ "$line" == *"Error"* ]]; then
            log ERROR "Launch failed: $line"
        fi
    done
}

# Main workflow
main() {
    print_header

    check_prereqs

    echo ""
    log INFO "=== STEP 1: Environment Setup ==="
    start_emulator

    echo ""
    log INFO "=== STEP 2: Build Handlers ==="
    build_handlers

    echo ""
    log INFO "=== STEP 3: Install App ==="
    install_app

    echo ""
    log INFO "=== STEP 4: Start Metro ==="
    start_metro

    echo ""
    log INFO "=== STEP 5: Launch App ==="
    launch_app

    echo ""
    log INFO "=== STEP 6: Debug Logs ==="
    start_logcat

    # Wait for user to stop
    wait $LOGCAT_PID
}

# Run main
main
