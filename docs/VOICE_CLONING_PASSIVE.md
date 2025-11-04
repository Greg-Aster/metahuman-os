# Passive Voice Cloning - Your Voice, Your MetaHuman

## Overview

MetaHuman OS now **automatically collects** your voice during conversations to train a custom voice model that sounds exactly like you. This happens passively in the background - no extra effort required!

## How It Works

### Automatic Collection

Every time you have a voice conversation:

1. **You speak** → Audio captured
2. **Transcribed** → Text generated
3. **Saved automatically** → Both audio + transcript stored
4. **Quality filtered** → Only clear, useful samples kept
5. **Progress tracked** → System knows when ready to train

**Location:** `out/voice-training/recordings/`

**Format:**
```
voice-{timestamp}-{id}.wav        # Your voice audio
voice-{timestamp}-{id}.txt        # What you said
voice-{timestamp}-{id}.meta.json  # Metadata (duration, quality)
```

### Training Requirements

**Target:** 3 hours of clear speech
**Minimum:** 2.4 hours (80% of target) to start training
**Quality:** Only samples > 60% quality score saved

**Quality Score Based On:**
- Audio clarity (volume, no noise)
- Transcription success
- Duration (2-30 seconds ideal)
- No empty/garbled speech

### Progress Tracking

Check your progress anytime:
```bash
./bin/mh voice status
```

**Output:**
```
Voice Training Progress
======================
Samples collected: 243
Total duration: 1h 23m 45s / 3h 0m 0s
Progress: 46.5%
Estimated quality: 82%
Status: Collecting... (need 1h 36m more)
```

## Configuration

### Settings (`etc/voice.json`)

```json
{
  "training": {
    "enabled": true,          // Turn passive collection on/off
    "minDuration": 2,         // Min seconds per sample
    "maxDuration": 30,        // Max seconds per sample
    "minQuality": 0.6,        // Min quality threshold (0-1)
    "targetHours": 3          // Total hours needed
  }
}
```

**Adjust if needed:**
- `targetHours: 5` - More data = better quality (but longer wait)
- `targetHours: 2` - Less data = faster training (but lower quality)
- `minQuality: 0.7` - Stricter quality = better results
- `minQuality: 0.5` - Looser quality = collect faster

## CLI Commands

### Check Progress
```bash
./bin/mh voice status
```

### List All Samples
```bash
./bin/mh voice list
```

**Output:**
```
Voice Training Samples (243 total)
==================================
1. voice-1234567890-abc123
   Duration: 5.2s | Quality: 85% | "What tasks do I have today?"

2. voice-1234567891-def456
   Duration: 3.8s | Quality: 92% | "Tell me more about that project"

... (showing 10 most recent)
```

### Delete Bad Sample
```bash
./bin/mh voice delete voice-1234567890-abc123
```

### Export Training Dataset
```bash
./bin/mh voice export
```

**Creates:** `out/voice-training/dataset/` with Piper-compatible format

## Training Your Voice

### When Ready (≥80% progress):

**Option A: Local Training (Requires GPU)**
```bash
./bin/mh voice train
```
- Duration: 2-3 days on NVIDIA GPU
- Quality: Excellent
- Free

**Option B: Cloud Training (Recommended)**
```bash
./bin/mh voice train --cloud
```
- Uses Google Colab (free tier)
- Duration: 6-12 hours
- Quality: Excellent
- Automated

### Training Process

1. **Export dataset** - Prepare audio + transcripts
2. **Generate phonemes** - Convert text to phonemes (espeak)
3. **Train model** - Piper training (2-3 days GPU)
4. **Export voice** - Creates `greg-voice.onnx`
5. **Install** - Copies to `out/voices/`
6. **Activate** - Updates `etc/voice.json`

### After Training

**Switch to your voice:**
```bash
./bin/mh voice activate greg
```

**Switch back to Ryan:**
```bash
./bin/mh voice activate ryan
```

**List available voices:**
```bash
./bin/mh voice list-available
```

## Quality Expectations

### With 3 Hours of Data

✅ **Excellent** quality
✅ Natural intonation
✅ Your speech patterns
✅ Emotional expression
✅ Fast inference (same as Piper)

### With 2 Hours of Data

✅ **Good** quality
✅ Recognizable as your voice
⚠️ Some robotic moments
✅ Still very usable

### With 5+ Hours of Data

✅ **Perfect** quality
✅ Indistinguishable from real voice
✅ All nuances captured
✅ Professional TTS quality

## Tips for Best Results

### Do's ✅

- **Speak naturally** - Don't read robotically
- **Vary your speech** - Questions, statements, emotions
- **Clear environment** - Quiet room, good mic
- **Consistent volume** - Not too loud, not too quiet
- **Full sentences** - Complete thoughts
- **Different topics** - Diverse vocabulary

### Don'ts ❌

- **Don't whisper** - Speak at normal volume
- **Avoid background noise** - TV, music, traffic
- **Don't rush** - Natural pace
- **Skip filler words** - "um", "uh", excessive "like"
- **No interruptions** - Wait for AI to finish

## Privacy & Data

### Your Data, Your Machine

✅ **100% local** - All audio stays on your computer
✅ **No cloud upload** - Unless you choose cloud training
✅ **You control it** - Delete samples anytime
✅ **No telemetry** - No data sent anywhere
✅ **Audited** - Full audit trail in logs

### Storage

**Location:** `out/voice-training/recordings/`
**Size:** ~1-2MB per minute of audio
**3 hours:** ~200-400MB total

## Troubleshooting

### Not collecting samples

**Check:** `etc/voice.json` → `training.enabled: true`
**Check:** Voice conversations working? Must speak for 2-30s
**Check:** `out/voice-training/recordings/` directory exists?

### Quality too low

**Solution:** Speak louder, reduce background noise
**Adjust:** `minQuality: 0.5` in config (lower threshold)

### Too slow collecting

**Solution:** Have more/longer conversations
**Or:** Reduce `targetHours: 2` (less total needed)

### Samples but no progress

**Check:** `./bin/mh voice status` - are samples counting?
**Check:** Sample duration - must be 2-30 seconds
**Check:** Transcripts not empty - must have real words

## Advanced

### Manual Sample Recording

Don't want to wait for passive collection?

```bash
# Record 30 minutes of reading prompts
./bin/mh voice record-prompts
```

**Provides prompts to read:**
```
Read the following (1/100):
"The quick brown fox jumps over the lazy dog"

[Recording... speak now]
[✓ Saved]

Read the following (2/100):
"MetaHuman OS is an autonomous digital personality"
...
```

### Custom Training Parameters

Edit training config before starting:
```bash
nano out/voice-training/training_config.json
```

**Options:**
- `epochs`: Training iterations (default: 10000)
- `batch_size`: Samples per batch (default: 32)
- `learning_rate`: Training speed (default: 1e-4)

## Dependencies (Only When Training)

**Will be installed automatically when you run `./bin/mh voice train`:**

```bash
# Small dependencies (~50MB total)
pip install espeak-ng       # Phoneme generation
pip install soundfile       # Audio processing
pip install librosa         # Audio analysis

# Piper training tools (~100MB)
git clone https://github.com/rhasspy/piper
```

**Total:** ~150MB one-time download

## Comparison: Your Voice vs Ryan

| Feature | Ryan (Current) | Your Voice (After Training) |
|---------|----------------|---------------------------|
| Quality | Excellent | Excellent |
| Speed | 5.4x real-time | 5.4x real-time |
| Personality | Generic | Authentically YOU |
| Emotion | Limited | Natural (learned from your data) |
| Recognition | Sounds like TTS | Sounds like you |
| Setup time | 0 (pre-trained) | 3 hours passive + 2 days training |

## Summary

🎉 **Just have conversations!**

MetaHuman OS automatically:
- ✅ Collects your voice
- ✅ Filters quality samples
- ✅ Tracks progress
- ✅ Prepares training data
- ✅ (Eventually) Trains your voice
- ✅ Lets you switch voices anytime

**No additional programs needed until training time.**
**Highest quality: Custom Piper voice trained on your data.**
**Zero effort: Fully passive collection during normal use.**

Start having voice conversations now, and in a few weeks you'll have enough data to train a voice model that sounds exactly like you! 🗣️
