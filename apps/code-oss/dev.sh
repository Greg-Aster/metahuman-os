#!/bin/bash
# MetaHuman Studio - Dev mode with hot reload

export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
unset ELECTRON_RUN_AS_NODE

cd "$(dirname "$0")"

echo "Starting MetaHuman Studio in dev mode..."
echo "Use Ctrl+Shift+P -> 'Developer: Reload Window' to see changes"
echo ""

pnpm run watch &
WATCH_PID=$!
sleep 5
./scripts/code.sh "$@"
kill $WATCH_PID 2>/dev/null
