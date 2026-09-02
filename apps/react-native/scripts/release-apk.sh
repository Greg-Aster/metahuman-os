#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RN_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$RN_DIR/../.."
RELEASES_DIR="$ROOT_DIR/out/releases/mobile"
VERSION_FILE="$RELEASES_DIR/version.json"
APK_SOURCE="$RN_DIR/android/app/build/outputs/apk/release/app-release.apk"

usage() {
    echo "Usage: $0 [version] [--notes text]"
}

NEW_VERSION=""
RELEASE_NOTES=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --notes)
            [ "$#" -ge 2 ] || { echo "Error: --notes requires a value."; exit 1; }
            RELEASE_NOTES="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        -*)
            echo "Error: unknown option $1"
            usage
            exit 1
            ;;
        *)
            [ -z "$NEW_VERSION" ] || { echo "Error: provide at most one version."; exit 1; }
            NEW_VERSION="$1"
            shift
            ;;
    esac
done

command -v jq >/dev/null || { echo "Error: jq is required."; exit 1; }
command -v sha256sum >/dev/null || { echo "Error: sha256sum is required."; exit 1; }

SIGNING_VARIABLES=(
    METAHUMAN_ANDROID_KEYSTORE_PATH
    METAHUMAN_ANDROID_KEYSTORE_PASSWORD
    METAHUMAN_ANDROID_KEY_ALIAS
    METAHUMAN_ANDROID_KEY_PASSWORD
)
for variable in "${SIGNING_VARIABLES[@]}"; do
    [ -n "${!variable:-}" ] || {
        echo "Error: $variable is required for a signed release."
        exit 1
    }
done
[ -f "$METAHUMAN_ANDROID_KEYSTORE_PATH" ] || {
    echo "Error: keystore not found at $METAHUMAN_ANDROID_KEYSTORE_PATH"
    exit 1
}

mkdir -p "$RELEASES_DIR"
if [ -f "$VERSION_FILE" ]; then
    CURRENT_VERSION="$(jq -er '.version | strings' "$VERSION_FILE")"
    CURRENT_VERSION_CODE="$(jq -er '.versionCode | numbers' "$VERSION_FILE")"
else
    CURRENT_VERSION="1.0.0"
    CURRENT_VERSION_CODE=0
fi

[[ "$CURRENT_VERSION_CODE" =~ ^[0-9]+$ ]] || {
    echo "Error: current versionCode is not a non-negative integer."
    exit 1
}
NEW_VERSION_CODE=$((CURRENT_VERSION_CODE + 1))
NEW_VERSION="${NEW_VERSION:-$CURRENT_VERSION}"
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || {
    echo "Error: version must use semantic version syntax."
    exit 1
}
RELEASE_NOTES="${RELEASE_NOTES:-Build $NEW_VERSION_CODE - $(date +%Y-%m-%d)}"

echo "Release v$NEW_VERSION (code $NEW_VERSION_CODE): $RELEASE_NOTES"
read -r -p "Build and publish the signed APK? [y/N] " REPLY
[[ "$REPLY" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

METAHUMAN_MOBILE_APP_VERSION="$NEW_VERSION" \
METAHUMAN_MOBILE_APP_VERSION_CODE="$NEW_VERSION_CODE" \
METAHUMAN_MOBILE_BUILD_DATE="$(date -Iseconds)" \
METAHUMAN_MOBILE_BUILD_VARIANT=release \
"$SCRIPT_DIR/build-mobile.sh"

[ -f "$APK_SOURCE" ] || { echo "Error: signed APK not found at $APK_SOURCE"; exit 1; }

APK_VERSIONED="$RELEASES_DIR/metahuman-$NEW_VERSION.apk"
cp "$APK_SOURCE" "$APK_VERSIONED"

APK_SIZE_BYTES="$(stat -c%s "$APK_VERSIONED")"
APK_CHECKSUM="$(sha256sum "$APK_VERSIONED" | awk '{print $1}')"
TEMP_VERSION_FILE="$(mktemp "$RELEASES_DIR/.version.XXXXXX")"
trap 'rm -f "$TEMP_VERSION_FILE"' EXIT
jq -n \
    --arg version "$NEW_VERSION" \
    --argjson versionCode "$NEW_VERSION_CODE" \
    --arg releaseDate "$(date +%Y-%m-%d)" \
    --arg releaseNotes "$RELEASE_NOTES" \
    --argjson fileSize "$APK_SIZE_BYTES" \
    --arg checksum "$APK_CHECKSUM" \
    '{
        version: $version,
        versionCode: $versionCode,
        releaseDate: $releaseDate,
        releaseNotes: $releaseNotes,
        minAndroidVersion: 24,
        fileSize: $fileSize,
        checksum: $checksum
    }' > "$TEMP_VERSION_FILE"
mv "$TEMP_VERSION_FILE" "$VERSION_FILE"
trap - EXIT

echo "Published signed APK v$NEW_VERSION (code $NEW_VERSION_CODE)."
echo "Versioned: $APK_VERSIONED"
