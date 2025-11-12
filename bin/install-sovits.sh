#!/usr/bin/env bash
# GPT-SoVITS Installation Script for MetaHuman OS
set -e

METAHUMAN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOVITS_DIR="$METAHUMAN_ROOT/external/gpt-sovits"
SOVITS_REPO="https://github.com/RVC-Boss/GPT-SoVITS.git"

echo "========================================="
echo "GPT-SoVITS Installation for MetaHuman OS"
echo "========================================="
echo ""

# Check Python version
echo "[1/4] Checking Python version..."
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
echo "[2/4] Checking CUDA availability..."
if command -v nvidia-smi &> /dev/null; then
    CUDA_VERSION=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)
    if [ -n "$CUDA_VERSION" ]; then
        echo "✓ NVIDIA GPU detected (Driver: $CUDA_VERSION)"
    else
        echo "⚠ NVIDIA GPU not detected, will use CPU (slower)"
    fi
else
    echo "⚠ nvidia-smi not found, will use CPU (slower)"
fi

# Create external directory
echo ""
echo "[3/4] Setting up directories..."
mkdir -p "$METAHUMAN_ROOT/external"
mkdir -p "$METAHUMAN_ROOT/out/voices/sovits"

# Clone GPT-SoVITS repository
echo ""
echo "[4/7] Cloning GPT-SoVITS repository..."
if [ -d "$SOVITS_DIR" ]; then
    echo "⚠ GPT-SoVITS directory already exists, skipping clone"
    echo "  To reinstall, remove: $SOVITS_DIR"
else
    git clone --depth 1 "$SOVITS_REPO" "$SOVITS_DIR"
    echo "✓ Repository cloned to $SOVITS_DIR"
fi

# Create virtual environment
echo ""
echo "[5/7] Creating Python virtual environment..."
cd "$SOVITS_DIR"
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
./venv/bin/pip install -r requirements.txt
echo "✓ Dependencies installed"

# Download pretrained models
echo ""
echo "[7/7] Downloading pretrained models..."
echo "  This may take several minutes (~2GB of data)"
cd "$METAHUMAN_ROOT"
pnpm --filter metahuman-cli mh sovits download-models
echo "✓ Models downloaded"

echo ""
echo "========================================="
echo "✓ Installation Complete!"
echo "========================================="
echo ""
echo "GPT-SoVITS is fully installed and ready to use."
echo ""
echo "The server will auto-start when you run 'pnpm dev'."
echo "Or manually start it with: pnpm --filter metahuman-cli mh sovits start"
echo ""
echo "Installation directory: $SOVITS_DIR"
echo ""
