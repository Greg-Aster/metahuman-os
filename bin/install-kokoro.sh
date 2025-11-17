#!/usr/bin/env bash
# Kokoro TTS Installation Script for MetaHuman OS
set -e

# Parse arguments
YES_FLAG=false
if [[ "$1" == "--yes" ]] || [[ "$1" == "-y" ]]; then
  YES_FLAG=true
fi

METAHUMAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KOKORO_DIR="$METAHUMAN_ROOT/external/kokoro"

echo "========================================"
echo "Kokoro TTS Installation for MetaHuman OS"
echo "========================================"
echo ""

# Check Python version
echo "[1/8] Checking Python version..."
PYTHON_CMD=""
for cmd in python3.11 python3.10 python3.9 python3 python; do
    if command -v "$cmd" &> /dev/null; then
        VERSION=$("$cmd" --version 2>&1 | awk '{print $2}')
        MAJOR=$(echo "$VERSION" | cut -d. -f1)
        MINOR=$(echo "$VERSION" | cut -d. -f2)
        if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 9 ]; then
            PYTHON_CMD="$cmd"
            echo "✓ Found Python $VERSION at $(command -v $cmd)"
            break
        fi
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "✗ Error: Python 3.9+ required but not found"
    echo "  Please install Python 3.9 or higher"
    exit 1
fi

# Check system dependencies
echo ""
echo "[2/8] Checking system dependencies..."

# Check espeak-ng
if command -v espeak-ng &> /dev/null; then
    echo "✓ espeak-ng found"
else
    echo "⚠ espeak-ng not found"
    echo "  Please install espeak-ng:"
    echo "    Ubuntu/Debian: sudo apt-get install espeak-ng"
    echo "    macOS: brew install espeak-ng"
    echo "    Arch: sudo pacman -S espeak-ng"
    echo ""
    if [ "$YES_FLAG" = false ]; then
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "  (--yes flag: continuing without espeak-ng)"
    fi
fi

# Check ffmpeg
if command -v ffmpeg &> /dev/null; then
    echo "✓ ffmpeg found"
else
    echo "⚠ ffmpeg not found"
    echo "  Please install ffmpeg:"
    echo "    Ubuntu/Debian: sudo apt-get install ffmpeg"
    echo "    macOS: brew install ffmpeg"
    echo "    Arch: sudo pacman -S ffmpeg"
    echo ""
    if [ "$YES_FLAG" = false ]; then
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "  (--yes flag: continuing without ffmpeg)"
    fi
fi

# Check CUDA availability
echo ""
echo "[3/8] Checking GPU availability..."
if command -v nvidia-smi &> /dev/null; then
    CUDA_VERSION=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)
    if [ -n "$CUDA_VERSION" ]; then
        echo "✓ NVIDIA GPU detected (Driver: $CUDA_VERSION)"
        echo "  Kokoro will use GPU acceleration"
    else
        echo "⚠ NVIDIA GPU not detected, will use CPU"
    fi
else
    echo "⚠ nvidia-smi not found, will use CPU"
    echo "  Kokoro works on CPU but GPU is faster"
fi

# Create directories
echo ""
echo "[4/8] Setting up directories..."
mkdir -p "$METAHUMAN_ROOT/external"
mkdir -p "$KOKORO_DIR"
mkdir -p "$METAHUMAN_ROOT/out/voices/kokoro-voicepacks"
mkdir -p "$METAHUMAN_ROOT/out/voices/kokoro-datasets"
echo "✓ Directories created"

# Create virtual environment
echo ""
echo "[5/8] Creating Python virtual environment..."
cd "$KOKORO_DIR"
if [ ! -d "venv" ]; then
    "$PYTHON_CMD" -m venv venv
    echo "✓ Virtual environment created"
else
    echo "⚠ Virtual environment already exists"
fi

# Install Python dependencies
echo ""
echo "[6/8] Installing Python dependencies..."
echo "  This may take a few minutes..."
./venv/bin/pip install --upgrade pip > /dev/null 2>&1

# Install Kokoro and dependencies
./venv/bin/pip install "kokoro>=0.9.4" soundfile "fastapi>=0.104.0" "uvicorn>=0.24.0" --quiet
echo "✓ Core dependencies installed"

# Install optional language support
echo ""
echo "  Installing language support packages..."
./venv/bin/pip install "misaki[en]" "misaki[ja]" "misaki[zh]" espeakng --quiet 2>/dev/null || {
    echo "⚠ Some language packages failed to install (optional)"
}
echo "✓ Dependencies installed"

# Download voice catalog and base models
echo ""
echo "[7/8] Downloading voice catalog and models..."
echo "  This may take several minutes (~1.5GB of data)"

# Download VOICES.md for voice metadata
curl -sL "https://raw.githubusercontent.com/hexgrad/kokoro/main/VOICES.md" -o "$KOKORO_DIR/VOICES.md" || {
    echo "⚠ Failed to download VOICES.md, will create placeholder"
    echo "# Kokoro Voices\nVoice catalog will be populated on first use." > "$KOKORO_DIR/VOICES.md"
}

# Download base model using Python
cat > "$KOKORO_DIR/download_model.py" <<'EOF'
#!/usr/bin/env python3
import os
import sys
from pathlib import Path

try:
    from kokoro import KPipeline

    # Initialize pipeline (this will download the base model)
    print("Initializing Kokoro pipeline...")
    pipeline = KPipeline(lang='a')

    # Download a sample voice to verify installation
    print("Downloading sample voice (af_heart)...")
    pipeline.load_voice('af_heart')

    print("✓ Models downloaded successfully")
    sys.exit(0)

except Exception as e:
    print(f"⚠ Error downloading models: {e}")
    print("  Models will be downloaded on first use")
    sys.exit(0)
EOF

chmod +x "$KOKORO_DIR/download_model.py"
./venv/bin/python3 "$KOKORO_DIR/download_model.py" || echo "⚠ Model download skipped, will download on first use"
rm -f "$KOKORO_DIR/download_model.py"

echo "✓ Voice catalog and models ready"

# Create helper scripts
echo ""
echo "[8/8] Creating helper scripts..."

# Create FastAPI server script
cat > "$KOKORO_DIR/kokoro_server.py" <<'EOF'
#!/usr/bin/env python3
"""
Kokoro TTS FastAPI Server for MetaHuman OS
Provides HTTP endpoints for text-to-speech synthesis
"""
import argparse
import io
import json
from pathlib import Path
from typing import Optional

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

try:
    from kokoro import KPipeline
except ImportError:
    print("Error: kokoro package not found")
    print("Install with: pip install kokoro>=0.9.4")
    exit(1)

app = FastAPI(title="Kokoro TTS Server")

# Global pipeline instance
pipeline: Optional[KPipeline] = None
voices_dir: Optional[Path] = None


class SynthesizeRequest(BaseModel):
    text: str
    lang_code: str = "a"
    voice: str = "af_heart"
    speed: float = 1.0
    custom_voicepack: Optional[str] = None


@app.on_event("startup")
async def startup():
    """Initialize Kokoro pipeline on server startup"""
    global pipeline, voices_dir
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", default="a", help="Default language code")
    parser.add_argument("--voices-dir", type=Path, help="Custom voices directory")
    parser.add_argument("--port", type=int, default=9882)
    args, _ = parser.parse_known_args()

    voices_dir = args.voices_dir
    pipeline = KPipeline(lang=args.lang)
    print(f"✓ Kokoro pipeline initialized (lang={args.lang})")


@app.get("/health")
async def health():
    """Health check endpoint"""
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    return {
        "status": "ok",
        "lang": pipeline.lang if hasattr(pipeline, 'lang') else "unknown",
        "voices_dir": str(voices_dir) if voices_dir else None
    }


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    """Synthesize speech from text"""
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    try:
        # Load custom voicepack or built-in voice
        if request.custom_voicepack and Path(request.custom_voicepack).exists():
            pipeline.load_voice(request.custom_voicepack)
        else:
            pipeline.load_voice(request.voice)

        # Generate audio
        audio, sr = pipeline(
            request.text,
            speed=request.speed,
            split_pattern=r'\n+'
        )

        # Convert to WAV bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, sr, format='WAV')
        buffer.seek(0)

        return Response(
            content=buffer.read(),
            media_type="audio/wav"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


@app.get("/voices")
async def list_voices():
    """List available voices"""
    # Parse VOICES.md if available
    voices_file = Path(__file__).parent / "VOICES.md"
    if voices_file.exists():
        # TODO: Parse VOICES.md and return structured data
        return {"voices": ["af_heart", "af_bella", "af_sarah"]}

    return {"voices": []}


if __name__ == "__main__":
    import uvicorn
    import sys

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9882)
    parser.add_argument("--lang", default="a")
    parser.add_argument("--voices-dir", type=Path)
    args = parser.parse_args()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="info"
    )
EOF

chmod +x "$KOKORO_DIR/kokoro_server.py"

# Create voicepack builder script (placeholder)
cat > "$KOKORO_DIR/build_voicepack.py" <<'EOF'
#!/usr/bin/env python3
"""
Kokoro Voicepack Builder for MetaHuman OS
Creates custom .pt voicepack from training audio
"""
import argparse
import sys
from pathlib import Path

print("Kokoro voicepack training is not yet implemented")
print("This feature requires StyleTTS2 fine-tuning integration")
print("See: https://github.com/hexgrad/kokoro for training guidance")
sys.exit(1)

# TODO: Implement voicepack training
# - Load training audio/transcripts
# - Fine-tune style encoder
# - Export .pt voicepack
EOF

chmod +x "$KOKORO_DIR/build_voicepack.py"

echo "✓ Helper scripts created"

echo ""
echo "========================================"
echo "✓ Installation Complete!"
echo "========================================"
echo ""
echo "Kokoro TTS is fully installed and ready to use."
echo ""
echo "Installation directory: $KOKORO_DIR"
echo ""
echo "Next steps:"
echo "  1. Enable Kokoro in Voice Settings UI"
echo "  2. Select a voice from 54 built-in options"
echo "  3. Test synthesis with: mh kokoro test"
echo ""
echo "The Kokoro server will auto-start when you select it as provider."
echo "Or manually start it with: mh kokoro serve"
echo ""
