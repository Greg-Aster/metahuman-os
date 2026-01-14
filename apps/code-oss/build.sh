#!/usr/bin/env bash
#
# MetaHuman Studio Build Script
# Compiles all TypeScript and prepares for production
#

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22.21.1 >/dev/null 2>&1

echo "🔨 MetaHuman Studio - Build"
echo "============================"
echo ""
echo "Running full compilation..."
echo ""

# Run the compile task
npm run compile

echo ""
echo "✅ Build complete!"
echo ""
echo "To launch MetaHuman Studio:"
echo "  ./launch.sh          - Regular mode"
echo "  ./launch-dev.sh      - Development mode (with watch)"
