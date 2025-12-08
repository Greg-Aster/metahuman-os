#!/bin/bash
#
# Quick-start script for Android emulator debugging
# Usage: ./emulator.sh [command]
#
# Commands:
#   start     - Start emulator and install app (default)
#   install   - Just install/update APK on running emulator
#   launch    - Just launch the app
#   logs      - Show app logs (logcat)
#   stop      - Stop the emulator
#   status    - Check emulator status
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
APK_PATH="$MOBILE_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE_NAME="com.metahuman.os"
AVD_NAME="Medium_Phone_API_36"
ANDROID_SDK="$HOME/Android/Sdk"
EMULATOR="$ANDROID_SDK/emulator/emulator"
ADB="$ANDROID_SDK/platform-tools/adb"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Header
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MetaHuman Mobile Emulator Tool${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check prerequisites
check_kvm() {
    if [ ! -e /dev/kvm ]; then
        echo -e "${RED}Error: KVM not available${NC}"
        echo "Enable Intel VT-x or AMD-V in your BIOS settings"
        exit 1
    fi
}

check_emulator_running() {
    $ADB devices 2>/dev/null | grep -q "emulator-" && return 0 || return 1
}

wait_for_boot() {
    echo -e "${BLUE}Waiting for emulator to boot...${NC}"
    $ADB wait-for-device

    # Wait for boot_completed
    local timeout=120
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if [ "$($ADB shell getprop sys.boot_completed 2>/dev/null)" = "1" ]; then
            echo -e "${GREEN}Emulator booted successfully${NC}"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        echo -ne "\r  Boot progress: ${elapsed}s / ${timeout}s"
    done
    echo ""
    echo -e "${YELLOW}Warning: Boot timeout, continuing anyway...${NC}"
}

start_emulator() {
    check_kvm

    if check_emulator_running; then
        echo -e "${YELLOW}Emulator already running${NC}"
    else
        echo -e "${BLUE}Starting emulator: $AVD_NAME${NC}"

        # Check if AVD exists
        if ! $EMULATOR -list-avds 2>/dev/null | grep -q "$AVD_NAME"; then
            echo -e "${RED}Error: AVD '$AVD_NAME' not found${NC}"
            echo "Available AVDs:"
            $EMULATOR -list-avds
            exit 1
        fi

        # Start emulator in background
        $EMULATOR -avd "$AVD_NAME" -gpu swiftshader_indirect &>/dev/null &

        wait_for_boot
    fi
}

install_apk() {
    if [ ! -f "$APK_PATH" ]; then
        echo -e "${YELLOW}APK not found. Building first...${NC}"
        "$SCRIPT_DIR/build-mobile.sh"
    fi

    echo -e "${BLUE}Installing APK...${NC}"
    $ADB install -r "$APK_PATH"
    echo -e "${GREEN}APK installed${NC}"
}

launch_app() {
    echo -e "${BLUE}Launching app...${NC}"
    $ADB shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    echo -e "${GREEN}App launched${NC}"
}

show_logs() {
    echo -e "${BLUE}Showing logs for $PACKAGE_NAME (Ctrl+C to stop)${NC}"
    echo ""
    # Get the PID of the app
    PID=$($ADB shell pidof "$PACKAGE_NAME" 2>/dev/null || echo "")
    if [ -n "$PID" ]; then
        $ADB logcat --pid="$PID"
    else
        # Fallback to filtering by tag
        $ADB logcat | grep -E "(Capacitor|WebView|$PACKAGE_NAME)"
    fi
}

stop_emulator() {
    echo -e "${BLUE}Stopping emulator...${NC}"
    $ADB emu kill 2>/dev/null || true
    echo -e "${GREEN}Emulator stopped${NC}"
}

show_status() {
    echo -e "${BLUE}Emulator Status:${NC}"
    if check_emulator_running; then
        echo -e "  Status: ${GREEN}Running${NC}"
        DEVICE=$($ADB devices | grep "emulator-" | cut -f1)
        echo -e "  Device: ${CYAN}$DEVICE${NC}"

        # Check if app is installed
        if $ADB shell pm list packages 2>/dev/null | grep -q "$PACKAGE_NAME"; then
            echo -e "  App: ${GREEN}Installed${NC}"

            # Check if app is running
            PID=$($ADB shell pidof "$PACKAGE_NAME" 2>/dev/null || echo "")
            if [ -n "$PID" ]; then
                echo -e "  App Status: ${GREEN}Running (PID: $PID)${NC}"
            else
                echo -e "  App Status: ${YELLOW}Not running${NC}"
            fi
        else
            echo -e "  App: ${YELLOW}Not installed${NC}"
        fi
    else
        echo -e "  Status: ${YELLOW}Not running${NC}"
    fi

    echo ""
    echo -e "${BLUE}APK Status:${NC}"
    if [ -f "$APK_PATH" ]; then
        APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
        APK_DATE=$(stat -c %y "$APK_PATH" | cut -d'.' -f1)
        echo -e "  Path: ${CYAN}$APK_PATH${NC}"
        echo -e "  Size: ${CYAN}$APK_SIZE${NC}"
        echo -e "  Built: ${CYAN}$APK_DATE${NC}"
    else
        echo -e "  ${YELLOW}APK not built yet${NC}"
    fi

    echo ""
    echo -e "${BLUE}Debug Info:${NC}"
    echo -e "  Chrome DevTools: ${CYAN}chrome://inspect${NC}"
    echo -e "  Package: ${CYAN}$PACKAGE_NAME${NC}"
}

show_help() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start     Start emulator, install APK, and launch app (default)"
    echo "  install   Install/update APK on running emulator"
    echo "  launch    Launch the app"
    echo "  logs      Show app logs (logcat)"
    echo "  stop      Stop the emulator"
    echo "  status    Check emulator and app status"
    echo "  help      Show this help message"
    echo ""
    echo "Quick Start:"
    echo "  ./emulator.sh           # Start everything"
    echo "  ./emulator.sh logs      # Watch app logs"
    echo ""
    echo "Debug in Chrome:"
    echo "  1. Run: ./emulator.sh"
    echo "  2. Open Chrome and go to: chrome://inspect"
    echo "  3. Click 'inspect' under the WebView"
}

# Main
COMMAND="${1:-start}"

case "$COMMAND" in
    start)
        start_emulator
        install_apk
        launch_app
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  Ready for debugging!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo -e "  ${CYAN}Chrome DevTools:${NC} chrome://inspect"
        echo -e "  ${CYAN}View logs:${NC} ./emulator.sh logs"
        echo ""
        ;;
    install)
        install_apk
        ;;
    launch)
        launch_app
        ;;
    logs)
        show_logs
        ;;
    stop)
        stop_emulator
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        show_help
        exit 1
        ;;
esac
