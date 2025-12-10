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

# Step 0: Build mobile handlers (Node.js backend for nodejs-mobile)
# This bundles @metahuman/core into a single file for Node.js 12
echo "[0/4] Building mobile handlers..."
node "$SCRIPT_DIR/build-handlers.mjs"
echo ""

# Step 1: Build Astro with mobile config
echo "[1/4] Building web UI with mobile config..."

# Clear www folder before build (Astro outputs directly here)
rm -rf "$WWW_DIR"/*

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

# Step 2: Verify build output
echo ""
echo "[2/5] Verifying build output..."
cd "$MOBILE_DIR"
echo "  $(find "$WWW_DIR" -type f | wc -l) files in www/"

# Ensure cordova-bridge builtin module exists (required by nodejs-mobile)
NODEJS_MOBILE_ASSETS="$MOBILE_DIR/android/app/src/main/assets/nodejs-mobile-cordova-assets"
CORDOVA_BRIDGE_SOURCE="$MOBILE_DIR/../../node_modules/.pnpm/nodejs-mobile-cordova@0.4.3/node_modules/nodejs-mobile-cordova/install/nodejs-mobile-cordova-assets/builtin_modules"
if [ ! -d "$NODEJS_MOBILE_ASSETS/builtin_modules/cordova-bridge" ]; then
    echo ""
    echo "[2.5/5] Setting up cordova-bridge builtin module..."
    mkdir -p "$NODEJS_MOBILE_ASSETS"
    cp -r "$CORDOVA_BRIDGE_SOURCE" "$NODEJS_MOBILE_ASSETS/"
    echo "  Copied builtin_modules/cordova-bridge/"
else
    echo ""
    echo "[2.5/5] cordova-bridge builtin module already exists"
fi

# Step 3: Sync Capacitor (syncs www/ to assets/public/ for WebView)
echo ""
echo "[3/5] Syncing Capacitor..."
npx cap sync android

# Step 4: Copy nodejs-project to assets/www/ (where nodejs-mobile expects it)
# NOTE: We copy directly here, NOT to www/ first. This avoids:
#   - Redundant copy in assets/public/nodejs-project/ (unused)
#   - Confusion about which copy is active
ANDROID_WWW_ASSETS="$MOBILE_DIR/android/app/src/main/assets/www"
echo ""
echo "[4/5] Copying nodejs-project to Android assets/www/..."
mkdir -p "$ANDROID_WWW_ASSETS"
rm -rf "$ANDROID_WWW_ASSETS/nodejs-project"
cp -r "$MOBILE_DIR/nodejs-project" "$ANDROID_WWW_ASSETS/nodejs-project"
echo "  Copied to assets/www/nodejs-project/ ($(du -sh "$ANDROID_WWW_ASSETS/nodejs-project" | cut -f1))"

# Step 4.5: Copy cognitive graphs and config files for offline operation
# IMPORTANT: Config files must be INSIDE nodejs-project/ because nodejs-mobile
# extracts the contents of nodejs-project/ to files/www/, not the whole assets/www/
REPO_ROOT="$MOBILE_DIR/../.."
NODEJS_ETC="$ANDROID_WWW_ASSETS/nodejs-project/etc"
echo ""
echo "[4.5/5] Copying cognitive graphs and config files..."
mkdir -p "$NODEJS_ETC/cognitive-graphs"
cp -r "$REPO_ROOT/etc/cognitive-graphs"/*.json "$NODEJS_ETC/cognitive-graphs/" 2>/dev/null || true
# Copy custom graphs if any exist
if [ -d "$REPO_ROOT/etc/cognitive-graphs/custom" ]; then
    mkdir -p "$NODEJS_ETC/cognitive-graphs/custom"
    cp -r "$REPO_ROOT/etc/cognitive-graphs/custom"/*.json "$NODEJS_ETC/cognitive-graphs/custom/" 2>/dev/null || true
fi
# Copy essential config files
cp "$REPO_ROOT/etc/models.json" "$NODEJS_ETC/" 2>/dev/null || true
cp "$REPO_ROOT/etc/agents.json" "$NODEJS_ETC/" 2>/dev/null || true
cp "$REPO_ROOT/etc/llm-backend.json" "$NODEJS_ETC/" 2>/dev/null || true
echo "  Copied cognitive graphs and configs to nodejs-project/etc/"

# Step 5: Build APK
echo ""
echo "[5/5] Building APK..."
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
