# GPT-SoVITS Voice Cloning Guide

GPT-SoVITS is a few-shot voice cloning system that can generate natural-sounding speech with minimal training data (just 5-10 seconds of reference audio).

## Quick Start

### 1. Installation

The addon installs automatically when you enable it in the Addons tab. This includes:
- Cloning the GPT-SoVITS repository
- Creating a Python virtual environment
- Installing all dependencies
- Downloading pretrained models (~2GB)

### 2. Preparing Reference Audio

GPT-SoVITS needs reference audio to clone a voice. You need:
- **Duration**: 5-10 seconds of clean speech
- **Format**: WAV or MP3
- **Quality**: Clear, minimal background noise
- **Content**: Natural speech (not singing or whispering)

#### Directory Structure

Place your reference audio files here:
```
out/voices/sovits/[speaker-id]/
```

For example:
```
out/voices/sovits/john/reference.wav
out/voices/sovits/sarah/voice-sample.mp3
out/voices/sovits/default/my-voice.wav
```

### 3. Using GPT-SoVITS

#### Via Web UI (Settings → Voice)

1. Select **GPT-SoVITS** as the TTS provider
2. Set the **Speaker ID** (e.g., "john")
3. Server auto-starts when you run `pnpm dev`
4. Click **Test Voice** to generate speech

#### Via API

```bash
curl -X POST http://127.0.0.1:9880/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, this is a test",
    "text_lang": "en",
    "ref_audio_path": "out/voices/sovits/john/reference.wav",
    "prompt_text": "Hello",
    "prompt_lang": "en"
  }'
```

#### Via CLI

```bash
# Generate speech
pnpm --filter metahuman-cli mh sovits test "Your text here"
```

## Server Management

### Auto-Start
The server automatically starts when you run `pnpm dev` if the addon is enabled.

### Manual Control
```bash
# Start server
pnpm --filter metahuman-cli mh sovits start

# Stop server
pnpm --filter metahuman-cli mh sovits stop

# Check status
pnpm --filter metahuman-cli mh sovits status

# View logs
pnpm --filter metahuman-cli mh sovits logs
```

## Voice Settings Explained

- **Server URL**: Where GPT-SoVITS is running (default: http://127.0.0.1:9880)
- **Speaker ID**: The subdirectory name in `out/voices/sovits/`
- **Temperature**: Controls randomness (0.0-1.0, default 0.6)
  - Lower = more consistent
  - Higher = more varied
- **Speed**: Playback speed multiplier (default 1.0)
- **Auto-fallback to Piper**: If GPT-SoVITS fails, use Piper instead

## Troubleshooting

### "No reference audio specified"
This means you haven't placed any reference audio files in the correct directory. Create the folder structure and add a WAV/MP3 file.

### Server won't start
1. Check logs: `pnpm --filter metahuman-cli mh sovits logs`
2. Verify installation: `ls -la external/gpt-sovits/venv`
3. Check models: `ls -la external/gpt-sovits/GPT_SoVITS/pretrained_models/`

### Poor quality output
- Use higher quality reference audio (16kHz+ sample rate)
- Ensure reference audio has clear speech, no music/noise
- Try adjusting temperature (lower for more consistency)

## Advanced Usage

### Multiple Voices
Create multiple speaker directories:
```
out/voices/sovits/
├── person-a/
│   └── reference.wav
├── person-b/
│   └── voice.wav
└── narrator/
    └── sample.mp3
```

Then switch between them by changing the Speaker ID in settings.

### API Endpoints

The GPT-SoVITS server provides several endpoints:

- `POST /` - Text-to-speech synthesis
- `POST /tts` - Alternative TTS endpoint
- `GET /voices` - List available voices (if configured)

### Integration with MetaHuman

The system automatically uses your configured provider:
1. Web UI chat uses TTS for responses
2. Voice settings saved per profile
3. Auto-fallback to Piper if GPT-SoVITS unavailable

## Performance Notes

- **VRAM**: Recommended 12GB+ for smooth operation
- **CPU Mode**: Works but much slower
- **First Generation**: Takes longer as models load into memory
- **Subsequent Generations**: Much faster once models are loaded
