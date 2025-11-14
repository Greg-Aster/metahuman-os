# GPT-SoVITS Setup Guide

GPT-SoVITS is an advanced few-shot voice cloning system that can generate natural-sounding speech with minimal training data. This guide covers installation, configuration, and usage within MetaHuman OS.

## Prerequisites

### System Requirements

**Required:**
- Python 3.9+ (3.10 or 3.11 recommended)
- 8GB RAM minimum (16GB+ recommended)
- 10GB+ free disk space for models and dependencies
- FFmpeg (for audio processing)

**Optional but Recommended:**
- NVIDIA GPU with 12GB+ VRAM (for faster generation)
- CUDA 11.8 or later
- 20GB+ disk space for voice training datasets

### Check Prerequisites

```bash
# Check Python version
python3 --version  # Should be 3.9+

# Check CUDA availability (optional)
nvidia-smi

# Check FFmpeg
ffmpeg -version
```

If any are missing, install them before proceeding.

## Installation

### Quick Install

MetaHuman OS provides a one-command installation:

```bash
./bin/mh sovits install
```

This will:
1. ✓ Check Python 3.9+ availability
2. ✓ Detect NVIDIA GPU/CUDA (if available)
3. ✓ Clone GPT-SoVITS repository to `external/gpt-sovits/`
4. ✓ Create Python virtual environment
5. ✓ Install PyTorch (CUDA or CPU version)
6. ✓ Install all required dependencies
7. ✓ Set up directory structure

The installation takes 5-15 minutes depending on your internet connection.

### Manual Installation

If the automatic installation fails, you can install manually:

```bash
# 1. Create directory
mkdir -p external/gpt-sovits

# 2. Clone repository
cd external/gpt-sovits
git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git .

# 3. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 4. Install dependencies
pip install --upgrade pip
pip install -r ../../etc/sovits-requirements.txt

# 5. Return to MetaHuman root
cd ../..
```

## Download Pre-trained Models

GPT-SoVITS requires pre-trained base models (several GB):

```bash
./bin/mh sovits download-models
```

This downloads:
- GPT base model (~2GB)
- SoVITS base model (~500MB)

Models are saved to `external/gpt-sovits/GPT_weights/` and `external/gpt-sovits/SoVITS_weights/`.

**Alternative:** Download manually from [HuggingFace](https://huggingface.co/lj1995/GPT-SoVITS/tree/main) and place in the appropriate directories.

## Server Management

### Start Server

```bash
# Start on default port (9880)
./bin/mh sovits start

# Start on custom port
./bin/mh sovits start --port 8000
```

The server runs in the background. Logs are written to `logs/sovits/server.log`.

### Check Status

```bash
./bin/mh sovits status
```

Output example:
```
GPT-SoVITS Server Status

Installation: ✓ Installed
Server:       ✓ Running
PID:          12345
Health:       ✓ Healthy
Disk usage:   4.23 GB

Configuration:
  Provider:     gpt-sovits
  Server URL:   http://127.0.0.1:9880
  Speaker ID:   default
  Auto-fallback: Enabled
```

### View Logs

```bash
# Show last 50 lines (default)
./bin/mh sovits logs

# Show last 200 lines
./bin/mh sovits logs --tail 200

# Follow logs in real-time
tail -f logs/sovits/server.log
```

### Stop Server

```bash
./bin/mh sovits stop
```

### Restart Server

```bash
./bin/mh sovits restart
```

## Configuration

### Voice Configuration

Edit `etc/voice.json` (or `profiles/<username>/etc/voice.json` for multi-user setups):

```json
{
  "tts": {
    "provider": "gpt-sovits",
    "sovits": {
      "serverUrl": "http://127.0.0.1:9880",
      "referenceAudioDir": "./out/voices/sovits",
      "speakerId": "default",
      "temperature": 0.6,
      "speed": 1.0,
      "timeout": 30000,
      "autoFallbackToPiper": true
    }
  }
}
```

**Configuration Options:**

- **`serverUrl`**: GPT-SoVITS server endpoint
- **`referenceAudioDir`**: Directory containing speaker reference audio
- **`speakerId`**: Speaker identifier for voice selection
- **`temperature`**: Generation temperature (0.1-1.0, higher = more variation)
- **`speed`**: Speech speed multiplier (0.5-2.0)
- **`timeout`**: Request timeout in milliseconds
- **`autoFallbackToPiper`**: Automatically use Piper if SoVITS fails

### Web UI Configuration

You can also configure GPT-SoVITS through the Web UI:

1. Navigate to **Settings → Voice**
2. Click the **GPT-SoVITS** provider button
3. Configure server URL, speaker ID, temperature, and speed
4. Enable/disable auto-fallback
5. Click **Save Settings**

## Adding Voice Speakers

GPT-SoVITS can clone voices using reference audio files.

### Prepare Reference Audio

1. **Record or obtain a clean audio sample** (5-30 seconds recommended)
   - Format: WAV, MP3, or FLAC
   - Quality: Clear speech, minimal background noise
   - Content: Natural speaking, not reading/monotone

2. **Create speaker directory:**
   ```bash
   mkdir -p out/voices/sovits/my-speaker
   ```

3. **Add reference audio:**
   ```bash
   cp /path/to/audio.wav out/voices/sovits/my-speaker/reference.wav
   ```

### Directory Structure

```
out/voices/sovits/
├── default/
│   └── reference.wav
├── speaker-1/
│   └── reference.wav
└── speaker-2/
    ├── reference.wav
    ├── sample-1.mp3
    └── sample-2.flac
```

**Naming Convention:**
- Files named `reference.*` are used first
- Otherwise, the first audio file alphabetically is used

### Use Custom Speaker

Update `etc/voice.json`:

```json
{
  "tts": {
    "sovits": {
      "speakerId": "my-speaker"
    }
  }
}
```

Or via Web UI: **Settings → Voice → Speaker ID → `my-speaker`**

## Testing

### Test Server

```bash
# Test with default text
./bin/mh sovits test

# Test with custom text
./bin/mh sovits test "This is a custom test message"
```

Output:
```
Testing GPT-SoVITS server...

Text: "This is a custom test message"

✓ Server responded successfully
  Audio size: 127.45 KB
  Content-Type: audio/wav
```

### Test in Web UI

1. Navigate to **Settings → Voice**
2. Select **GPT-SoVITS** provider
3. Enter test text
4. Click **Test Voice**
5. Audio should play

### Test in Chat

1. Enable TTS in **Chat** interface
2. Send a message
3. Click the **Speak** button
4. Audio should be generated using GPT-SoVITS

## Troubleshooting

### Server Won't Start

**Check installation:**
```bash
./bin/mh sovits status
```

If not installed:
```bash
./bin/mh sovits install
```

**Check logs:**
```bash
./bin/mh sovits logs --tail 100
```

Common issues:
- Missing dependencies → Reinstall: `./bin/mh sovits uninstall && ./bin/mh sovits install`
- Port conflict → Use custom port: `./bin/mh sovits start --port 8000`
- Permission errors → Check file permissions in `external/gpt-sovits/`

### CUDA/GPU Not Detected

Check CUDA installation:
```bash
nvidia-smi
python3 -c "import torch; print(torch.cuda.is_available())"
```

If CUDA is available but not detected:
1. Reinstall PyTorch with CUDA support
2. Activate venv: `source external/gpt-sovits/venv/bin/activate`
3. Install: `pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118`

### Slow Generation

GPT-SoVITS is computationally intensive:

**On CPU:**
- Generation takes 10-30 seconds per sentence
- Consider using Piper for real-time use
- Enable auto-fallback: `"autoFallbackToPiper": true`

**On GPU:**
- Generation takes 1-5 seconds per sentence
- Ensure CUDA is properly configured
- Monitor VRAM usage: `nvidia-smi`

### Out of Memory (OOM) Errors

Reduce batch size or use CPU:

1. Edit server configuration (if available)
2. Reduce concurrent requests
3. Use smaller model variants
4. Enable auto-fallback to Piper

### Voice Quality Issues

**Poor audio quality:**
- Use higher quality reference audio
- Record in quiet environment
- Use WAV format for best results

**Robotic/unnatural voice:**
- Adjust temperature (try 0.4-0.8)
- Use longer reference audio (10-30 seconds)
- Ensure reference audio contains natural speech

**Wrong voice/accent:**
- Verify correct speaker ID is configured
- Check reference audio path
- Ensure reference audio matches target speaker

## Uninstallation

To remove GPT-SoVITS:

```bash
# Stop server
./bin/mh sovits stop

# Uninstall
./bin/mh sovits uninstall
```

This removes:
- `external/gpt-sovits/` directory
- Python virtual environment
- Downloaded models

Voice configuration in `etc/voice.json` is preserved.

## Advanced Usage

### Multiple Speakers

You can configure multiple speaker profiles and switch between them:

```bash
# Add speakers
mkdir -p out/voices/sovits/{voice-a,voice-b,voice-c}
cp /path/to/audio-a.wav out/voices/sovits/voice-a/reference.wav
cp /path/to/audio-b.wav out/voices/sovits/voice-b/reference.wav
cp /path/to/audio-c.wav out/voices/sovits/voice-c/reference.wav
```

Switch speakers via Web UI or by editing `etc/voice.json`.

### Remote Server

GPT-SoVITS can run on a separate machine:

1. **On server machine:**
   ```bash
   ./bin/mh sovits start --port 9880
   ```

2. **On client machine (MetaHuman OS):**
   Edit `etc/voice.json`:
   ```json
   {
     "tts": {
       "sovits": {
         "serverUrl": "http://server-ip:9880"
       }
     }
   }
   ```

**Security Note:** Only expose GPT-SoVITS to trusted networks. Use firewall rules or SSH tunneling for remote access.

### Performance Tuning

**For faster generation:**
- Use GPU with 12GB+ VRAM
- Enable xformers (requires manual installation)
- Use smaller models (if available)
- Batch multiple requests

**For quality:**
- Use high-quality reference audio
- Experiment with temperature (0.4-0.8)
- Use longer reference clips (15-30 seconds)

## Resources

- [GPT-SoVITS GitHub](https://github.com/RVC-Boss/GPT-SoVITS)
- [Pre-trained Models](https://huggingface.co/lj1995/GPT-SoVITS)
- [MetaHuman OS Documentation](../README.md)
- [Voice Configuration Guide](user-guide/14-configuration-files.md)

## FAQ

**Q: Can I use GPT-SoVITS without a GPU?**
A: Yes, but generation will be much slower (10-30 seconds vs 1-5 seconds). Enable auto-fallback to Piper for better experience.

**Q: How much reference audio do I need?**
A: 5-30 seconds is typically sufficient. Quality matters more than quantity.

**Q: Can I train custom voices?**
A: Yes, but training requires significant data (hours of audio) and is beyond the scope of this guide. Refer to GPT-SoVITS documentation.

**Q: Does GPT-SoVITS work offline?**
A: Yes, once models are downloaded, it runs entirely locally.

**Q: Which is better: Piper or GPT-SoVITS?**
A:
- **Piper**: Faster, lower resource usage, more reliable
- **GPT-SoVITS**: Higher quality, voice cloning, more natural
- **Recommendation**: Use GPT-SoVITS with auto-fallback enabled for best of both worlds
