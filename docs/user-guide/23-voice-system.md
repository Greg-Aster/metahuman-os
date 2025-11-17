# Voice System (Text-to-Speech)

MetaHuman OS features a comprehensive, local-first voice system that allows your digital personality to speak with your own voice. The system supports three different TTS providers, each with unique capabilities and use cases.

## Overview

The voice system is designed with these principles:
- **Local-First**: All voice generation happens on your infrastructure (no cloud dependencies)
- **Privacy-Focused**: Your voice data never leaves your machine
- **Multi-Provider**: Choose between fast synthetic voices, real-time voice cloning, or high-quality trained voice conversion
- **Configurable**: Adjust speed, pitch, and quality to your preferences

## TTS Providers

### 1. Piper TTS (Default)

**Best For**: Fast, natural-sounding voices without training

Piper is a lightweight, fast neural TTS system that provides high-quality synthetic voices. It's the default provider and requires no setup or training.

**Features:**
- **Speed**: Generates audio in real-time (< 1 second for typical responses)
- **Quality**: Natural-sounding neural voices
- **Voices**: 50+ voices across multiple languages and accents
- **Resource Usage**: Minimal CPU/RAM, no GPU required

**Configuration** (`etc/voice.json`):
```json
{
  "tts": {
    "provider": "piper",
    "piper": {
      "model": "out/voices/amy/amy.onnx",
      "speakingRate": 1.0
    }
  }
}
```

**Voice Selection:**
- Available voices are in `out/voices/`
- Each voice has two files: `.onnx` (model) and `.onnx.json` (config)
- Change voices via the Voice Settings UI or by editing the config

**Use Cases:**
- Quick setup without training
- Multiple language support
- Low-resource environments (CPU-only)
- Fast response time is critical

---

### 2. GPT-SoVITS (Real-Time Voice Cloning)

**Best For**: Instant voice cloning with minimal samples

GPT-SoVITS is a zero-shot voice cloning system that can replicate your voice from just 5-10 seconds of reference audio. No training required!

**Features:**
- **Zero-Shot**: Clone your voice from a single short sample
- **Fast Setup**: Record 5-10 seconds → test immediately
- **Real-Time**: Uses reference audio during inference (no model training)
- **Quality**: High-quality voice replication with natural prosody
- **Automated**: Record in UI → Auto-copy to reference → Start server → Test

**Workflow:**
1. **Record Reference Audio**:
   - Go to Voice Clone Training tab
   - Select "GPT-SoVITS" provider
   - Click "Record" and speak for 5-10 seconds of clear speech
   - Recording is **automatically** copied to reference directory

2. **Activate SoVITS**:
   - Go to Voice Settings (left sidebar)
   - Select "GPT-SoVITS" from provider dropdown
   - Click "Save" (server **automatically** starts)

3. **Test Your Voice**:
   - Use "Test Voice" button in Voice Settings
   - Voice cloning happens in real-time using your reference audio

**Configuration** (`etc/voice.json`):
```json
{
  "tts": {
    "provider": "gpt-sovits",
    "sovits": {
      "serverUrl": "http://127.0.0.1:9880",
      "speakerId": "default",
      "temperature": 0.6,
      "speed": 1.0,
      "autoFallbackToPiper": true
    }
  }
}
```

**Technical Details:**
- **Backend**: FastAPI server (`external/gpt-sovits/`)
- **Reference Audio**: Stored in `profiles/<user>/out/voices/sovits-reference/default/`
- **Process**: SoVITS loads reference audio and clones voice on-the-fly during TTS requests
- **Fallback**: Automatically falls back to Piper if server is unavailable

**Use Cases:**
- Quick voice cloning without training time
- Testing your voice before committing to full training
- Situations where you don't have enough samples for RVC
- Real-time voice adaptation (reference can be updated anytime)

**Setup and Management:**

***System Requirements:***
- Python 3.9+
- 8GB RAM (16GB+ recommended)
- 10GB+ free disk space
- FFmpeg

***Installation:***
MetaHuman OS provides a one-command installation:
```bash
./bin/mh sovits install
```
This will clone the GPT-SoVITS repository, create a virtual environment, install dependencies, and download pre-trained models.

***Server Management:***
The server runs in the background. You can manage it with the following commands:
```bash
# Start server
./bin/mh sovits start

# Stop server
./bin/mh sovits stop

# Check status
./bin/mh sovits status

# View logs
./bin/mh sovits logs
```

***Uninstallation:***
To remove GPT-SoVITS:
```bash
./bin/mh sovits uninstall
```

**Advanced Usage:**

***Multiple Voices:***
Create multiple speaker directories in `out/voices/sovits/` and switch between them by changing the Speaker ID in the voice settings.

***Remote Server:***
You can run the GPT-SoVITS server on a separate machine and configure the `serverUrl` in `etc/voice.json` to point to it.

**Performance Notes:**

- **VRAM**: Recommended 12GB+ for smooth operation.
- **CPU Mode**: Works but is much slower.
- **First Generation**: Takes longer as models load into memory.
- **Subsequent Generations**: Much faster once models are loaded.

**Troubleshooting:**

***"No reference audio specified"***
This means you haven't placed any reference audio files in the correct directory. Create the folder structure and add a WAV/MP3 file.

***Server won't start***
1. Check logs: `pnpm --filter metahuman-cli mh sovits logs`
2. Verify installation: `ls -la external/gpt-sovits/venv`
3. Check models: `ls -la external/gpt-sovits/GPT_SoVITS/pretrained_models/`

***Poor quality output***
- Use higher quality reference audio (16kHz+ sample rate).
- Ensure reference audio has clear speech, no music/noise.
- Try adjusting temperature (lower for more consistency).

**FAQ:**

***Q: Can I use GPT-SoVITS without a GPU?***
A: Yes, but generation will be much slower. Enable auto-fallback to Piper for a better experience.

***Q: How much reference audio do I need?***
A: 5-30 seconds is typically sufficient. Quality matters more than quantity.

***Q: Can I train custom voices?***
A: Yes, but training requires significant data and is beyond the scope of this guide. Refer to the official GPT-SoVITS documentation for more information.

**Advanced Usage:**

***Multiple Voices:***
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

***Server Management:***
The server automatically starts when you run `pnpm dev` if the addon is enabled.
You can also control it manually:
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

***API Endpoints:***
The GPT-SoVITS server provides several endpoints:

- `POST /` - Text-to-speech synthesis
- `POST /tts` - Alternative TTS endpoint
- `GET /voices` - List available voices (if configured)

**Troubleshooting:**

***"No reference audio specified"***
This means you haven't placed any reference audio files in the correct directory. Create the folder structure and add a WAV/MP3 file.

***Server won't start***
1. Check logs: `pnpm --filter metahuman-cli mh sovits logs`
2. Verify installation: `ls -la external/gpt-sovits/venv`
3. Check models: `ls -la external/gpt-sovits/GPT_SoVITS/pretrained_models/`

***Poor quality output***
- Use higher quality reference audio (16kHz+ sample rate)
- Ensure reference audio has clear speech, no music/noise
- Try adjusting temperature (lower for more consistency)

**Performance Notes:**

- **VRAM**: Recommended 12GB+ for smooth operation
- **CPU Mode**: Works but much slower
- **First Generation**: Takes longer as models load into memory
- **Subsequent Generations**: Much faster once models are loaded

---

### 3. RVC (Retrieval-based Voice Conversion)

**Best For**: Highest quality voice cloning with trained models

RVC uses full model training to create a high-fidelity voice conversion model. This requires more samples and training time but produces the best quality results.

**Features:**
- **Highest Quality**: Most accurate voice replication
- **Two-Stage Architecture**: Piper generates base audio → RVC converts to your voice
- **Configurable Training**: Adjust epochs, batch size, checkpoints
- **Index-Based Retrieval**: Uses FAISS index for better voice characteristics
- **GPU Accelerated**: Training leverages GPU for faster results

**Two-Stage Synthesis:**
1.  **Stage 1 - Base Audio**: Piper generates initial speech.
2.  **Stage 2 - Voice Conversion**: RVC converts the Piper voice to your voice using the trained model.

This approach results in better quality than single-stage systems because Piper provides a high-quality base prosody, and RVC can focus solely on voice timbre conversion.

**Workflow:**

#### 1. Collect Training Samples

**Requirements:**
- **50+ samples** (recommended 100-200)
- **10+ minutes of audio** total
- **Quality score ≥ 70%**

**Collection Methods:**
- **Automatic**: Have conversations with MetaHuman - samples are auto-recorded
- **Manual**: Use "Select Samples" to choose high-quality clips
- **Direct Recording**: Record samples directly in the Voice Training tab

#### 2. Export Samples to RVC Training Directory

In the Voice Clone Training tab:
1. Select "RVC" provider
2. Click "Select Samples" to choose clips
3. Click "Copy Selected Samples" or "Auto-Export Best Samples"

**Important**: The export process **automatically cleans** the training directory before copying to prevent duplicate samples. No manual cleanup needed!

#### 3. Configure Training Parameters

Click "⚙️ Show Training Settings" to reveal training configuration:

**Total Epochs** (100-2000):
- Controls training iterations
- Default: 300 (30-60 minutes)
- Recommended for quality: 600-800 (1-2 hours)
- Best results: 1000+ (2-3 hours)
- **Higher = Better quality but longer training time**

**Save Checkpoint Every** (10-200):
- How often to save model snapshots
- Default: 50 epochs
- Lower = More checkpoints (uses more disk space)
- Checkpoints allow recovery if training fails

**Batch Size** (1-32):
- Number of samples processed per iteration
- Default: 8
- Lower if you run out of GPU memory
- Higher for faster training (if GPU allows)

**Estimated Training Time:**
- 300 epochs: 30-60 minutes
- 600 epochs: 1-2 hours
- 1000 epochs: 2-3 hours
- 2000 epochs: 3+ hours

#### 4. Train the Model

1. Review your training settings
2. Click "🎭 Train RVC Model"
3. **DO NOT navigate away** - training will be interrupted!
4. Watch the progress modal with:
   - Progress bar (0-100%)
   - Current epoch / Total epochs
   - Robot takeover messages (for entertainment)

**What Happens During Training:**
- **Step 1**: Preprocessing audio (slice, normalize, resample to 40kHz)
- **Step 2**: Feature extraction using RMVPE pitch detection
- **Step 3**: Model training with your configured epochs
- **Automatic**: FAISS index generation for voice retrieval
- **Output**: Model file (`default.pth`) and index file (`default.index`)

**GPU Considerations:**
- RVC training requires ~10GB VRAM
- Ollama will be **automatically stopped** before training to free GPU memory
- Training uses GPU for faster processing (CPU-only training is very slow)

#### 5. Test Your Voice

After training completes:
1. Go to Voice Settings
2. Select "RVC" from provider dropdown
3. Adjust pitch shift if needed (-12 to +12 semitones)
4. Click "Save"
5. Use "Test Voice" button to hear your cloned voice

**Configuration** (`profiles/<user>/etc/voice.json`):
```json
{
  "tts": {
    "provider": "rvc",
    "rvc": {
      "speakerId": "default",
      "pitchShift": 0,
      "speed": 1.0,
      "autoFallbackToPiper": true,
      "indexRate": 1.0,
      "volumeEnvelope": 0.0,
      "protect": 0.15,
      "f0Method": "rmvpe",
      "pauseOllamaDuringInference": true
    }
  }
}
```

**GPU Memory Management:**

RVC inference requires significant GPU VRAM (~2-4GB). To prevent out-of-memory errors when Ollama is also running, there are two approaches:

### **Recommended: VRAM Limiting (Preferred for Long-Term Use)**

This approach limits how much VRAM Ollama can consume, leaving headroom for RVC and other GPU processes. This is the best solution for sustained usage as it eliminates the overhead of pausing/resuming Ollama on every TTS request.

**Setup (One-Time Configuration):**

1. **Check Current GPU Status:**
   ```bash
   ./bin/gpu-status
   ```
   This shows your total VRAM, current usage, and recommendations.

2. **Configure Ollama VRAM Limit:**
   ```bash
   ./bin/configure-ollama-vram
   ```

   The script will:
   - Detect your GPU's total VRAM
   - Recommend an allocation (e.g., 60% for Ollama, 40% for RVC on 8GB GPUs)
   - Ask for confirmation or allow custom fraction
   - Create systemd override with `OLLAMA_GPU_MEM_FRACTION` environment variable
   - Optionally disable auto-pause since it's no longer needed

3. **Verify Configuration:**
   ```bash
   ./bin/gpu-status
   ```
   Should show "VRAM Limit: configured" under Ollama status.

**Recommended VRAM Allocations:**
- **8GB GPU**: 0.5-0.6 (50-60% for Ollama, 40-50% for RVC)
- **12GB GPU**: 0.6-0.7 (60-70% for Ollama, 30-40% for RVC)
- **16GB+ GPU**: 0.7-0.75 (70-75% for Ollama, 25-30% for RVC)

**Benefits:**
- No pause/resume overhead (instant TTS responses)
- Both services coexist peacefully
- Prevents OOM errors without interrupting Ollama
- One-time setup, works indefinitely

**After Setup:**
- Set `pauseOllamaDuringInference: false` in voice.json (script can do this for you)
- Monitor with `./bin/gpu-status` or `nvidia-smi` if issues occur

---

### **Alternative: Auto-Pause Ollama (Default, Fallback Option)**

If you haven't configured VRAM limiting yet, the system automatically pauses Ollama during RVC inference as a fallback safety mechanism.

- **Auto-Pause Behavior** (enabled when `pauseOllamaDuringInference: true`):
  - When RVC TTS starts, Ollama is temporarily paused using `SIGSTOP`
  - This frees GPU VRAM without killing the Ollama process
  - After RVC completes, Ollama resumes automatically with `SIGCONT`
  - Total pause time: ~1-3 seconds per TTS request

- **How It Works:**
  1. User triggers TTS with RVC provider
  2. System checks if Ollama is running
  3. If yes, sends `SIGSTOP` to pause (not kill) Ollama
  4. Waits 500ms for GPU memory to be released
  5. Runs RVC inference
  6. Sends `SIGCONT` to resume Ollama
  7. Waits 500ms for Ollama to reload models

- **Drawbacks:**
  - Adds 1-3 seconds latency to every TTS request
  - Ollama must reload model into VRAM after each pause
  - Not ideal for frequent TTS usage

- **When to Use:**
  - You haven't configured VRAM limiting yet
  - Testing RVC before committing to VRAM limits
  - GPU has <8GB VRAM and VRAM limiting alone isn't sufficient

**Configuration:**
- Set `pauseOllamaDuringInference: false` to disable (only do this after setting up VRAM limiting)
- If disabled and OOM occurs, RVC will fail and fallback to Piper (if enabled)

**Note:** Auto-pause is fully audited in logs (`ollama_paused_for_rvc`, `ollama_resumed_after_rvc`)

**Inference Quality Parameters** (Adjustable in Voice Settings UI):

These parameters control voice conversion quality and can be fine-tuned to fix grainy, robotic, or muffled voice issues:

- **Index Rate** (0.0-1.0, default: 1.0)
  - Voice retrieval strength from FAISS index
  - Higher = More of your voice characteristics
  - **Recommendation**: Keep at 1.0 for maximum voice accuracy

- **Volume Envelope** (0.0-1.0, default: 0.0)
  - RMS mixing rate between original and converted audio
  - 0.0 = Pure conversion (recommended)
  - 1.0 = Blend with original Piper voice
  - **Recommendation**: Keep at 0.0 to avoid dual-voice effect

- **Consonant Protection** (0.0-0.5, default: 0.15)
  - Protects voiceless consonants (s, t, k, p, etc.) during conversion
  - Lower = More aggressive conversion (may sound muffled)
  - Higher = More natural consonants (may sound less like your voice)
  - **Recommendations**:
    - Grainy voice: Try 0.15-0.20
    - Robotic voice: Increase to 0.20-0.25
    - Muffled voice: Decrease to 0.10-0.15

- **F0 Method** (default: "rmvpe")
  - Pitch detection algorithm
  - Options: "rmvpe" (recommended), "crepe" (high quality), "harvest" (fast), "dio" (fastest)
  - **Recommendation**: Use "rmvpe" for best accuracy

**How to Adjust Parameters:**
1. Go to Voice Settings (left sidebar)
2. Select RVC provider
3. Scroll to "⚙️ Advanced Quality Settings"
4. Adjust sliders while testing voice output
5. Click "Test RVC Voice" after each change
6. Click "Save" when satisfied with results

**Technical Architecture:**

**Two-Stage Synthesis:**
1. **Stage 1 - Base Audio**: Piper generates initial speech
2. **Stage 2 - Voice Conversion**: RVC converts Piper voice to your voice using configured parameters

**Why This Approach:**
- Piper provides fast, high-quality base prosody
- RVC focuses solely on voice timbre conversion
- Configurable parameters allow fine-tuning for optimal results
- Results in better quality than single-stage systems

**File Locations:**
- **Training Samples**: `profiles/<user>/out/voices/rvc-reference/default/`
- **Trained Model**: `profiles/<user>/out/voices/rvc-models/default/default.pth`
- **FAISS Index**: `profiles/<user>/out/voices/rvc-models/default/default.index`
- **Training Logs**: `logs/run/rvc-training-default.log`
- **Status File**: `logs/run/rvc-training-default.json`

**Use Cases:**
- Best possible voice quality
- You have sufficient training samples (50-200)
- You can afford 1-3 hours of GPU training time
- Professional applications requiring accurate voice replication

**Performance Considerations:**
- **VRAM**: 2-4 GB for inference, 10GB+ for training.
- **CPU Mode**: Works but is much slower.
- **Synthesis Speed**: 2-4 seconds for the first request, <100ms for cached requests.

**Known Limitations:**
- **Training Not Fully Integrated**: Currently requires external RVC training tools.
- **No Real-time Training Progress**: Training progress monitoring is not yet implemented in the UI.
- **No Model Validation**: The system doesn't validate that `.pth` files are actually RVC models.

**Future Enhancements:**
- Full RVC training integration via Python scripts.
- Training progress monitoring in the UI.
- Model quality validation.
- Auto-detection of optimal pitch shift.
- Batch voice conversion for faster synthesis.
- RVC model marketplace to share and import voices.

---

## Choosing a Provider

### 4. Kokoro (StyleTTS2 Voicepacks)

**Best For**: Studio-grade multilingual synthesis + optional voice cloning

Kokoro is a StyleTTS2-based provider bundled with 50+ high-quality voices across eight languages. It can also train custom “voicepacks” using your curated recordings.

**Features:**
- **Built-in Voices**: Select from curated voices (`af_heart`, `am_adam`, `bf_emma`, etc.).
- **Custom Voicepacks**: Train `.pt` packs from ≥5 minutes of cleaned recordings + transcripts.
- **Server Mode**: FastAPI server (`./bin/mh kokoro serve start`) handles requests over HTTP.
- **Device Flexibility**: Works on CPU, CUDA, or Apple MPS. When training on GPU, Kokoro auto-pauses Ollama to free VRAM and resumes it afterwards.
- **Fallback Support**: Enable “Auto-fallback to Piper” for resilience if the Kokoro server or voicepack fails.

**Workflow:**
1. **Install** via `./bin/install-kokoro.sh`.
2. **Start Server** with `./bin/mh kokoro serve start` (or the Voice Settings server controls).
3. **Select Voice** in Voice Settings (choose stock voice or toggle “Use custom voicepack”).
4. **Collect Samples** in Voice Clone Training (same shared recording pipeline as Piper/RVC).
5. **Export Dataset** to Kokoro via “Auto-Export Best Samples” or manual selection (writes to `profiles/<user>/out/voices/kokoro-datasets/<speaker>`).
6. **Train Voicepack** using “🎵 Train Kokoro Voicepack” or CLI `./bin/mh kokoro train-voicepack --speaker default`.
7. **Monitor** logs in `logs/run/kokoro-training-<speaker>.log` and status JSON in `logs/run/kokoro-training-<speaker>.json`.
8. **Activate** the generated `.pt` path in Voice Settings.

**Troubleshooting:**
- *CUDA out of memory*: Close other GPU workloads or switch Kokoro’s device to CPU before training.
- *Server not running*: Check `external/kokoro/kokoro_server.py` log (`logs/run/kokoro-server.log`) and start with `./bin/mh kokoro serve start`.
- *503 from /api/kokoro-training*: Ensure you’re logged in and have at least 10 exported samples (≥2 minutes) in the Kokoro dataset.
- *“Unsupported provider: kokoro”*: Use the Kokoro tab in the training UI; don’t call the SoVITS endpoint with the Kokoro provider.

---

## Choosing a Provider

| Feature | Piper | GPT-SoVITS | RVC | Kokoro |
|---------|-------|------------|-----|--------|
| **Setup Time** | Instant | 1 minute | 1-3 hours | < 10 minutes |
| **Training Required** | No | No | Yes | Optional (voicepacks) |
| **Sample Count** | 0 | 1 (5-10 sec) | 50+ (10-15 min) | 30+ curated clips |
| **Voice Quality** | Good | Very Good | Excellent | Studio-grade |
| **Generation Speed** | Very Fast | Fast | Fast | Fast (server) |
| **GPU Required** | No | No | Yes (training only) | Optional (training/inference faster on GPU) |
| **Resource Usage** | Minimal | Low | High (training) | Medium |
| **Use Your Voice** | No | Yes | Yes | Yes (built-in or custom) |

**Recommended Path:**
1. **Start with Piper** - Get familiar with the system
2. **Try GPT-SoVITS** - Quick voice cloning with minimal effort
3. **Graduate to RVC or Kokoro** - Best quality when you have time and samples

---

## Voice Settings UI

Access via the left sidebar → Voice Settings:

**Provider Selection:**
- Dropdown to choose Piper, GPT-SoVITS, RVC, or Kokoro
- Auto-starts services when switching providers (Kokoro server can also be started manually)

**Piper Settings:**
- Voice selector (browse available voices)
- Speaking rate (0.5x - 2.0x)

**GPT-SoVITS Settings:**
- Server URL (default: http://127.0.0.1:9880)
- Speaker ID
- Temperature (voice variation)
- Speed adjustment
- Auto-fallback to Piper toggle

**RVC Settings:**
- Speaker ID
- Pitch shift (-12 to +12 semitones)
- Speed adjustment
- Auto-fallback to Piper toggle

**Kokoro Settings:**
- Built-in voice chooser (54+ voices)
- Language code selector + speed slider
- Toggle for “Use custom voicepack” with path picker
- Server controls (start/stop/status)
- Auto-fallback to Piper toggle
- Advanced training card (base voice, epochs, learning rate, device, max samples)

**Test Panel:**
- Test text input
- "Test Voice" button
- Real-time audio playback
- Status indicator

---

## Voice Clone Training UI

Access via the left sidebar → Voice Clone Training:

**Provider Tabs:**
- Piper (for reference)
- GPT-SoVITS (quick cloning)
- RVC (full training)
- Kokoro (dataset export + voicepack training)

**Sample Management:**
- View all recorded samples with quality scores
- Play audio preview for each sample
- Select samples for training
- Delete low-quality samples

**Training Readiness:**
- Shows current sample count vs requirements
- Total audio duration vs requirements
- Average quality score
- Visual progress indicators

**Export Actions:**
- "Select Samples" - Manual selection interface
- "Auto-Export Best Samples" - Automatically selects high-quality samples
- "Copy Selected Samples" - Copies chosen samples to training directory (RVC + Kokoro datasets)

**Training Actions:**
- RVC: "🎭 Train RVC Model" (with advanced parameter toggle)
- Kokoro: "🎵 Train Kokoro Voicepack" (uses the current Kokoro training settings)

**RVC Training Controls:**
- "⚙️ Show/Hide Training Settings" - Toggle parameter panel
- Training parameter inputs (epochs, batch size, checkpoints)
- Estimated training time display
- "🎭 Train RVC Model" - Start training
- Training progress modal with epoch counter

**Direct Recording** (GPT-SoVITS):
- In-browser voice recorder
- Auto-copy to reference directory
- No export step needed

---

## Advanced Configuration

### Cache Settings

All TTS providers support audio caching to improve performance:

```json
{
  "cache": {
    "enabled": true,
    "directory": "profiles/<user>/out/voice-cache",
    "maxSizeMB": 500
  }
}
```

**Benefits:**
- Instant playback for repeated phrases
- Reduces CPU/GPU usage
- Saves battery on mobile devices

**Cache Keys:**
- Piper: `piper:<voice>:<rate>`
- SoVITS: `sovits:<speakerId>:<temperature>:<speed>`
- RVC: `rvc:<speakerId>:<pitchShift>`
- Kokoro: `kokoro:<langCode>:<voiceOrVoicepack>:<speed>`

### Multi-Voice Setup

You can train multiple RVC models for different voices:

1. Export samples with custom speaker ID
2. Train with `speakerId: "voice2"`
3. Switch between voices in Voice Settings

### Troubleshooting

**"RVC model not found" Error:**
- Ensure training completed successfully
- Check that `default.pth` exists in `out/voices/rvc-models/default/`
- Review training logs: `logs/run/rvc-training-default.log`

**"SoVITS server not responding" Error:**
- Verify server is running: Check Voice Settings status indicator
- Check server logs in Astro dev console
- Restart server by switching provider away and back

**"GPU out of memory" During Training:**
- Lower batch size in training settings (try 4 or 2)
- Close other GPU applications (Ollama, games, etc.)
- Reduce total epochs slightly

**Voice sounds robotic or grainy:**
- Increase training epochs (try 600-1000 instead of 300)
- Ensure training samples are high quality (≥ 70% score)
- Check that FAISS index was generated successfully
- Verify sufficient training data (50+ samples, 10+ minutes)

**Training interrupted:**
- Check GPU availability with `nvidia-smi`
- Review logs for error messages
- Ensure sufficient disk space
- Don't navigate away during training

---

## API Usage

### WebSocket TTS Streaming

The web UI uses WebSocket streaming for real-time audio:

```typescript
const ws = new WebSocket('ws://localhost:4321/api/tts-stream');
ws.send(JSON.stringify({ text: "Hello world" }));

ws.onmessage = (event) => {
  const audioBuffer = event.data; // WAV audio data
  // Play audio
};
```

### HTTP TTS Endpoint

```bash
curl -X POST http://localhost:4321/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from MetaHuman OS"}'
```

Response: WAV audio file (binary)

---

## Best Practices

**Sample Collection:**
- Record in a quiet environment
- Maintain consistent distance from microphone
- Speak naturally (don't over-enunciate)
- Vary content (different words, sentences)
- Aim for 70%+ quality scores

**Training Strategy:**
- Start with 300 epochs to test quickly
- If quality is insufficient, retrain with 600-800 epochs
- Save training time by not going straight to 1000+ epochs
- Export samples once, adjust epochs as needed

**Performance Optimization:**
- Enable caching for frequently used phrases
- Use Piper for non-critical voice output
- Reserve RVC for important conversations
- Close Ollama during RVC training to free VRAM (Kokoro training auto-pauses/resumes Ollama when running on GPU)

**Maintenance:**
- Periodically review and delete low-quality samples
- Clear voice cache if it grows too large (>500MB)
- Backup trained models before retraining

---

## Related Documentation

- [Voice Training CLI Commands](06-cli-reference.md#voice-commands)
- [Configuration Files Reference](14-configuration-files.md#voice-configuration)
- [Multi-User Voice Profiles](19-multi-user-profiles.md#per-user-voice-models)
- [Audio Ingestion](11-special-features.md#audio-ingestion--processing)
