#!/bin/bash
#
# Set up nodejs-mobile integration for Capacitor build
# Run this AFTER npx cap sync android
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="$MOBILE_DIR/android"
PLUGIN_DIR="$MOBILE_DIR/node_modules/nodejs-mobile-cordova"
CORDOVA_PLUGINS_DIR="$ANDROID_DIR/capacitor-cordova-android-plugins"
APP_DIR="$ANDROID_DIR/app"

echo "Setting up nodejs-mobile for Capacitor..."

# 1. Create www folder with nodejs-project (in BOTH locations)
echo "  [1/4] Setting up nodejs-project assets..."
# Copy to cordova-plugins www (for build)
mkdir -p "$CORDOVA_PLUGINS_DIR/src/main/assets/www/nodejs-project"
cp -r "$MOBILE_DIR/nodejs-project/"* "$CORDOVA_PLUGINS_DIR/src/main/assets/www/nodejs-project/"
# Also copy to app www (this is where Capacitor syncs web assets)
mkdir -p "$APP_DIR/src/main/assets/www/nodejs-project"
cp -r "$MOBILE_DIR/nodejs-project/"* "$APP_DIR/src/main/assets/www/nodejs-project/"

# 2. Set up native libs in capacitor-cordova-android-plugins
echo "  [2/4] Setting up native libs for cordova-plugins module..."
mkdir -p "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile"
cp "$PLUGIN_DIR/src/android/CMakeLists.txt" "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile/"
cp "$PLUGIN_DIR/src/android/jni"/*.cpp "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile/" 2>/dev/null || true
cp "$PLUGIN_DIR/src/common/cordova-bridge/cordova-bridge.cpp" "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile/"
cp "$PLUGIN_DIR/src/common/cordova-bridge/cordova-bridge.h" "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile/"
cp -r "$PLUGIN_DIR/libs/android/libnode" "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile/"

# 3. Set up native libs in app module
echo "  [3/4] Setting up native libs for app module..."
mkdir -p "$APP_DIR/libs/cdvnodejsmobile"
cp "$PLUGIN_DIR/src/android/CMakeLists.txt" "$APP_DIR/libs/cdvnodejsmobile/"
cp "$PLUGIN_DIR/src/android/jni"/*.cpp "$APP_DIR/libs/cdvnodejsmobile/" 2>/dev/null || true
cp "$PLUGIN_DIR/src/common/cordova-bridge/cordova-bridge.cpp" "$APP_DIR/libs/cdvnodejsmobile/"
cp "$PLUGIN_DIR/src/common/cordova-bridge/cordova-bridge.h" "$APP_DIR/libs/cdvnodejsmobile/"
cp -r "$PLUGIN_DIR/libs/android/libnode" "$APP_DIR/libs/cdvnodejsmobile/"

# 4. Update CMakeLists.txt to include source directory for headers
echo "  [4/4] Updating CMakeLists.txt..."
for cmake_file in "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile/CMakeLists.txt" "$APP_DIR/libs/cdvnodejsmobile/CMakeLists.txt"; do
    if grep -q "include_directories(libnode/include/node/)" "$cmake_file" 2>/dev/null; then
        sed -i 's|include_directories(libnode/include/node/)|include_directories(\${CMAKE_SOURCE_DIR} libnode/include/node/)|' "$cmake_file"
    fi
    # Add project() if missing
    if ! grep -q "project(" "$cmake_file" 2>/dev/null; then
        sed -i 's/cmake_minimum_required(VERSION 3.4.1)/cmake_minimum_required(VERSION 3.4.1)\nproject(nodejs-mobile-cordova)/' "$cmake_file"
    fi
done

# 5. Decompress libnode.so files
echo "  [5/5] Decompressing libnode.so files..."
for dir in "$CORDOVA_PLUGINS_DIR/libs/cdvnodejsmobile/libnode/bin" "$APP_DIR/libs/cdvnodejsmobile/libnode/bin"; do
    for abi in arm64-v8a armeabi-v7a x86 x86_64; do
        if [ -f "$dir/$abi/libnode.so.gz" ] && [ ! -f "$dir/$abi/libnode.so" ]; then
            gunzip -k "$dir/$abi/libnode.so.gz"
        fi
    done
done

# 6. Set up nodejs-mobile-cordova-assets in app (includes builtin_modules with cordova-bridge)
echo "  [6/7] Setting up nodejs-mobile-cordova-assets..."
rm -rf "$APP_DIR/src/main/assets/nodejs-mobile-cordova-assets"
cp -r "$PLUGIN_DIR/install/nodejs-mobile-cordova-assets" "$APP_DIR/src/main/assets/"
# Add our nodejs-project to the assets
cp -r "$MOBILE_DIR/nodejs-project/"* "$APP_DIR/src/main/assets/nodejs-mobile-cordova-assets/"

# 7. Also copy builtin_modules to capacitor-cordova-android-plugins assets
echo "  [7/7] Setting up builtin_modules in cordova-plugins..."
cp -r "$PLUGIN_DIR/install/nodejs-mobile-cordova-assets/builtin_modules" "$CORDOVA_PLUGINS_DIR/src/main/assets/"

echo "nodejs-mobile setup complete!"
