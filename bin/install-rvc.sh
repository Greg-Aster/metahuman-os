#!/usr/bin/env bash
# RVC (Applio) Installation Script for MetaHuman OS
set -e

METAHUMAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RVC_DIR="$METAHUMAN_ROOT/external/applio-rvc"
RVC_REPO="https://github.com/IAHispano/Applio.git"

echo "========================================="
echo "RVC (Applio) Installation for MetaHuman OS"
echo "========================================="
echo ""

# Check Python version
echo "[1/7] Checking Python version..."
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

# Check CUDA availability
echo ""
echo "[2/7] Checking CUDA availability..."
if command -v nvidia-smi &> /dev/null; then
    CUDA_VERSION=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)
    if [ -n "$CUDA_VERSION" ]; then
        echo "✓ NVIDIA GPU detected (Driver: $CUDA_VERSION)"
        echo "  RVC will use GPU acceleration"
    else
        echo "⚠ NVIDIA GPU not detected, will use CPU (slower)"
    fi
else
    echo "⚠ nvidia-smi not found, will use CPU (slower)"
fi

# Create external directory
echo ""
echo "[3/7] Setting up directories..."
mkdir -p "$METAHUMAN_ROOT/external"

# Clone Applio RVC repository
echo ""
echo "[4/7] Cloning Applio RVC repository..."
if [ -d "$RVC_DIR" ]; then
    echo "⚠ RVC directory already exists, skipping clone"
    echo "  To reinstall, remove: $RVC_DIR"
else
    git clone --depth 1 "$RVC_REPO" "$RVC_DIR"
    echo "✓ Repository cloned to $RVC_DIR"
fi

# Create virtual environment
echo ""
echo "[5/7] Creating Python virtual environment..."
cd "$RVC_DIR"
if [ ! -d "venv" ]; then
    "$PYTHON_CMD" -m venv venv
    echo "✓ Virtual environment created"
else
    echo "⚠ Virtual environment already exists"
fi

# Install Python dependencies
echo ""
echo "[6/7] Installing Python dependencies..."
./venv/bin/pip install --upgrade pip > /dev/null 2>&1

# Install core RVC dependencies with compatible versions
echo "  Installing core dependencies with compatible versions..."

# Determine PyTorch installation based on CUDA
if command -v nvidia-smi &> /dev/null; then
    echo "  Installing PyTorch with CUDA support..."
    ./venv/bin/pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
else
    echo "  Installing PyTorch (CPU-only)..."
    ./venv/bin/pip install torch torchvision torchaudio
fi

# Install audio processing libraries
echo "  Installing audio processing libraries..."
./venv/bin/pip install librosa soundfile scipy numpy soxr

# Install faiss-cpu (latest version compatible with current Python)
echo "  Installing faiss-cpu..."
./venv/bin/pip install faiss-cpu

# Install additional RVC dependencies
echo "  Installing RVC-specific dependencies..."
./venv/bin/pip install praat-parselmouth wget transformers

# Install preprocessing and training dependencies
echo "  Installing preprocessing and training dependencies..."
./venv/bin/pip install tensorboard matplotlib noisereduce torchcrepe torchfcpe

# Install inference dependencies (pedalboard for audio processing)
echo "  Installing inference dependencies..."
./venv/bin/pip install pedalboard

# Optional: Install additional helpful packages
./venv/bin/pip install tqdm

echo "✓ Dependencies installed"

# Download pretrained models (RMVPE, embedder models, etc.)
echo ""
echo "[7/7] Downloading pretrained models..."
./venv/bin/python -c "from rvc.lib.tools.prerequisites_download import prequisites_download_pipeline; prequisites_download_pipeline(True, True, True)"
echo "✓ Pretrained models downloaded"

if [ ! -f "$RVC_DIR/core.py" ]; then
    echo "✗ Applio inference entrypoint is missing: $RVC_DIR/core.py"
    exit 1
fi
echo "✓ Applio inference entrypoint verified"

echo ""
echo "========================================="
echo "✓ Installation Complete!"
echo "========================================="
echo ""
echo "RVC (Applio) is now installed and ready to use."
echo ""
echo "Installation directory: $RVC_DIR"
echo ""
echo "Note: You will need to train a voice model before using RVC."
echo "      Use the Voice Training tab to collect samples and train."
echo ""
