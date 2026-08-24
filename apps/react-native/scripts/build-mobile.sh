#!/bin/bash
#
# Build MetaHuman Mobile APK (React Native)
#
# This creates a self-contained APK that:
# - Loads UI from bundled assets (Svelte in WebView)
# - Runs Node.js 18 backend (nodejs-mobile-react-native)
# - Uses SAME @metahuman/core handlers as web
# - Uses release metadata supplied by the publication owner when requested
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RN_DIR="$(dirname "$SCRIPT_DIR")"
SITE_DIR="$RN_DIR/../site"
ROOT_DIR="$RN_DIR/../.."
NODEJS_PROJECT="$RN_DIR/nodejs-assets/nodejs-project"
GENERATED_DIR="$RN_DIR/generated"
TEMP_WWW="$GENERATED_DIR/www"

resolve_java_home() {
    if [ -x "${JAVA_HOME:-}/bin/java" ]; then
        return
    fi

    if [ -n "${ANDROID_STUDIO_JBR:-}" ] && [ -x "$ANDROID_STUDIO_JBR/bin/java" ]; then
        export JAVA_HOME="$ANDROID_STUDIO_JBR"
    elif [ -x "$HOME/android-studio/jbr/bin/java" ]; then
        export JAVA_HOME="$HOME/android-studio/jbr"
    elif command -v java >/dev/null 2>&1; then
        JAVA_BIN="$(readlink -f "$(command -v java)")"
        export JAVA_HOME="$(dirname "$(dirname "$JAVA_BIN")")"
    else
        echo "Error: No usable Java installation found. Set JAVA_HOME to a JDK directory."
        exit 1
    fi
}

resolve_android_home() {
    local candidate
    for candidate in \
        "${ANDROID_HOME:-}" \
        "${ANDROID_SDK_ROOT:-}" \
        "$HOME/Android/Sdk" \
        "$HOME/Android/sdk" \
        "/opt/android-sdk" \
        "/usr/lib/android-sdk"; do
        if [ -n "$candidate" ] && [ -d "$candidate/platforms" ]; then
            export ANDROID_HOME="$candidate"
            export ANDROID_SDK_ROOT="$candidate"
            return
        fi
    done

    echo "Error: No usable Android SDK found. Set ANDROID_HOME to an SDK directory."
    exit 1
}

resolve_java_home
resolve_android_home

echo "=========================================="
echo "  MetaHuman Mobile Build (React Native)"
echo "  Node.js 18 - Native fetch, AbortController"
echo "=========================================="
echo ""

cat > "$NODEJS_PROJECT/.env" << EOF
APP_VERSION=${METAHUMAN_MOBILE_APP_VERSION:-dev}
APP_VERSION_CODE=${METAHUMAN_MOBILE_APP_VERSION_CODE:-0}
APP_BUILD_DATE=${METAHUMAN_MOBILE_BUILD_DATE:-development}
METAHUMAN_MOBILE=true
EOF

# Step 0: Build mobile handlers (Node.js backend)
echo "[0/4] Building mobile backend (Node.js 18 target)..."
cd "$ROOT_DIR"
node "$SCRIPT_DIR/build-backend.mjs"
echo ""

# Step 1: Build the mobile Site surface
echo "[1/4] Building web UI with mobile config..."
cd "$SITE_DIR"
if [ ! -f "astro.config.mobile.mjs" ]; then
    echo "Error: astro.config.mobile.mjs not found!"
    exit 1
fi
rm -rf "$GENERATED_DIR"
pnpm astro build --config astro.config.mobile.mjs

# Step 2: Copy Svelte UI to nodejs-project/www (served by Node.js HTTP server)
# UNIFIED ARCHITECTURE: Node.js serves both static UI AND API routes
# WebView loads from http://127.0.0.1:4322/ - same origin for everything
echo ""
echo "[2/4] Copying Svelte UI to nodejs-project/www..."
NODEJS_WWW="$NODEJS_PROJECT/www"
mkdir -p "$NODEJS_WWW"
rm -rf "$NODEJS_WWW"/*

if [ -d "$TEMP_WWW" ]; then
    cp -r "$TEMP_WWW"/* "$NODEJS_WWW/"
    # Remove API routes from www - they're handled by Node.js directly, not static files
    # The _id_ directories cause Android asset copy failures
    rm -rf "$NODEJS_WWW/pages/api" 2>/dev/null || true
    # CRITICAL: Remove downloads folder - it contains APKs which bloat the build recursively!
    rm -rf "$NODEJS_WWW/downloads" 2>/dev/null || true
    echo "  Copied $(find "$NODEJS_WWW" -type f | wc -l) files to nodejs-project/www/"
    echo "  Node.js will serve these via HTTP (same as Astro web server)"
    rm -rf "$GENERATED_DIR"
else
    echo "Error: Mobile build output not found at $TEMP_WWW"
    exit 1
fi

# Step 3: Copy nodejs-project to Android assets
# nodejs-mobile-react-native expects it at nodejs-assets/nodejs-project/
echo ""
echo "[3/4] Verifying nodejs-project..."
echo "  Location: $NODEJS_PROJECT"
echo "  Size: $(du -sh "$NODEJS_PROJECT" | cut -f1)"
echo "  Has dist/: $([ -d "$NODEJS_PROJECT/dist" ] && echo 'yes' || echo 'no')"

# Step 4: Build APK
echo ""
echo "[4/4] Building APK..."
cd "$RN_DIR/android"

export PATH="$JAVA_HOME/bin:$PATH"

case "${METAHUMAN_MOBILE_BUILD_VARIANT:-debug}" in
    debug)
        GRADLE_TASK="assembleDebug"
        APK_PATH="$RN_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
        ;;
    release)
        GRADLE_TASK="assembleRelease"
        APK_PATH="$RN_DIR/android/app/build/outputs/apk/release/app-release.apk"
        ;;
    *)
        echo "Error: METAHUMAN_MOBILE_BUILD_VARIANT must be debug or release."
        exit 1
        ;;
esac

./gradlew "$GRADLE_TASK"

if [ ! -f "$APK_PATH" ]; then
    echo "Error: APK not found at $APK_PATH"
    exit 1
fi
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
