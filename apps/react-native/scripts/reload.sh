#!/bin/bash
#
# Quick Reload - Rebuild backend assets and reinstall the APK
#
# Use this when you've made changes to @metahuman/core and want to test
# while keeping the running Metro development server.
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
log "${YELLOW}1/3${NC} Rebuilding backend assets..."
cd "$ROOT_DIR"
node "$SCRIPT_DIR/build-backend.mjs"

ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
if [ ! -x "$ADB" ]; then
    log "${RED}!${NC} ADB not found at $ADB"
    exit 1
fi

log "${YELLOW}2/3${NC} Rebuilding and installing the APK..."
cd "$RN_DIR/android"
./gradlew assembleDebug
"$ADB" install -r "$RN_DIR/android/app/build/outputs/apk/debug/app-debug.apk"

log "${YELLOW}3/3${NC} Restarting the app..."
"$ADB" reverse tcp:8081 tcp:8081 2>/dev/null || true
"$ADB" shell am force-stop com.metahumanrn
"$ADB" shell am start -n com.metahumanrn/.MainActivity

echo ""
log "${GREEN}✓${NC} Quick reload complete!"
echo ""
echo -e "  ${CYAN}Tip:${NC} If changes don't appear, press ${YELLOW}R${NC} in Metro terminal"
echo -e "  ${CYAN}Tip:${NC} For native changes, run ${YELLOW}./scripts/dev.sh --rebuild${NC}"
echo ""
