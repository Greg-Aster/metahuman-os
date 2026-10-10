#!/usr/bin/env bash
# Install the managed Kokoro ONNX runtime and its verified model assets.
set -euo pipefail

DEVICE=cpu
while [ "$#" -gt 0 ]; do
    case "$1" in
        --yes|-y) shift ;;
        --device)
            DEVICE="${2:?--device requires cpu or cuda}"
            shift 2 ;;
        *) echo "Usage: $0 [--yes] [--device cpu|cuda]" >&2; exit 1 ;;
    esac
done
case "$DEVICE" in cpu|cuda) ;; *) echo "Unsupported device: $DEVICE" >&2; exit 1 ;; esac

METAHUMAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KOKORO_DIR="$METAHUMAN_ROOT/external/kokoro"
PYTHON_CMD=""
for candidate in python3 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
        PYTHON_CMD="$candidate"
        break
    fi
done
if [ -z "$PYTHON_CMD" ]; then
    echo "Python 3.10 or newer is required" >&2
    exit 1
fi
if ! command -v espeak-ng >/dev/null 2>&1; then
    echo "Install espeak-ng first (Ubuntu/Debian: sudo apt-get install espeak-ng)" >&2
    exit 1
fi
for required in kokoro_server.py server_defaults.py VOICES.md; do
    if [ ! -f "$KOKORO_DIR/$required" ]; then
        echo "Missing maintained Kokoro file: $required" >&2
        exit 1
    fi
done

cd "$KOKORO_DIR"
if [ ! -d venv ]; then
    "$PYTHON_CMD" -m venv venv
fi

# KPipeline supplies pronunciation only; torch reads existing .pt voicepacks.
# The speech model is executed exclusively by ONNX Runtime.
echo "Installing Kokoro ONNX ($DEVICE)..."
./venv/bin/python3 -m pip install 'kokoro==0.9.4' 'misaki[en,ja,zh]==0.9.4' \
    'kokoro-onnx==0.6.1' 'onnxruntime==1.30.0' soundfile \
    'fastapi>=0.104.0' 'uvicorn>=0.24.0'
if [ "$DEVICE" = cuda ]; then
    # PyPI's 1.30 GPU wheel targets CUDA 13; this feed provides the CUDA 12 build.
    PIP_CONFIG_FILE=/dev/null PIP_EXTRA_INDEX_URL= ./venv/bin/python3 -m pip install \
        --no-deps --force-reinstall \
        --index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/ \
        'onnxruntime-gpu==1.29.0'
fi

# Assets live beside the managed server, outside profiles and version control.
# Verify cached files as well as downloads; never accept a partial model.
./venv/bin/python3 - <<'PYMODELS'
import hashlib
import os
from pathlib import Path
import urllib.request

root = Path("models")
root.mkdir(exist_ok=True)
release = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
assets = {
    "kokoro-v1.0.onnx": "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}

def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            sha.update(block)
    return sha.hexdigest()

for name, expected in assets.items():
    destination = root / name
    if destination.is_file() and digest(destination) == expected:
        print(f"Verified {name}", flush=True)
        continue
    print(f"Downloading and verifying {name}", flush=True)
    temporary = destination.with_suffix(destination.suffix + ".download")
    try:
        with urllib.request.urlopen(f"{release}/{name}", timeout=120) as source, temporary.open("wb") as output:
            while block := source.read(1024 * 1024):
                output.write(block)
        if digest(temporary) != expected:
            raise RuntimeError(f"Checksum mismatch for {name}")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
PYMODELS

./venv/bin/python3 - "$DEVICE" <<'PYVERIFY'
import sys
from kokoro_server import load_model, load_frontend
model = load_model(sys.argv[1])
frontend = load_frontend("a")
assert frontend.model is None, "The pronunciation frontend must not load a second speech model"
assert "af_heart" in model.voices
print(f"Verified ONNX provider: {model.sess.get_providers()[0]}; voices: {len(model.voices)}")
PYVERIFY

echo "Kokoro ONNX installed in $KOKORO_DIR"
echo "Use Voice Settings to select a voice; restart Kokoro through its existing service controls."
echo "CUDA also requires working CUDA/cuDNN libraries; an unavailable requested device fails visibly."
