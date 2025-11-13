# 🚀 RVC Voice Cloning - Quick Start Guide

Get your custom voice cloned in MetaHuman OS using RVC (Retrieval-based Voice Conversion).

---

## ⚡ 5-Minute Setup

### Step 1: Install RVC

**Option A: Web UI (Recommended)**
```
1. Open MetaHuman web interface
2. Click "System" tab (⚙️ icon)
3. Scroll to "RVC Voice Cloning" card
4. Click "Install RVC" button
5. Wait 5-10 minutes
```

**Option B: Command Line**
```bash
cd /home/greggles/metahuman
./bin/mh rvc install
```

### Step 2: Verify Installation

```bash
./bin/mh rvc status
```

You should see:
```
✓ Installed
✓ Virtual environment configured
✓ Ready
```

### Step 3: Collect Voice Samples

1. Go to **Voice → Training** tab
2. Enable voice training toggle
3. Have conversations with MetaHuman
4. Collect 10-15 minutes of clean audio

### Step 4: Train Your Voice Model

**Currently requires external tools:**

1. Export samples from training tab
2. Use [Applio RVC GUI](https://github.com/IAHispano/Applio) to train
3. Save trained model as: `profiles/{your-username}/out/voices/rvc/default/models/default.pth`

### Step 5: Use Your Voice

1. Edit `etc/voice.json`:
   ```json
   {
     "tts": {
       "provider": "rvc"
     }
   }
   ```

2. Restart MetaHuman or reload config

3. Test your voice:
   ```bash
   ./bin/mh chat
   ```

---

## 🎛️ Advanced Configuration

### Adjust Pitch

Make your voice higher or lower:

```json
{
  "tts": {
    "rvc": {
      "pitchShift": 2  // +2 semitones (higher)
    }
  }
}
```

Range: `-12` (very low) to `+12` (very high)

### Multiple Voice Profiles

Create different voices for different moods:

```bash
# Directory structure
profiles/{user}/out/voices/rvc/
├── default/          # Normal voice
│   └── models/
│       └── default.pth
├── happy/            # Happy voice
│   └── models/
│       └── happy.pth
└── serious/          # Serious voice
    └── models/
        └── serious.pth
```

Switch between them in `voice.json`:
```json
{
  "tts": {
    "rvc": {
      "speakerId": "happy"  // or "serious"
    }
  }
}
```

### Enable Auto-Fallback

If RVC model unavailable, use Piper:

```json
{
  "tts": {
    "rvc": {
      "autoFallbackToPiper": true
    }
  }
}
```

---

## 🐛 Troubleshooting

### "RVC not installed" Error

**Solution:**
```bash
./bin/mh rvc install
```

### "No model found" Error

**Cause**: No trained RVC model exists

**Solution**: Train a model first or enable fallback:
```json
{
  "tts": {
    "rvc": {
      "autoFallbackToPiper": true
    }
  }
}
```

### Python Version Error

**Cause**: Python 3.9+ required

**Solution**: Install Python 3.9 or higher:
```bash
sudo apt install python3.11  # Ubuntu/Debian
brew install python@3.11     # macOS
```

### GPU Not Detected

**Not a problem!** RVC works on CPU (just slower).

**Optional**: Install CUDA for GPU acceleration:
```bash
# Check if GPU available
nvidia-smi

# If available, RVC will auto-detect and use it
```

---

## 📊 Comparison: Piper vs GPT-SoVITS vs RVC

| Feature | Piper | GPT-SoVITS | RVC |
|---------|-------|-----------|-----|
| **Quality** | Good | Excellent | Outstanding |
| **Speed** | Fast (~1s) | Medium (~3s) | Medium (~2-4s) |
| **Training Required** | ❌ No | ❌ No | ✅ Yes |
| **Training Time** | - | - | 1-2 hours |
| **Audio Needed** | - | 5-10 seconds | 10-15 minutes |
| **Pitch Control** | ✅ Yes | ❌ No | ✅ Yes (-12 to +12) |
| **GPU Required** | ❌ No | ⚠️ Recommended | ⚠️ Recommended |
| **Best For** | Speed | Quick cloning | Custom voices |

**Recommendation**:
- **Piper** = Default, fast
- **GPT-SoVITS** = Quick voice cloning without training
- **RVC** = Best quality, worth the training time

---

## 📚 Related Commands

```bash
# Installation
./bin/mh rvc install           # Install RVC
./bin/mh rvc status            # Check status
./bin/mh rvc uninstall         # Remove RVC

# Training (placeholder - requires external tools)
./bin/mh rvc train --name greg # Train model

# Testing
./bin/mh rvc test --model greg --input test.wav

# Voice management
./bin/mh voice                 # Voice settings helper
```

---

## 🎓 Tips for Best Results

### Recording Quality Matters

✅ **Do:**
- Use a good microphone
- Record in a quiet room
- Speak naturally and clearly
- Maintain consistent volume
- Include varied sentences

❌ **Don't:**
- Record with background noise
- Mumble or speak too fast
- Change microphone mid-recording
- Include music or other voices

### Training Data Volume

- **Minimum**: 10 minutes (basic quality)
- **Recommended**: 15-20 minutes (good quality)
- **Optimal**: 30+ minutes (best quality)

More data = better voice cloning!

### Pitch Shift Guidelines

- **Male → Female**: `+8` to `+12` semitones
- **Female → Male**: `-8` to `-12` semitones
- **Same gender**: `-3` to `+3` semitones
- **No change**: `0` semitones

---

## 🔗 Resources

- **Full Documentation**: [docs/RVC_IMPLEMENTATION.md](docs/RVC_IMPLEMENTATION.md)
- **Architecture Guide**: [plans/voice_system_architecture.md](plans/voice_system_architecture.md)
- **Applio RVC**: https://github.com/IAHispano/Applio
- **MetaHuman Issues**: https://github.com/anthropics/metahuman/issues

---

**Ready to get started?** Run `./bin/mh rvc install` now! 🎉
