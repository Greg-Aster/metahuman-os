#!/usr/bin/env bash
#
# MetaHuman Studio Development Mode Launcher
# Starts watch mode for auto-compilation + launches the app
#

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22.21.1 >/dev/null 2>&1

echo "🔧 MetaHuman Studio - Development Mode"
echo "========================================"
echo ""
echo "Starting watch mode for auto-compilation..."
echo "Changes to src/ will auto-compile. Use Ctrl+R to reload."
echo ""

# Start watch mode in background
npm run watchd &
WATCH_PID=$!

# Wait a moment for watch to initialize
sleep 5

echo "✅ Watch mode started (PID: $WATCH_PID)"
echo "🚀 Launching MetaHuman Studio..."
echo ""

# Launch the app
"$ROOT/scripts/code.sh" "$@"

# Cleanup: kill watch mode when app exits
kill $WATCH_PID 2>/dev/null || true
