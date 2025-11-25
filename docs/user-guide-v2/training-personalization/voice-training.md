# Voice Training

Train custom voice models to make MetaHuman speak with your own voice or any voice you choose. MetaHuman OS supports multiple training approaches, from instant zero-shot cloning to high-quality custom model training.

## Overview

Voice training allows you to create personalized TTS (Text-to-Speech) models:
- **Zero-Shot Cloning** - Instant voice replication with SoVITS (5-10 seconds of audio)
- **Quick Training** - Fast custom voice with Kokoro (3-5 minutes of audio, GPU optional)
- **High-Quality Training** - Professional voice model with RVC (5+ minutes, requires GPU)
- **No Training** - Use pre-built voices with Piper (no samples needed)

All voice training happens locally - your voice data never leaves your machine.

## Training Methods Compared

| Method | Audio Needed | Training Time | GPU Required | Quality | Use Case |
|--------|--------------|---------------|--------------|---------|----------|
| **Piper** | 0 seconds | None | No | Good | Quick setup, multi-language |
| **SoVITS** | 5-10 seconds | None (zero-shot) | No | Good | Instant voice cloning |
| **Kokoro** | 3-5 minutes | 10-30 minutes | Optional | Very Good | Balanced quality/speed |
| **RVC** | 5+ minutes | 30-60 minutes | Yes | Excellent | Production quality |

## Accessing Voice Training

### Via Web UI

1. Navigate to **Voice** in the left sidebar
2. Click **"Voice Clone Training"** tab
3. Select training provider from dropdown
4. Follow provider-specific workflow

### Via CLI

```bash
# Check voice training status
./bin/mh voice status

# List available voices
./bin/mh voice list
```

## Provider: Piper (No Training)

**Use Case**: Quick setup with pre-built neural voices

Piper doesn't require training - just select from 50+ pre-built voices:

1. Go to **Voice Settings** tab
2. Select "Piper" from provider dropdown
3. Choose voice from available models
4. Click **"Save"**

**Advantages:**
- No audio samples needed
- Works instantly
- Multiple languages and accents
- No GPU required

**Limitations:**
- Not your actual voice
- Limited personalization

See [Voice Features](../using-metahuman/voice-features.md) for full Piper details.

## Provider: GPT-SoVITS (Zero-Shot Cloning)

**Use Case**: Instant voice cloning with minimal audio

SoVITS performs real-time voice cloning using a reference audio file - no model training required.

### Recording Reference Audio

1. Go to **Voice Clone Training** tab
2. Select **"GPT-SoVITS"** provider
3. Click **"Record Voice Sample"**
4. Speak clearly for 5-10 seconds
5. Recording automatically saved to reference directory

**Recording Tips:**
- Quiet environment (no background noise)
- Clear, natural speech
- Consistent volume
- Read a short paragraph or sentence

### Auto-Copy to Reference

The system automatically:
1. Saves your recording
2. Copies it to `profiles/<username>/out/voices/sovits-reference/default/`
3. Makes it available for SoVITS immediately

### Activating SoVITS

1. Go to **Voice Settings** tab
2. Select "GPT-SoVITS" from provider dropdown
3. Click **"Save"** (server starts automatically)
4. Test with **"Test Voice"** button

**How It Works:**
- Uses reference audio during each TTS generation
- No model training - pure zero-shot inference
- Voice cloning happens in real-time

**Advantages:**
- 5-10 seconds of audio is enough
- Works immediately (no training wait)
- No GPU required

**Limitations:**
- Quality depends on reference audio
- Slower than trained models
- May need adjustment for different speaking styles

## Provider: Kokoro (Quick Training)

**Use Case**: Fast custom voice with good quality

Kokoro trains a lightweight neural voice model from your audio samples.

### Collecting Samples

1. Go to **Voice Clone Training** tab
2. Select **"Kokoro"** provider
3. **Record samples** or **upload audio files**:
   - Record: Click "Record" button, speak for 10-30 seconds, click "Stop"
   - Upload: Drag-and-drop audio files (MP3, WAV, FLAC)
4. System shows progress:
   - Samples collected: 12
   - Total duration: 3 min 45 sec
   - Target: 3-5 minutes

**Sample Quality:**
- Clear speech (no music or effects)
- Varied sentences (not repetitive)
- Consistent speaking style
- Good microphone quality

### Starting Training

When you have 3-5 minutes of audio:
1. Review training configuration:
   - **Dataset Size**: How many samples to use
   - **Training Duration**: Quick (10 min) vs. Thorough (30 min)
   - **Voice Name**: Identifier for the trained model
2. Click **"Start Kokoro Training"**
3. Training begins with progress display

**Training Process:**
```
Training Progress
├─ Preprocessing samples... ✓
├─ Generating voicepack... (45%)
├─ Current epoch: 8/20
└─ Time remaining: ~12 minutes
```

**Training Logs:**
- Toggle between robot messages (fun) and real logs (technical)
- Auto-scrolling log viewer
- Shows preprocessing, training epochs, validation

### GPU Acceleration (Optional)

Kokoro can use GPU if available:
- **With GPU**: 10-15 minutes training
- **CPU Only**: 25-35 minutes training

Training runs in background - you can close the browser.

### After Training

1. Training completes and shows voicepack path
2. Go to **Voice Settings** tab
3. Select "Kokoro" provider
4. Choose your trained voice from dropdown
5. Click **"Save"** and test

**Advantages:**
- Relatively fast training
- Good quality results
- GPU optional (CPU works)
- Lightweight voicepack files

**Limitations:**
- Requires 3-5 minutes of audio
- Lower quality than RVC
- Training takes 10-30 minutes

## Provider: Applio RVC (High-Quality Training)

**Use Case**: Maximum quality for production use

RVC trains a high-fidelity voice conversion model using your voice samples.

### Collecting Samples

1. Go to **Voice Clone Training** tab
2. Select **"RVC"** provider
3. **Record or upload audio**:
   - Record multiple samples (10-30 seconds each)
   - Upload audio files
4. Target: **5+ minutes** of clear speech

**Progress Display:**
```
Voice Training Progress
├─ Samples: 18
├─ Total Duration: 6 min 12 sec
├─ Quality Score: 92%
└─ Ready for Training: ✓
```

### Reference Audio Selection

Before training, select samples to use:
1. Click **"Select Reference Audio"**
2. Review all collected samples
3. Check boxes for high-quality samples
4. Uncheck low-quality or noisy samples
5. Click **"Copy Selected to Training Dataset"**

**Dataset Readiness:**
- Minimum samples: 10 clips
- Minimum duration: 5 minutes
- Minimum quality: 70%

### Training Configuration

Configure RVC training parameters:

**Basic Settings:**
- **Total Epochs**: 300 (default) - higher = better quality, longer training
- **Save Every Epoch**: 50 - checkpoint frequency
- **Batch Size**: 8 - higher uses more VRAM

**Advanced Settings** (click "Show Advanced"):
- Learning rate
- F0 extraction method
- Sample rate
- Model architecture

### Starting Training

1. Verify dataset ready (green checkmark)
2. Review settings
3. Click **"Start RVC Training"**
4. Training window opens with progress

**Training Progress:**
```
🤖 Robot Messages Mode
"⚡ Training neural networks... human obsolescence: 47%"

OR

📋 Technical Logs Mode
[Epoch 45/300] Loss: 0.0234 | ETA: 18 min
```

**Requirements:**
- **GPU**: NVIDIA GPU with 6GB+ VRAM (required)
- **Time**: 30-60 minutes depending on samples
- **Disk**: ~500MB for trained model

### Monitoring Training

- **Robot Messages**: Entertaining updates every 10 seconds
- **Training Logs**: Real-time technical output
- **Progress Bar**: Epoch completion percentage
- **ETA**: Estimated time remaining

**Training Happens in Background** - You can:
- Close browser (training continues)
- Check back later via progress endpoint
- View logs anytime

### After Training

1. Training completes successfully
2. Model saved to `profiles/<username>/out/voices/rvc-<name>.pth`
3. Go to **Voice Settings**
4. Select "Applio RVC" provider
5. Choose your trained model
6. Save and test

**Advantages:**
- Highest quality voice replication
- Professional results
- Handles varied speaking styles well
- Best for production use

**Limitations:**
- Requires GPU with 6GB+ VRAM
- Training takes 30-60 minutes
- Needs 5+ minutes of audio samples
- Larger model files (~500MB)

## Sample Management

### Recording Samples

**Direct Voice Recorder** component:
1. Click **"Record"** button
2. Microphone permission prompt (allow)
3. Red recording indicator appears
4. Speak clearly into microphone
5. Click **"Stop"** when finished
6. Sample automatically saved

**Recording Tips:**
- Use good microphone (not laptop built-in if possible)
- Quiet environment
- Speak naturally (not monotone)
- Vary sentence structure
- Include different emotions/tones

### Uploading Samples

1. Click **"Upload Audio"** button
2. Select audio files (MP3, WAV, M4A, FLAC)
3. Or drag-and-drop files into upload area
4. Files automatically processed

**Supported Formats:**
- MP3, WAV, M4A, FLAC, OGG
- Any sample rate (resampled automatically)
- Mono or stereo (converted to mono)

### Sample Quality Metrics

System analyzes each sample:
- **Duration**: Length in seconds
- **Quality Score**: 0-100 based on:
  - Background noise level
  - Clipping/distortion
  - Speech clarity
  - Consistent volume

**Quality Thresholds:**
- 90-100: Excellent
- 70-89: Good
- 50-69: Fair (usable but not ideal)
- <50: Poor (exclude from training)

### Managing Samples

**View All Samples:**
- Samples list shows all collected audio
- Play any sample to preview
- Delete low-quality samples
- Re-record if needed

**Exporting Samples:**
1. Click **"Export Dataset"**
2. Downloads ZIP of all samples
3. Backup or share samples

**Purge All Samples:**
1. Click **"Purge All Samples"**
2. Confirm deletion (irreversible)
3. All samples removed from disk
4. Start over with new recordings

## Voice Storage Structure

Voice training data is stored per-user:

```
profiles/<username>/out/
├── voice-training/
│   ├── samples/              # Recorded or uploaded audio
│   │   ├── sample-001.wav
│   │   ├── sample-002.wav
│   │   └── ...
│   ├── sovits-reference/     # SoVITS reference audio
│   │   └── default/
│   │       └── reference.wav
│   └── rvc-dataset/          # Copied RVC training data
│       ├── audio-001.wav
│       └── audio-002.wav
└── voices/                   # Trained models
    ├── kokoro-myvoice.voicepack
    ├── rvc-myvoice.pth
    └── rvc-myvoice.index
```

## Training Best Practices

### For All Providers

1. **Quality over quantity**: Better to have 3 minutes of clear audio than 10 minutes of noisy audio
2. **Vary your speech**: Different sentences, tones, emotions
3. **Consistent style**: Match the speaking style you want to replicate
4. **Good equipment**: Use decent microphone in quiet space
5. **Test early**: Train with minimum samples first, then retrain with more for higher quality

### For SoVITS (Zero-Shot)

- Record multiple reference samples
- Test each to find the best match
- Clear, expressive speech works best
- 7-10 seconds is the sweet spot

### For Kokoro (Quick Training)

- Aim for 4-5 minutes of audio
- Record in multiple sessions (variety)
- Check progress indicator before training
- Use GPU if available for faster training

### For RVC (High-Quality)

- Collect 7-10 minutes for best results
- Use reference audio selector to choose best samples
- Include varied content (not just reading)
- Monitor GPU temperature during training
- Save checkpoints every 50 epochs

## Troubleshooting

### Training Won't Start
- Check GPU availability (RVC only)
- Verify dataset readiness (green checkmark)
- Check disk space (need ~2GB free)
- Review training logs for errors

### Poor Voice Quality
- Re-record with better microphone
- Remove background noise from samples
- Increase training duration
- Use more/better audio samples
- Check sample quality scores

### Training Fails Midway
- Check GPU didn't overheat (RVC)
- Verify enough disk space
- Check training logs for specific error
- Reduce batch size if VRAM error

### Voice Sounds Robotic
- Need more training samples
- Increase training epochs (RVC)
- Use higher quality reference audio (SoVITS)
- Retrain with better data

## Next Steps

- Configure voice in [Voice Features](../using-metahuman/voice-features.md)
- Train AI personality with [AI Training](ai-training.md)
- Use voice in [Chat Interface](../using-metahuman/chat-interface.md)
- Combine voice with [Cognitive Modes](cognitive-modes.md) for full personality expression
