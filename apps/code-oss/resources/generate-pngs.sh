#!/bin/bash
#
# MetaHuman Studio Icon Generator
# Opens the browser-based SVG to PNG converter
#

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HTML_FILE="$SCRIPT_DIR/svg-to-png.html"

echo "🎨 MetaHuman Studio Icon Generator"
echo ""
echo "Opening browser-based PNG generator..."
echo "This will open $HTML_FILE in your default browser."
echo ""
echo "Instructions:"
echo "1. Click the size buttons to download PNG files"
echo "2. Save the downloaded files to the appropriate directories:"
echo "   - 512x512 → linux/metahuman-studio.png"
echo "   - 512x512 → server/code-512.png"
echo "   - 192x192 → server/code-192.png"
echo "   - 256x256 → win32/code_150x150.png"
echo ""

# Try to open in browser
if command -v xdg-open &> /dev/null; then
    xdg-open "$HTML_FILE"
elif command -v open &> /dev/null; then
    open "$HTML_FILE"
elif command -v start &> /dev/null; then
    start "$HTML_FILE"
else
    echo "Could not detect browser opener."
    echo "Please manually open: file://$HTML_FILE"
fi

echo ""
echo "For alternative methods (ImageMagick, online tools), see ICON-GENERATION.md"
