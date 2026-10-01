#!/usr/bin/env bash
# Install one verified local Kitten Micro model and all eight voices.
set -euo pipefail
case "${1:-}" in ''|--yes|-y) ;; *) echo "Usage: $0 [--yes]" >&2; exit 1 ;; esac
METAHUMAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KITTEN_DIR="$METAHUMAN_ROOT/external/kitten"
command -v espeak-ng >/dev/null || { echo 'Install espeak-ng first' >&2; exit 1; }
cd "$KITTEN_DIR"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'
if [ ! -d venv ]; then python3 -m venv venv; fi

# Keep model weights and downloads out of Python and Hugging Face caches.
./venv/bin/python3 - <<'PYASSETS'
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            sha.update(block)
    return sha.hexdigest()

def download(url, destination, expected):
    if destination.is_file() and digest(destination) == expected:
        print(f'Verified {destination.name}', flush=True)
        return
    temporary = destination.with_suffix(destination.suffix + '.download')
    try:
        with urllib.request.urlopen(url, timeout=120) as source, temporary.open('wb') as output:
            while block := source.read(1024 * 1024):
                output.write(block)
        if digest(temporary) != expected:
            raise RuntimeError(f'Checksum mismatch: {destination.name}')
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

with tempfile.TemporaryDirectory(prefix='metahuman-kitten-') as temporary:
    wheel = Path(temporary) / 'kittentts-0.8.1-py3-none-any.whl'
    download('https://github.com/KittenML/KittenTTS/releases/download/0.8.1/' + wheel.name,
             wheel, '482a436c4f1f3192153710376e459ff3689517ebcda7c2b051e2fd4187b41851')
    # Kitten 0.8.1 imports Misaki but phonemizes with espeak directly. Its
    # misaki[en] extra pulls an unused transformer stack and PyTorch. Install
    # the actual imported dependencies explicitly, then check them below.
    subprocess.run(['venv/bin/python3', '-m', 'pip', 'install', '--no-cache-dir', '--no-deps', str(wheel)], check=True)
    subprocess.run(['venv/bin/python3', '-m', 'pip', 'install', '--no-cache-dir',
                    'onnxruntime==1.30.0', 'misaki==0.9.4', 'phonemizer==3.4.0',
                    'spacy==3.8.16', 'num2words==0.5.14', 'espeakng-loader==0.2.4',
                    'soundfile==0.14.0', 'huggingface-hub==2.0.0',
                    'fastapi==0.141.1', 'uvicorn==0.54.0'], check=True)

root = Path('models')
root.mkdir(exist_ok=True)
revision = '1ccf72b2c2048fd17efac7de2fab32d10e225084'
base = f'https://huggingface.co/KittenML/kitten-tts-micro-0.8/resolve/{revision}'
for name, checksum in {
    'config.json': '1f0bd2208348f9211cb0da64fcd1536eb28228571cc6b09e767eb6e203a0a532',
    'kitten_tts_micro_v0_8.onnx': '95481626fee1ba70ce683e69c534fc7cb38433c46ce42d3abbeafb4b9f1a4123',
    'voices.npz': '112710c1be8ad0e967c190fb0fd95cbe5848ec4791b93209f20b28b7da20dac1',
}.items():
    download(f'{base}/{name}', root / name, checksum)
PYASSETS
./venv/bin/python3 -m pip check
./venv/bin/python3 - <<'PYVERIFY'
from kitten_runtime import VOICES, load_model, synthesize
from importlib.util import find_spec
if find_spec('torch') is not None:
    raise RuntimeError('The Kitten CPU environment must not include PyTorch')
model = load_model()
for voice in VOICES:
    audio = synthesize(model, 'Hello, I am ready.', voice)
    print(f'Verified {voice}: {len(audio)} samples', flush=True)
print('Kitten Micro installed with all eight voices on CPU.')
PYVERIFY
echo 'Start with: ./bin/mh voice-server start kitten'
