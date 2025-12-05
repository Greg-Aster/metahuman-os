#!/bin/bash
#
# Publish a new mobile app release
#
# This script:
# 1. Builds a release APK
# 2. Copies it to the releases directory
# 3. Updates version.json with release metadata
#
# Usage:
#   ./scripts/publish-release.sh [version] [release_notes]
#
# Example:
#   ./scripts/publish-release.sh 1.2.0 "Bug fixes and performance improvements"
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
RELEASES_DIR="$MOBILE_DIR/releases"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get version from argument or gradle
if [ -n "$1" ]; then
    VERSION="$1"
else
    # Try to extract from build.gradle
    VERSION=$(grep -oP 'versionName\s*"\K[^"]+' "$MOBILE_DIR/android/app/build.gradle" 2>/dev/null || echo "")
    if [ -z "$VERSION" ]; then
        echo -e "${RED}Error: Could not determine version. Please specify as argument.${NC}"
        echo "Usage: $0 <version> [release_notes]"
        exit 1
    fi
fi

# Get release notes
RELEASE_NOTES="${2:-No release notes provided.}"

# Get version code from gradle
VERSION_CODE=$(grep -oP 'versionCode\s*\K\d+' "$MOBILE_DIR/android/app/build.gradle" 2>/dev/null || echo "1")

echo -e "${GREEN}Publishing MetaHuman Mobile v$VERSION (build $VERSION_CODE)${NC}"
echo "Release notes: $RELEASE_NOTES"
echo ""

# Ensure releases directory exists
mkdir -p "$RELEASES_DIR"

# Check for APK
APK_DEBUG="$MOBILE_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
APK_RELEASE="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"

if [ -f "$APK_RELEASE" ]; then
    APK_SOURCE="$APK_RELEASE"
    echo "Using release APK"
elif [ -f "$APK_DEBUG" ]; then
    APK_SOURCE="$APK_DEBUG"
    echo -e "${YELLOW}Warning: Using debug APK (release APK not found)${NC}"
else
    echo -e "${YELLOW}APK not found. Building...${NC}"

    # Build the mobile app
    cd "$MOBILE_DIR"
    ./scripts/build-mobile.sh

    if [ -f "$APK_DEBUG" ]; then
        APK_SOURCE="$APK_DEBUG"
    else
        echo -e "${RED}Error: Build failed - no APK produced${NC}"
        exit 1
    fi
fi

# Copy APK to releases directory
APK_DEST="$RELEASES_DIR/metahuman-$VERSION.apk"
echo "Copying APK to $APK_DEST..."
cp "$APK_SOURCE" "$APK_DEST"

# Get file size
FILE_SIZE=$(stat -f%z "$APK_DEST" 2>/dev/null || stat -c%s "$APK_DEST" 2>/dev/null || echo "0")

# Calculate checksum
CHECKSUM=$(sha256sum "$APK_DEST" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$APK_DEST" | cut -d' ' -f1 || echo "")

# Get current date
RELEASE_DATE=$(date +%Y-%m-%d)

# Create/update version.json
VERSION_JSON="$RELEASES_DIR/version.json"
cat > "$VERSION_JSON" << EOF
{
  "version": "$VERSION",
  "versionCode": $VERSION_CODE,
  "releaseDate": "$RELEASE_DATE",
  "releaseNotes": "$RELEASE_NOTES",
  "minAndroidVersion": 24,
  "fileSize": $FILE_SIZE,
  "checksum": "$CHECKSUM"
}
EOF

echo ""
echo -e "${GREEN}✅ Release published successfully!${NC}"
echo ""
echo "Files created:"
echo "  - $APK_DEST"
echo "  - $VERSION_JSON"
echo ""
echo "Version info:"
cat "$VERSION_JSON"
echo ""
echo -e "${YELLOW}Note: Mobile apps will see this update when they check for updates.${NC}"
