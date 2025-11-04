# Whisper Setup Guide

This guide explains how to enable real audio transcription in MetaHuman OS using Whisper.

## Overview

MetaHuman OS supports multiple transcription providers:

1. **whisper.cpp** (Recommended) - Fast, local, open-source
2. **OpenAI Whisper API** - Cloud-based, requires API key
3. **Mock** - Placeholder for testing without transcription

By default, the system uses **mock** transcription. Follow the steps below to enable real transcription.

---

## Option 1: whisper.cpp (Local, Recommended)

### Prerequisites
- C++ compiler (gcc/clang)
- Git
- At least 4GB RAM

### Installation

#### Step 1: Clone whisper.cpp

```bash
cd ~
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
```

#### Step 2: Build

```bash
make
```

This creates the `main` executable (the whisper.cpp binary).

#### Step 3: Download a Model

Download a Whisper model (base.en is a good start):

```bash
bash ./models/download-ggml-model.sh base.en
```

Available models (size vs accuracy trade-off):
- `tiny.en` - 75MB, fastest
- `base.en` - 142MB, **recommended for most use**
- `small.en` - 466MB, better accuracy
- `medium.en` - 1.5GB, high accuracy
- `large` - 2.9GB, best accuracy

#### Step 4: Add to PATH

Make whisper.cpp accessible:

```bash
# Option A: Symlink to /usr/local/bin
sudo ln -s ~/whisper.cpp/main /usr/local/bin/whisper

# Option B: Add to PATH in .bashrc/.zshrc
echo 'export PATH="$HOME/whisper.cpp:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

#### Step 5: Test Installation

```bash
whisper --help
```

You should see the whisper.cpp help text.

#### Step 6: Configure MetaHuman

Update `etc/audio.json`:

```json
{
  "transcription": {
    "provider": "whisper.cpp",
    "model": "base.en",
    "whisperCppPath": "/usr/local/bin/whisper",
    "modelPath": "~/whisper.cpp/models/ggml-base.en.bin",
    "language": "en",
    "temperature": 0.0,
    "autoTranscribe": true
  }
}
```

Adjust `modelPath` to match where you downloaded the model.

MetaHuman now reads these override values directly when calling the transcription adapter, so you can keep both the binary and model wherever you installed whisper.cpp—no need to copy the model into the repository.

---

## Option 2: OpenAI Whisper API (Cloud)

### Prerequisites
- OpenAI API account
- API key with Whisper access

### Setup

#### Step 1: Get API Key

1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Copy the key (starts with `sk-...`)

#### Step 2: Configure MetaHuman

Update `etc/audio.json`:

```json
{
  "transcription": {
    "provider": "openai",
    "openaiApiKey": "sk-YOUR_API_KEY_HERE",
    "language": "en",
    "temperature": 0.0,
    "autoTranscribe": true
  }
}
```

**⚠️ Security Note:** Never commit API keys to version control. Consider using environment variables:

```bash
export OPENAI_API_KEY="sk-YOUR_KEY_HERE"
```

Then reference in config:
```json
{
  "transcription": {
    "provider": "openai",
    "openaiApiKey": "${OPENAI_API_KEY}",
    ...
  }
}
```

---

## Verification

### Test Transcription

1. Start the transcriber agent:
   ```bash
   ./bin/mh agent run transcriber
   ```

2. You should see:
   ```
   Transcriber Agent starting...
   Transcription provider: whisper.cpp (local, fast)
   ```

3. Upload a test audio file or place one in `memory/audio/inbox/`

4. Watch the agent logs for transcription progress

5. Check results:
   ```bash
   ./bin/mh audio status
   ./bin/mh audio list
   ```

---

## Troubleshooting

### "whisper.cpp not found"

- Verify installation: `which whisper` or `which main`
- Check PATH: `echo $PATH`
- Try absolute path in config: `"whisperCppPath": "/full/path/to/whisper.cpp/main"`

### "Model file not found"

- Verify model exists: `ls ~/whisper.cpp/models/`
- Use absolute path: `"modelPath": "/home/user/whisper.cpp/models/ggml-base.en.bin"`

### "Transcription failed"

- Check agent logs: `./bin/mh agent logs transcriber`
- Check audit logs: `cat logs/audit/$(date +%Y-%m-%d).ndjson | grep transcription`
- Test whisper.cpp directly:
  ```bash
  whisper -m ~/whisper.cpp/models/ggml-base.en.bin -f /path/to/test.mp3
  ```

### OpenAI API Errors

- Verify API key is valid
- Check account has credits/billing set up
- Check file size (max 25MB for Whisper API)

---

## Performance Tips

### whisper.cpp Optimization

1. **Use appropriate model size**
   - Development: `tiny.en` or `base.en`
   - Production: `small.en` or `medium.en`

2. **Enable GPU acceleration** (if you have CUDA/Metal):
   ```bash
   # CUDA (NVIDIA)
   make clean
   WHISPER_CUDA=1 make

   # Metal (Apple Silicon)
   make clean
   WHISPER_METAL=1 make
   ```

3. **Adjust thread count** in config:
   ```json
   {
     "transcription": {
       "threads": 4
     }
   }
   ```

---

## Next Steps

Once transcription is working:

1. Start the audio-organizer agent to create memories from transcripts:
   ```bash
   ./bin/mh agent run audio-organizer
   ```

2. Monitor the pipeline:
   ```bash
   ./bin/mh audio status
   ```

3. Upload audio via web UI at http://localhost:4321

For more information, see:
- Main documentation: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
- Audio configuration: [../etc/audio.json](../etc/audio.json)
- whisper.cpp repository: https://github.com/ggerganov/whisper.cpp
