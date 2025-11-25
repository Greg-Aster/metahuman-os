# Voice Features

MetaHuman OS includes a comprehensive, local-first voice system that enables your digital personality to speak with natural-sounding or even your own cloned voice - all running entirely on your infrastructure.

## Overview

The voice system provides:
- **Text-to-Speech (TTS)**: MetaHuman speaks responses aloud
- **Speech-to-Text (STT)**: Voice input for conversations
- **Voice Cloning**: Replicate your voice from short samples
- **Multi-Provider Support**: Choose between fast synthetic or high-quality cloned voices
- **Privacy-First**: All voice processing happens locally
- **Real-Time Interaction**: Voice mode in chat interface

## TTS Providers

MetaHuman OS supports three TTS providers, each optimized for different use cases:

### 1. Kokoro TTS (Fast Neural Voices)

**Best For**: Quick setup with natural-sounding voices, no training required

**Features:**
- Generates audio in real-time (< 1 second)
- Natural-sounding neural voices
- Multiple voices and accents
- Minimal CPU/RAM, no GPU required
- Default provider, works out of the box

**Starting Kokoro:**
```bash
# Start the Kokoro server
./bin/mh kokoro serve start

# Stop the server
./bin/mh kokoro serve stop

# Check status
./bin/mh kokoro serve status
```

**Configuration** (`profiles/<user>/etc/voice.json`):
```json
{
  "tts": {
    "provider": "kokoro",
    "kokoro": {
      "voice": "af_sky",
      "speed": 1.0
    }
  }
}
```

### 2. GPT-SoVITS (Real-Time Voice Cloning)

**Best For**: Instant voice cloning with minimal audio samples

**Features:**
- **Zero-shot cloning**: Replicate your voice from 5-10 seconds of audio
- No training required - uses reference audio during inference
- High-quality voice replication
- Natural prosody and intonation
- Automated workflow in web UI

**Quick Start:**

1. **Record Reference Audio**:
   - Go to **Voice** tab → **Voice Clone Training**
   - Select "GPT-SoVITS" provider
   - Click **Record** and speak clearly for 5-10 seconds
   - Recording automatically saved to reference directory

2. **Activate SoVITS**:
   - Go to **Voice** tab → **Voice Settings**
   - Select "GPT-SoVITS" from provider dropdown
   - Click **Save** (server starts automatically)

3. **Test Your Voice**:
   - Click **Test Voice** button
   - Voice cloning happens in real-time

**Configuration:**
```json
{
  "tts": {
    "provider": "gpt-sovits",
    "sovits": {
      "serverUrl": "http://127.0.0.1:9880",
      "speakerId": "default",
      "speed": 1.0,
      "autoFallbackToPiper": true
    }
  }
}
```

### 3. Applio RVC (High-Quality Voice Conversion)

**Best For**: Maximum quality with trained voice models

**Features:**
- Train a dedicated voice model from your audio samples
- Highest quality voice replication
- Requires GPU for training (15-30 minutes)
- Uses trained model for all future generations

**Training Workflow:**

1. **Collect Voice Samples**:
   - Record 3-5 minutes of clear speech
   - Upload via Voice Clone Training tab
   - System stores samples in training directory

2. **Train Model**:
   - Click **Start Training** button
   - Requires GPU with at least 6GB VRAM
   - Training takes 15-30 minutes
   - Progress shown in UI

3. **Activate Model**:
   - Select "Applio RVC" in Voice Settings
   - Choose your trained model from dropdown
   - Save and test

## Speech-to-Text (STT) - Whisper

MetaHuman uses OpenAI Whisper for local speech recognition:

**Features:**
- Accurate transcription
- Multi-language support
- Runs entirely locally
- Real-time voice input

**Starting Whisper:**
```bash
# Start the Whisper server
./bin/mh whisper serve start

# Stop the server
./bin/mh whisper serve stop

# Check status
./bin/mh whisper serve status
```

**Configuration** (`profiles/<user>/etc/voice.json`):
```json
{
  "stt": {
    "provider": "whisper",
    "whisper": {
      "model": "base",
      "serverUrl": "http://127.0.0.1:9000"
    }
  }
}
```

**Model Sizes:**
- **tiny**: Fastest, lowest accuracy
- **base**: Good balance (default)
- **small**: Better accuracy
- **medium**: High accuracy, slower
- **large**: Best accuracy, requires GPU

## Voice Chat Interface

### Voice Mode Button

In the chat interface:
1. Click the **microphone icon** (🎤) next to the input box
2. Speak your message
3. MetaHuman transcribes and responds
4. Response is automatically read aloud

### Per-Message TTS Controls

**In Chat Bubbles:**
- Small microphone icon (🎤) at bottom-right of each message
- Click to replay any message aloud
- Works for both user and assistant messages
- Useful for re-listening to responses

**Stop Button:**
- **Stop button** (🛑) appears when audio is playing
- Click to immediately interrupt playback
- Cancels active audio and pending TTS
- Available on desktop and mobile

### Inner Dialogue TTS

Enable automatic reading of reflections and dreams:
1. Go to **Settings**
2. Toggle **"Enable TTS for inner dialogue"**
3. Reflections and dreams will be read aloud as they occur
4. Creates an auditory consciousness stream

## Voice Workspace (Web UI)

The Voice tab provides centralized voice management:

### Upload & Transcribe
- Drag-and-drop audio files for transcription
- Whisper processes and creates memories
- View transcripts in Memory Browser

### Voice Clone Training
- Record or upload voice samples
- Stores per-user samples in `profiles/<username>/out/voice-training`
- Progress indicators for active profile
- Provider selection (SoVITS, RVC)

### Voice Settings
- Choose TTS provider (Kokoro, SoVITS, RVC)
- Select voice/model from available options
- Adjust speaking rate and quality
- Test voice with sample text
- Preferences stored in `profiles/<username>/etc/voice.json`

### Special TTS Effects
- **Mutant Super Intelligence** profile uses dual-voice effect
- Pitch-shifted audio mixing for unique sound
- Automatically applied when profile is active

## Audio File Organization

Voice data is stored per-user:

```
profiles/<username>/
├── out/
│   ├── voice-training/          # Training samples
│   │   ├── sovits-reference/    # SoVITS reference audio
│   │   └── rvc-samples/         # RVC training data
│   ├── voices/                  # Installed voice models
│   │   ├── kokoro-*.onnx        # Kokoro voices
│   │   ├── sovits-*.pth         # SoVITS models
│   │   └── rvc-*.pth            # RVC trained models
│   └── audio-cache/             # TTS audio cache
└── etc/
    └── voice.json               # Voice preferences
```

## Voice Settings Configuration

Full configuration example:

```json
{
  "tts": {
    "provider": "kokoro",
    "kokoro": {
      "voice": "af_sky",
      "speed": 1.0
    },
    "sovits": {
      "serverUrl": "http://127.0.0.1:9880",
      "speakerId": "default",
      "speed": 1.0,
      "autoFallbackToPiper": true
    },
    "rvc": {
      "modelPath": "profiles/greggles/out/voices/rvc-greggles.pth",
      "pitch": 0,
      "indexRate": 0.75
    }
  },
  "stt": {
    "provider": "whisper",
    "whisper": {
      "model": "base",
      "serverUrl": "http://127.0.0.1:9000",
      "language": "en"
    }
  },
  "audioCache": {
    "enabled": true,
    "maxSizeMB": 500
  }
}
```

## Multi-User Voice Isolation

Each user has isolated voice settings and training data:
- **Voice samples**: Stored per-profile
- **Preferences**: Independent voice.json per user
- **Shared voices**: System administrators can install voices in `out/voices/` for all users
- **Personal models**: User-trained RVC models stay private

## Best Practices

### For Voice Cloning

1. **Recording Quality**:
   - Use a quiet environment
   - Speak clearly and naturally
   - Avoid background noise
   - 5-10 seconds minimum for SoVITS
   - 3-5 minutes for RVC training

2. **Voice Selection**:
   - **Kokoro**: Best for quick setup, multi-language
   - **SoVITS**: Best for instant cloning, testing
   - **RVC**: Best for production use, highest quality

3. **Testing**:
   - Always test voice output before committing
   - Adjust speaking rate for clarity
   - Try different sample text to verify quality

### For Voice Chat

1. Enable both TTS and STT for seamless voice conversation
2. Use voice mode for hands-free interaction
3. Stop button for interrupting long responses
4. Replay important messages using per-message controls

## Troubleshooting

### TTS Not Working
- Check provider server is running (`./bin/mh kokoro serve status`)
- Verify voice.json configuration
- Check audio output device settings
- Look for errors in web UI console

### STT Not Recognizing
- Ensure Whisper server is running
- Check microphone permissions in browser
- Verify correct input device selected
- Try speaking more clearly or adjusting volume

### Voice Cloning Quality Issues
- Record more/better voice samples
- Use quieter environment for recording
- Try different provider (SoVITS vs RVC)
- Adjust pitch and index rate settings

## Next Steps

- Use voice in [Chat Interface](chat-interface.md) for hands-free interaction
- Integrate voice memories in [Memory System](memory-system.md)
- Monitor voice services in [Dashboard](dashboard-monitoring.md)
- Learn about [AI Training](../training-personalization/ai-training.md) to personalize responses
