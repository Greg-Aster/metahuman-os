#!/usr/bin/env bash
# Recorded pixels and actual offline recognition; no live gateway or provider.
set -euo pipefail
if [[ $# != 5 && $# != 6 ]]; then
  echo "Usage: $0 GATEWAY_CHECKOUT PYTHON YOLO_WEIGHTS BUS_JPEG_OR_VIDEO OUTPUT_DIRECTORY [MOT_REFERENCE_GT]" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
export AINEKIO_SOFTWARE_TEST_GATEWAY="$(realpath "$1")"
export AINEKIO_SOFTWARE_TEST_PYTHON="$(realpath -s "$2")"
export AINEKIO_YOLO_WEIGHTS="$(realpath "$3")"
unset AINEKIO_RECORDED_IMAGE AINEKIO_RECORDED_VIDEO
case "${4##*.}" in
  mp4|avi|mov) export AINEKIO_RECORDED_VIDEO="$(realpath "$4")" ;;
  *) export AINEKIO_RECORDED_IMAGE="$(realpath "$4")" ;;
esac
export AINEKIO_PERCEPTION_ARTIFACTS="$(realpath -m "$5")"
mkdir -p "$AINEKIO_PERCEPTION_ARTIFACTS/yolo-settings"
export YOLO_CONFIG_DIR="$AINEKIO_PERCEPTION_ARTIFACTS/yolo-settings"
node --experimental-test-module-mocks --import tsx --test \
  --test-name-pattern='recorded YOLO frames' \
  packages/core/src/environment-interface/perception-gateway.spec.ts \
  > "$AINEKIO_PERCEPTION_ARTIFACTS/test.log" 2>&1 || {
    tail -60 "$AINEKIO_PERCEPTION_ARTIFACTS/test.log" >&2
    exit 1
  }
python3 tests/visual-control-report.py "$AINEKIO_PERCEPTION_ARTIFACTS" "$AINEKIO_SOFTWARE_TEST_GATEWAY" "${6:-}"
