#!/bin/bash
# Launch MetaHuman Studio

export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
unset ELECTRON_RUN_AS_NODE

cd "$(dirname "$0")"
./scripts/code.sh "$@"
