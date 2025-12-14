#!/bin/bash
#
# Quick Reload - Rebuild handlers and trigger Metro hot reload
#
# Use this when you've made changes to @metahuman/core and want to test
# without restarting the whole dev environment.
#
# Prerequisites: Metro must be running (via dev.sh)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RN_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$RN_DIR/../.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() {
    local timestamp=$(date '+%H:%M:%S')
    echo -e "${CYAN}[$timestamp]${NC} $1"
}

log "${GREEN}▶${NC} Quick reload starting..."

# Step 1: Rebuild handlers
log "${YELLOW}1/3${NC} Rebuilding handlers..."
cd "$ROOT_DIR"
node "$SCRIPT_DIR/build-handlers.mjs"

# Step 2: Send reload command to Metro via adb
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"

if command -v "$ADB" &> /dev/null; then
    log "${YELLOW}2/3${NC} Triggering Metro reload..."

    # Method 1: Send 'R' key to trigger reload in dev menu
    # Method 2: Use adb reverse to ensure Metro is accessible
    "$ADB" reverse tcp:8081 tcp:8081 2>/dev/null || true

    # Method 3: Open React Native dev menu and trigger reload
    "$ADB" shell input keyevent 82 2>/dev/null || true  # Menu key opens dev menu
    sleep 0.5
    "$ADB" shell input keyevent 66 2>/dev/null || true  # Enter to select first option (usually Reload)

    log "${YELLOW}3/3${NC} Reload triggered"
else
    log "${RED}!${NC} ADB not found, manual reload needed (press R in Metro terminal)"
fi

echo ""
log "${GREEN}✓${NC} Quick reload complete!"
echo ""
echo -e "  ${CYAN}Tip:${NC} If changes don't appear, press ${YELLOW}R${NC} in Metro terminal"
echo -e "  ${CYAN}Tip:${NC} For native changes, run ${YELLOW}./scripts/dev.sh --rebuild${NC}"
echo ""
