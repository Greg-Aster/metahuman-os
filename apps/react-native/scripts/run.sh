#!/bin/bash
#
# Quick start - restart app and show filtered logs
#
ADB=~/Android/Sdk/platform-tools/adb

echo "=== MetaHuman Quick Start ==="

# Force stop and restart
$ADB shell am force-stop com.metahumanrn 2>/dev/null
sleep 1
$ADB shell am start -n com.metahumanrn/.MainActivity 2>/dev/null

echo "App started. Showing logs..."
echo "=================================="
echo ""

# Clear old logs and show filtered new ones
$ADB logcat -c
$ADB logcat -s NODEJS-MOBILE:I chromium:I | grep --line-buffered -E "API|remote|credential|callRemote|401|error|Error|warmup|connect|token"
