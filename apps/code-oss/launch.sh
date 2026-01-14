#!/usr/bin/env bash
#
# MetaHuman Studio Launch Script
# Uses the official VS Code build script which handles compilation + launch
#

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "🚀 Launching MetaHuman Studio..."
echo ""

# Load nvm and switch to Node 22 (required for VS Code build)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "Switching to Node 22.21.1..."
nvm use 22.21.1

echo "Using official VS Code build script: scripts/code.sh"
echo ""

# Use the official VS Code launch script which:
# 1. Runs preLaunch (downloads Electron, compiles if needed)
# 2. Sets proper development environment variables
# 3. Launches with correct flags
exec "$ROOT/scripts/code.sh" "$@"
