#!/bin/bash
# Development script for MetaHuman Mobile
# Starts both the web dev server and Android app with live reload

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
SITE_DIR="$MOBILE_DIR/../site"
ROOT_DIR="$MOBILE_DIR/../.."

# Get local IP for device connection
DEV_IP=$(hostname -I | awk '{print $1}')
export DEV_SERVER_IP="$DEV_IP"
export DEV_MODE="true"

echo "═══════════════════════════════════════════════════════"
echo "  MetaHuman Mobile Development"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Dev Server: http://$DEV_IP:4321"
echo "  Make sure your Android device is on the same network"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""

# Check if web dev server is already running
if curl -s "http://localhost:4321" > /dev/null 2>&1; then
    echo "✓ Web dev server already running on :4321"
else
    echo "Starting web dev server..."
    cd "$SITE_DIR"
    pnpm dev &
    WEB_PID=$!

    # Wait for server to be ready
    echo "Waiting for dev server..."
    for i in {1..30}; do
        if curl -s "http://localhost:4321" > /dev/null 2>&1; then
            echo "✓ Dev server ready"
            break
        fi
        sleep 1
    done
fi

echo ""
echo "Starting Android app with live reload..."
echo "(Make sure USB debugging is enabled and device is connected)"
echo ""

cd "$MOBILE_DIR"
npx cap run android --livereload --external

# Cleanup on exit
trap "kill $WEB_PID 2>/dev/null" EXIT
