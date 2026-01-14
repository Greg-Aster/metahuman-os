#!/usr/bin/env bash

set -e

# Get script directory
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Set development environment
export NODE_ENV=development
export VSCODE_DEV=1
export ELECTRON_ENABLE_LOGGING=1

# Use the direct Electron binary
ELECTRON="./node_modules/electron/dist/electron"

# Run with the compiled output
exec "$ELECTRON" ./out/main.js --no-sandbox "$@"
