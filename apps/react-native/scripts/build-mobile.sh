#!/bin/bash
#
# Build MetaHuman Mobile APK (React Native)
#
# This creates a self-contained APK that:
# - Loads UI from bundled assets (Svelte in WebView)
# - Runs Node.js 18 backend (nodejs-mobile-react-native)
# - Uses SAME @metahuman/core handlers as web
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RN_DIR="$(dirname "$SCRIPT_DIR")"
SITE_DIR="$RN_DIR/../site"
ROOT_DIR="$RN_DIR/../.."
NODEJS_PROJECT="$RN_DIR/nodejs-assets/nodejs-project"

echo "=========================================="
echo "  MetaHuman Mobile Build (React Native)"
echo "  Node.js 18 - Native fetch, AbortController"
echo "=========================================="
echo ""

# Step 0: Build mobile handlers (Node.js backend)
echo "[0/5] Building mobile handlers (Node.js 18 target)..."
cd "$ROOT_DIR"
node "$SCRIPT_DIR/build-handlers.mjs"
echo ""

# Step 1: Build Svelte UI with mobile config
echo "[1/5] Building web UI with mobile config..."

# The output will go to apps/mobile/www via astro.config.mobile.mjs
# We'll then copy it to React Native assets
TEMP_WWW="$RN_DIR/../mobile/www"

cd "$SITE_DIR"

# Temporarily move files that can't be statically built
API_DIR="$SITE_DIR/src/pages/api"
API_BACKUP="$SITE_DIR/src/pages/_api.mobile-build-backup"
MIDDLEWARE="$SITE_DIR/src/middleware.ts"
MIDDLEWARE_BACKUP="$SITE_DIR/src/middleware.ts.mobile-build-backup"
PAGES_BACKUP_DIR="$SITE_DIR/src/pages/_mobile-build-backup"

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

if [ -f "$MIDDLEWARE" ]; then
    mv "$MIDDLEWARE" "$MIDDLEWARE_BACKUP"
fi

mkdir -p "$PAGES_BACKUP_DIR"
for page in "${PAGES_TO_EXCLUDE[@]}"; do
    if [ -f "$SITE_DIR/src/pages/$page" ]; then
        echo "  Excluding: $page"
        mv "$SITE_DIR/src/pages/$page" "$PAGES_BACKUP_DIR/"
    fi
done

cleanup_api() {
    if [ -d "$API_BACKUP" ]; then
        mv "$API_BACKUP" "$API_DIR"
        echo "  Restored API routes"
    fi
    if [ -f "$MIDDLEWARE_BACKUP" ]; then
        mv "$MIDDLEWARE_BACKUP" "$MIDDLEWARE"
        echo "  Restored middleware"
    fi
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

trap cleanup_api EXIT

if [ -f "astro.config.mobile.mjs" ]; then
    pnpm astro build --config astro.config.mobile.mjs
    BUILD_STATUS=$?
else
    echo "Error: astro.config.mobile.mjs not found!"
    exit 1
fi

cleanup_api
trap - EXIT

if [ $BUILD_STATUS -ne 0 ]; then
    echo "Error: Astro build failed!"
    exit 1
fi

# Step 2: Copy Svelte UI to nodejs-project/www (served by Node.js HTTP server)
# UNIFIED ARCHITECTURE: Node.js serves both static UI AND API routes
# WebView loads from http://127.0.0.1:4322/ - same origin for everything
echo ""
echo "[2/5] Copying Svelte UI to nodejs-project/www..."
NODEJS_WWW="$NODEJS_PROJECT/www"
mkdir -p "$NODEJS_WWW"
rm -rf "$NODEJS_WWW"/*

if [ -d "$TEMP_WWW" ]; then
    cp -r "$TEMP_WWW"/* "$NODEJS_WWW/"
    echo "  Copied $(find "$NODEJS_WWW" -type f | wc -l) files to nodejs-project/www/"
    echo "  Node.js will serve these via HTTP (same as Astro web server)"
else
    echo "Error: Mobile build output not found at $TEMP_WWW"
    exit 1
fi

# Step 3: Copy nodejs-project to Android assets
# nodejs-mobile-react-native expects it at nodejs-assets/nodejs-project/
echo ""
echo "[3/5] Verifying nodejs-project..."
echo "  Location: $NODEJS_PROJECT"
echo "  Size: $(du -sh "$NODEJS_PROJECT" | cut -f1)"
echo "  Has dist/: $([ -d "$NODEJS_PROJECT/dist" ] && echo 'yes' || echo 'no')"

# Step 4: Copy cognitive graphs and config files
NODEJS_ETC="$NODEJS_PROJECT/etc"
echo ""
echo "[4/5] Copying cognitive graphs and config files..."
mkdir -p "$NODEJS_ETC/cognitive-graphs"
cp -r "$ROOT_DIR/etc/cognitive-graphs"/*.json "$NODEJS_ETC/cognitive-graphs/" 2>/dev/null || true

if [ -d "$ROOT_DIR/etc/cognitive-graphs/custom" ]; then
    mkdir -p "$NODEJS_ETC/cognitive-graphs/custom"
    cp -r "$ROOT_DIR/etc/cognitive-graphs/custom"/*.json "$NODEJS_ETC/cognitive-graphs/custom/" 2>/dev/null || true
fi

cp "$ROOT_DIR/etc/models.json" "$NODEJS_ETC/" 2>/dev/null || true
cp "$ROOT_DIR/etc/agents.json" "$NODEJS_ETC/" 2>/dev/null || true
cp "$ROOT_DIR/etc/llm-backend.json" "$NODEJS_ETC/" 2>/dev/null || true
echo "  Copied cognitive graphs and configs"

# Step 5: Build APK
echo ""
echo "[5/5] Building APK..."
cd "$RN_DIR/android"

# Use bundled JDK from Android Studio
export JAVA_HOME="${JAVA_HOME:-/home/greggles/android-studio/jbr}"
export PATH="$JAVA_HOME/bin:$PATH"

./gradlew assembleDebug

APK_PATH="$RN_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
APK_SIZE=$(du -h "$APK_PATH" | cut -f1)

echo ""
echo "=========================================="
echo "  Build Complete! (React Native)"
echo "=========================================="
echo ""
echo "  APK: $APK_PATH"
echo "  Size: $APK_SIZE"
echo ""
echo "  Node.js: 18 (native fetch, AbortController, fs/promises)"
echo "  UI: Svelte in WebView"
echo "  Backend: Same @metahuman/core as web"
echo ""
echo "  To install on connected device:"
echo "    adb install -r $APK_PATH"
echo ""
