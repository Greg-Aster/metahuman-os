#!/bin/bash
# Batch normalize Kokoro training samples to -16 LUFS
# This ensures consistent volume and optimal training quality

set -e

DATASET_DIR="$1"
BACKUP_DIR="${DATASET_DIR}_backup_$(date +%Y%m%d_%H%M%S)"

if [ -z "$DATASET_DIR" ]; then
  echo "Usage: $0 <dataset-directory>"
  echo "Example: $0 /home/greggles/metahuman/profiles/greggles/out/voices/kokoro-datasets/default"
  exit 1
fi

if [ ! -d "$DATASET_DIR" ]; then
  echo "Error: Directory not found: $DATASET_DIR"
  exit 1
fi

# Count WAV files
WAV_COUNT=$(find "$DATASET_DIR" -maxdepth 1 -name "*.wav" | wc -l)

if [ "$WAV_COUNT" -eq 0 ]; then
  echo "No WAV files found in $DATASET_DIR"
  exit 1
fi

echo "========================================"
echo "Kokoro Sample Normalization Tool"
echo "========================================"
echo "Dataset directory: $DATASET_DIR"
echo "WAV files found: $WAV_COUNT"
echo ""
echo "This will:"
echo "  1. Backup originals to: $BACKUP_DIR"
echo "  2. Normalize all WAV files to -16 LUFS (broadcast standard)"
echo "  3. Preserve original transcripts (.txt files)"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Create backup
echo ""
echo "Creating backup..."
mkdir -p "$BACKUP_DIR"
cp "$DATASET_DIR"/*.wav "$BACKUP_DIR/" 2>/dev/null || true
cp "$DATASET_DIR"/*.txt "$BACKUP_DIR/" 2>/dev/null || true
echo "✓ Backup created: $BACKUP_DIR"

# Analyze before normalization
echo ""
echo "Analyzing samples before normalization..."
/home/greggles/metahuman/external/kokoro/venv/bin/python3 -c "
import soundfile as sf
import numpy as np
from pathlib import Path

dataset_dir = Path('$DATASET_DIR')
wav_files = sorted(dataset_dir.glob('*.wav'))[:10]

print(f'\nSample analysis (first 10 files):')
print(f'{'File':<30} {'Peak':<8} {'RMS (dB)':<10}')
print('-' * 50)

for wav in wav_files:
    data, sr = sf.read(wav)
    if data.ndim > 1:
        data = data.mean(axis=1)

    peak = np.max(np.abs(data))
    rms = np.sqrt(np.mean(data**2))
    rms_db = 20 * np.log10(rms + 1e-10)

    print(f'{wav.name:<30} {peak:<8.4f} {rms_db:<10.2f}')
"

# Normalize all WAV files
echo ""
echo "Normalizing samples..."
PROCESSED=0
FAILED=0

for WAV_FILE in "$DATASET_DIR"/*.wav; do
  BASENAME=$(basename "$WAV_FILE")
  TEMP_FILE="${WAV_FILE}.tmp.wav"

  # Apply loudnorm filter (same as voice-training.ts)
  if ffmpeg -y -hide_banner -loglevel error \
    -i "$WAV_FILE" \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
    "$TEMP_FILE" 2>&1; then

    mv "$TEMP_FILE" "$WAV_FILE"
    ((PROCESSED++))

    # Progress indicator
    if [ $((PROCESSED % 10)) -eq 0 ]; then
      echo "  Processed $PROCESSED/$WAV_COUNT samples..."
    fi
  else
    echo "  ⚠️  Failed to normalize: $BASENAME"
    ((FAILED++))
    rm -f "$TEMP_FILE"
  fi
done

echo "✓ Normalization complete: $PROCESSED succeeded, $FAILED failed"

# Analyze after normalization
echo ""
echo "Analyzing samples after normalization..."
/home/greggles/metahuman/external/kokoro/venv/bin/python3 -c "
import soundfile as sf
import numpy as np
from pathlib import Path

dataset_dir = Path('$DATASET_DIR')
wav_files = sorted(dataset_dir.glob('*.wav'))[:10]

print(f'\nSample analysis (first 10 files):')
print(f'{'File':<30} {'Peak':<8} {'RMS (dB)':<10}')
print('-' * 50)

for wav in wav_files:
    data, sr = sf.read(wav)
    if data.ndim > 1:
        data = data.mean(axis=1)

    peak = np.max(np.abs(data))
    rms = np.sqrt(np.mean(data**2))
    rms_db = 20 * np.log10(rms + 1e-10)

    print(f'{wav.name:<30} {peak:<8.4f} {rms_db:<10.2f}')

print('\n✓ Samples now have consistent loudness levels')
"

echo ""
echo "========================================"
echo "Normalization Complete!"
echo "========================================"
echo "Processed: $PROCESSED samples"
echo "Backup: $BACKUP_DIR"
echo ""
echo "You can now train with optimally preprocessed data."
echo "To restore originals if needed: cp $BACKUP_DIR/*.wav $DATASET_DIR/"
