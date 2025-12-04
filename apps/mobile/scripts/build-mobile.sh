#!/bin/bash
#
# Build MetaHuman Mobile APK with bundled web UI
# This creates a self-contained APK that:
# - Loads UI from bundled assets (offline capable)
# - Makes API calls to the remote server
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
SITE_DIR="$MOBILE_DIR/../site"
WWW_DIR="$MOBILE_DIR/www"

echo "=========================================="
echo "  MetaHuman Mobile Build"
echo "=========================================="
echo ""

# Step 1: Build Astro with mobile config
echo "[1/4] Building web UI with mobile config..."
cd "$SITE_DIR"

# Temporarily move files that can't be statically built
API_DIR="$SITE_DIR/src/pages/api"
API_BACKUP="$SITE_DIR/src/pages/_api.mobile-build-backup"
MIDDLEWARE="$SITE_DIR/src/middleware.ts"
MIDDLEWARE_BACKUP="$SITE_DIR/src/middleware.ts.mobile-build-backup"
PAGES_BACKUP_DIR="$SITE_DIR/src/pages/_mobile-build-backup"

# Pages that use browser APIs and can't be pre-rendered
# These are admin/dev features not needed in mobile app
PAGES_TO_EXCLUDE=(
    "terminal.astro"
    "audit.astro"
    "monitor.astro"
    "events.astro"
)

if [ -d "$API_DIR" ]; then
    echo "  Temporarily moving API routes..."
    mv "$API_DIR" "$API_BACKUP"
fi

# Also move middleware (it has server-only dependencies)
if [ -f "$MIDDLEWARE" ]; then
    mv "$MIDDLEWARE" "$MIDDLEWARE_BACKUP"
fi

# Move pages that can't be statically built
mkdir -p "$PAGES_BACKUP_DIR"
for page in "${PAGES_TO_EXCLUDE[@]}"; do
    if [ -f "$SITE_DIR/src/pages/$page" ]; then
        echo "  Excluding: $page"
        mv "$SITE_DIR/src/pages/$page" "$PAGES_BACKUP_DIR/"
    fi
done

# Cleanup function to restore files
cleanup_api() {
    if [ -d "$API_BACKUP" ]; then
        mv "$API_BACKUP" "$API_DIR"
        echo "  Restored API routes"
    fi
    if [ -f "$MIDDLEWARE_BACKUP" ]; then
        mv "$MIDDLEWARE_BACKUP" "$MIDDLEWARE"
        echo "  Restored middleware"
    fi
    # Restore excluded pages
    if [ -d "$PAGES_BACKUP_DIR" ]; then
        for file in "$PAGES_BACKUP_DIR"/*; do
            if [ -f "$file" ]; then
                mv "$file" "$SITE_DIR/src/pages/"
            fi
        done
        rmdir "$PAGES_BACKUP_DIR" 2>/dev/null || true
        echo "  Restored excluded pages"
    fi
}

# Trap to restore on exit (success or failure)
trap cleanup_api EXIT

# Use mobile config for static build
if [ -f "astro.config.mobile.mjs" ]; then
    pnpm astro build --config astro.config.mobile.mjs
    BUILD_STATUS=$?
else
    echo "Error: astro.config.mobile.mjs not found!"
    exit 1
fi

# Restore API routes
cleanup_api
trap - EXIT

# Check if build succeeded
if [ $BUILD_STATUS -ne 0 ]; then
    echo "Error: Astro build failed!"
    exit 1
fi

# Step 2: Copy built assets to Capacitor www folder
echo ""
echo "[2/4] Copying assets to Capacitor..."
cd "$MOBILE_DIR"

# Clear existing www folder (except .gitkeep)
rm -rf "$WWW_DIR"/*

# Copy built assets
cp -r "$SITE_DIR/dist"/* "$WWW_DIR/"

echo "  Copied $(find "$WWW_DIR" -type f | wc -l) files to www/"

# Step 3: Sync with Capacitor
echo ""
echo "[3/4] Syncing Capacitor..."
npx cap sync android

# Step 4: Build APK
echo ""
echo "[4/4] Building APK..."
cd "$MOBILE_DIR/android"

# Use bundled JDK from Android Studio
export JAVA_HOME="${JAVA_HOME:-/home/greggles/android-studio/jbr}"
export PATH="$JAVA_HOME/bin:$PATH"

./gradlew assembleDebug

# Done!
APK_PATH="$MOBILE_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
APK_SIZE=$(du -h "$APK_PATH" | cut -f1)

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo ""
echo "  APK: $APK_PATH"
echo "  Size: $APK_SIZE"
echo ""
echo "  To install on connected device:"
echo "    adb install -r $APK_PATH"
echo ""
echo "  To serve via HTTP for download:"
echo "    cd $(dirname "$APK_PATH") && python3 -m http.server 8888"
echo ""
