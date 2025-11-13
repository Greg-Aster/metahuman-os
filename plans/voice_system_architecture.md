# Voice Profile System Architecture Plan

**Document Version:** 1.0
**Date:** 2025-11-12
**Author:** Claude Code System Architect
**Status:** Comprehensive Analysis & Design

---

## Executive Summary

This document provides a detailed technical architecture for the MetaHuman OS **Modular Voice Profile System**, designed to support multiple TTS engines (Piper, GPT-SoVITS, and future RVC integration) with strict **multi-user isolation** and **in-app installation workflows**.

### Current Implementation Status

The system **already has significant infrastructure in place**:

✅ **Multi-provider TTS architecture** (Piper + GPT-SoVITS)
✅ **User-isolated voice training** (`profiles/{user}/out/voice-training/`)
✅ **Reference audio management** (GPT-SoVITS few-shot cloning)
✅ **Server lifecycle management** (start/stop/status)
✅ **Voice sample collection & quality filtering**
✅ **Web UI for training, server control, and settings**
✅ **CLI commands for installation and management** (`mh sovits ...`)

### Key Findings

1. **GPT-SoVITS is the primary high-quality voice provider** - Already integrated and operational
2. **Piper serves as a fast fallback** - Used when GPT-SoVITS is unavailable or unconfigured
3. **User context is fully integrated** - Path resolution automatically uses `profiles/{username}/`
4. **Installation automation exists** - `bin/install-sovits.sh` handles Python venv and model downloads
5. **RVC integration would be additive** - Can follow the same architectural patterns as GPT-SoVITS

---

## 1. Data Structure Design

### 1.1 Voice Configuration Schema (`profiles/{user}/etc/voice.json`)

The system uses a **unified configuration file** with provider-specific sections:

```json
{
  "tts": {
    "provider": "piper" | "gpt-sovits" | "rvc",  // Active provider

    "piper": {
      "binary": "{METAHUMAN_ROOT}/bin/piper/piper",
      "model": "{METAHUMAN_ROOT}/out/voices/en_US-amy-medium.onnx",
      "config": "{METAHUMAN_ROOT}/out/voices/en_US-amy-medium.onnx.json",
      "speakingRate": 1.75,
      "outputFormat": "wav"
    },

    "sovits": {
      "serverUrl": "http://127.0.0.1:9880",
      "referenceAudioDir": "{PROFILE_DIR}/out/voices/sovits",  // User-specific!
      "speakerId": "default",
      "temperature": 0.7,
      "speed": 1.2,
      "outputFormat": "wav",
      "timeout": 30000,
      "autoFallbackToPiper": false
    },

    "rvc": {
      // Future RVC configuration (proposed)
      "serverUrl": "http://127.0.0.1:8765",
      "referenceAudioDir": "{PROFILE_DIR}/out/voices/rvc",
      "modelPath": "{PROFILE_DIR}/out/voices/rvc/models/default.pth",
      "indexPath": "{PROFILE_DIR}/out/voices/rvc/models/default.index",
      "pitchShift": 0,
      "autoFallbackToPiper": true
    }
  },

  "stt": {
    "provider": "whisper",
    "whisper": {
      "model": "base.en",
      "device": "cpu",
      "computeType": "int8",
      "language": "en"
    }
  },

  "cache": {
    "enabled": false,
    "directory": "{METAHUMAN_ROOT}/out/voice-cache",
    "maxSizeMB": 500
  },

  "training": {
    "enabled": false,
    "minDuration": 2,
    "maxDuration": 120,
    "minQuality": 0.6,
    "targetHours": 3
  }
}
```

**Key Design Decisions:**

- **Template variables**: `{METAHUMAN_ROOT}` and `{PROFILE_DIR}` are resolved at runtime
- **Provider abstraction**: Each provider has its own config section
- **Auto-fallback**: Allows graceful degradation to Piper if primary provider fails
- **User isolation**: `{PROFILE_DIR}` ensures voice models are stored per-user

### 1.2 File Location Standards

All voice-related data follows strict **user-profile isolation**:

```
metahuman/
├── profiles/{username}/
│   ├── etc/
│   │   └── voice.json                          # User-specific voice config
│   └── out/
│       ├── voices/
│       │   ├── sovits/
│       │   │   └── {speakerId}/
│       │   │       ├── reference.wav           # Concatenated reference audio
│       │   │       ├── voice-*.wav             # Individual samples
│       │   │       └── manifest.json           # Sample metadata
│       │   └── rvc/                            # Future RVC models
│       │       └── models/
│       │           ├── default.pth             # Trained RVC model
│       │           └── default.index           # RVC index file
│       └── voice-training/
│           ├── recordings/                     # Raw voice samples
│           │   ├── voice-{id}.wav
│           │   ├── voice-{id}.txt              # Transcript
│           │   └── voice-{id}.meta.json        # Quality metadata
│           └── dataset/                        # Exported training sets
│               └── metadata.csv                # Piper format
├── external/
│   ├── gpt-sovits/                             # GPT-SoVITS installation (system-wide)
│   │   ├── venv/                               # Python virtual environment
│   │   ├── api.py                              # Server script
│   │   └── GPT_SoVITS/pretrained_models/       # Shared base models
│   └── applio-rvc/                             # Future RVC installation (system-wide)
│       └── venv/
├── logs/run/
│   ├── sovits.pid                              # Server PID file
│   └── sovits.log                              # Server logs
└── out/
    └── voices/                                 # System-wide voice models (Piper)
        ├── en_US-amy-medium.onnx
        └── en_US-amy-medium.onnx.json
```

**Security Principle**:
- Base models and Python environments are **system-wide** (in `external/`)
- User-specific voice profiles and training data are **strictly isolated** (in `profiles/{user}/`)

---

## 2. Core Logic (`packages/core/`)

### 2.1 Current Architecture

The core package implements a **provider-based architecture** with clean interfaces:

#### **`packages/core/src/tts.ts`** - Main Entry Point

```typescript
// Factory pattern for provider creation
export function createTTSService(
  provider?: 'piper' | 'gpt-sovits',
  username?: string
): ITextToSpeechService {
  const userContext = getUserContext();
  const activeUsername = username || userContext?.username || 'anonymous';

  // Load raw config and resolve paths for this user
  const rawConfig = loadRawConfig();
  const cfg = resolveConfigPaths(rawConfig, activeUsername);

  // Create appropriate provider
  if (cfg.tts.provider === 'gpt-sovits') {
    return new SoVITSService(cfg.tts.sovits, cfg.cache, piperFallback);
  } else {
    return new PiperService(cfg.tts.piper, cfg.cache);
  }
}

// Main synthesis function
export async function generateSpeech(
  text: string,
  options?: TTSSynthesizeOptions
): Promise<Buffer> {
  const service = createTTSService(options?.provider, options?.username);
  return service.synthesize(text, options);
}
```

**Key Features:**
- **No provider caching** - Fresh service created per request to respect user context
- **Template path resolution** - `{PROFILE_DIR}` replaced with actual user path
- **Automatic fallback** - SoVITS can fall back to Piper if unavailable

#### **`packages/core/src/tts/interface.ts`** - Provider Contract

```typescript
export interface ITextToSpeechService {
  synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer>;
  getStatus(): Promise<TTSStatus>;
  clearCache?(): void;
}

export interface TTSConfig {
  provider: 'piper' | 'gpt-sovits' | 'rvc';
  piper?: PiperConfig;
  sovits?: SoVITSConfig;
  rvc?: RVCConfig;  // Future
}
```

#### **`packages/core/src/tts/providers/gpt-sovits-service.ts`** - GPT-SoVITS Implementation

**Key Implementation Details:**

1. **Reference Audio Discovery**:
   ```typescript
   private _findReferenceAudio(speakerId: string): string | undefined {
     const speakerDir = path.join(this.config.referenceAudioDir, speakerId);
     const files = fs.readdirSync(speakerDir).filter(f => /\.(wav|mp3|flac)$/i.test(f));

     // Prefer files named "reference.*" or use first available
     return files.find(f => f.startsWith('reference')) || files[0];
   }
   ```

2. **Server Health Check**:
   ```typescript
   private async _checkServerHealth(): Promise<boolean> {
     const response = await fetch(`${this.config.serverUrl}/`);
     return response !== null;  // Any response means server is alive
   }
   ```

3. **Request Deduplication**:
   ```typescript
   private activeRequests = new Map<string, Promise<Buffer>>();

   // Prevents duplicate concurrent requests for same text
   const requestKey = `${text}:${speakerId}:${temperature}:${speed}`;
   const existing = this.activeRequests.get(requestKey);
   if (existing) return existing;
   ```

### 2.2 Path Resolution System

**Critical Security Feature**: Multi-user path isolation

```typescript
// packages/core/src/paths.ts
export function getProfilePaths(username: string) {
  const profileRoot = path.join(ROOT, 'profiles', username);

  return {
    voiceTraining: path.join(profileRoot, 'out', 'voice-training', 'recordings'),
    voiceDataset: path.join(profileRoot, 'out', 'voice-training', 'dataset'),
    voiceConfig: path.join(profileRoot, 'etc', 'voice.json'),
    sovitsReference: path.join(profileRoot, 'out', 'voices', 'sovits'),
    sovitsModels: path.join(profileRoot, 'out', 'voices', 'sovits-models'),
  };
}

// Context-aware proxy
export const paths = new Proxy({}, {
  get(target, prop: string) {
    const context = getUserContext();

    // SECURITY: Block anonymous users from accessing user data
    if (context?.username === 'anonymous' && !context.activeProfile) {
      throw new Error('Access denied: Anonymous users cannot access user data paths');
    }

    // Return user-specific paths if context exists
    if (context) {
      return context.profilePaths[prop];
    }

    // Fallback to root paths (CLI operations)
    return rootPaths[prop];
  }
});
```

### 2.3 Voice Training & Sample Management

**`packages/core/src/voice-training.ts`** - Sample Collection

```typescript
export function saveVoiceSample(
  audioBuffer: Buffer,
  transcript: string,
  duration: number,
  quality: number,
  format: 'wav' | 'webm'
): VoiceSample | null {
  const cfg = loadConfig();

  // Validation checks
  if (!cfg.enabled) return null;
  if (duration < cfg.minDuration || duration > cfg.maxDuration) return null;
  if (quality < cfg.minQuality) return null;

  // Save to user-specific training directory
  const trainingDir = paths.voiceTraining;
  const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  fs.writeFileSync(path.join(trainingDir, `${id}.wav`), audioBuffer);
  fs.writeFileSync(path.join(trainingDir, `${id}.txt`), transcript);
  fs.writeFileSync(path.join(trainingDir, `${id}.meta.json`), JSON.stringify({
    id, duration, quality, timestamp: new Date().toISOString()
  }));

  return { id, duration, quality, timestamp };
}
```

**Key Functions:**

- `getTrainingProgress()` - Returns sample count, total duration, quality metrics
- `listVoiceSamples(limit)` - Retrieves recent samples sorted by timestamp
- `copyToSoVITS(sampleIds)` - Copies selected samples to reference audio directory
- `exportSoVITSDataset()` - Auto-selects best quality samples for voice cloning

---

## 3. API Layer (`apps/site/src/pages/api/`)

### 3.1 TTS Generation API

**`apps/site/src/pages/api/tts.ts`**

```typescript
export const POST: APIRoute = async ({ request, cookies }) => {
  const { text, provider, model, speakingRate } = await request.json();

  // Get user session for profile-aware TTS
  const session = getSession(cookies.get('mh_session')?.value);
  const username = session?.userId ? getUser(session.userId)?.username : 'anonymous';

  // Generate speech with user-specific voice profile
  const audioBuffer = await generateSpeech(text, {
    provider,
    voice: model,
    speakingRate,
    username,
    signal: request.signal
  });

  return new Response(audioBuffer, {
    headers: { 'Content-Type': 'audio/wav' }
  });
};
```

### 3.2 Server Management API

**`apps/site/src/pages/api/sovits-server.ts`**

**GET `/api/sovits-server`** - Check server status

```typescript
{
  running: boolean,
  installed: boolean,
  pid?: number,
  port?: number,
  serverUrl?: string,
  healthy?: boolean
}
```

**POST `/api/sovits-server`** - Start/stop server

```typescript
// Start server
{ action: 'start', port: 9880 }

// Stop server
{ action: 'stop' }
```

**Implementation Notes:**

- Server runs in detached mode (`detached: true, stdio: ['ignore', logFd, logFd]`)
- PID tracked in `logs/run/sovits.pid` as JSON
- Uses Python venv if available: `external/gpt-sovits/venv/bin/python3`
- Logs to `logs/run/sovits.log`

### 3.3 Training Data API

**`apps/site/src/pages/api/sovits-training.ts`**

**Endpoints:**

1. **GET `/api/sovits-training?action=available-samples`**
   - Returns voice samples from `profiles/{user}/out/voice-training/`
   - Filtered by quality threshold

2. **GET `/api/sovits-training?action=reference-samples`**
   - Returns reference audio files already copied to SoVITS directory

3. **GET `/api/sovits-training?action=training-readiness`**
   - Checks if sufficient samples exist for voice cloning
   - Returns readiness status and requirements

4. **POST `/api/sovits-training` - `action=copy-samples`**
   - Copies selected samples to reference audio directory
   - Concatenates multiple samples into `reference.wav`

5. **POST `/api/sovits-training` - `action=auto-export`**
   - Auto-selects best quality samples (≥80%)
   - Exports to reference directory

---

## 4. UI Components (`apps/site/src/components/`)

### 4.1 Navigation Structure

**`LeftSidebar.svelte`** - Main navigation menu

```typescript
const menuItems = [
  { id: 'voice', label: 'Voice', icon: '🎤', description: 'Audio & training' },
  { id: 'system', label: 'System', icon: '⚙️', description: 'Settings & tools' },
  // ...
];
```

**`CenterContent.svelte`** - View router

```svelte
{#if $activeView === 'voice'}
  <div class="voice-section">
    <div class="tab-selector">
      <button class:active={voiceTab === 'upload'} on:click={() => voiceTab = 'upload'}>
        Audio Upload
      </button>
      <button class:active={voiceTab === 'training'} on:click={() => voiceTab = 'training'}>
        Voice Training
      </button>
      <button class:active={voiceTab === 'settings'} on:click={() => voiceTab = 'settings'}>
        Voice Settings
      </button>
    </div>

    {#if voiceTab === 'upload'}
      <AudioUpload />
    {:else if voiceTab === 'training'}
      <VoiceTrainingWidget provider={currentProvider} />
    {:else if voiceTab === 'settings'}
      <VoiceSettings />
    {/if}
  </div>
{/if}
```

### 4.2 Voice Settings Component

**`VoiceSettings.svelte`** - Provider selection and configuration

**Key Features:**

1. **Provider Toggle**:
   ```svelte
   <div class="provider-toggle">
     <button class:active={provider === 'piper'} on:click={() => provider = 'piper'}>
       🎙️ Piper
     </button>
     <button class:active={provider === 'gpt-sovits'} on:click={() => provider = 'gpt-sovits'}>
       🤖 GPT-SoVITS
     </button>
   </div>
   ```

2. **Server Status Indicator** (GPT-SoVITS only):
   ```svelte
   <ServerStatusIndicator
     serverName="GPT-SoVITS"
     statusEndpoint="/api/sovits-server"
     controlEndpoint="/api/sovits-server"
     autoRefresh={true}
     refreshInterval={15000}
   />
   ```

3. **Dynamic Settings** - Provider-specific controls:
   - **Piper**: Voice model dropdown, speaking rate slider
   - **GPT-SoVITS**: Server URL, speaker ID, temperature, speed, auto-fallback toggle

### 4.3 Voice Training Widget

**`VoiceTrainingWidget.svelte`** - Sample management and export

**Workflow (GPT-SoVITS):**

```svelte
<div class="workflow-guide">
  <ol>
    <li>Enable Training: Turn on voice training above</li>
    <li>Collect Samples: Have conversations - samples auto-recorded</li>
    <li>Select Best Samples: Click "Select Samples" (3-5 clips, 5-10 sec total)</li>
    <li>Copy to Reference: Click "Copy Selected Samples" or "Auto-Export"</li>
    <li>Start Server: Go to Voice Settings → Start Server</li>
    <li>Test Your Voice: Use test panel to hear cloned voice</li>
  </ol>
</div>
```

**Key Functions:**

- `fetchProgress()` - Get sample count, duration, quality stats
- `fetchReadiness()` - Check if ready for training (min samples, duration, quality)
- `autoExportBest()` - Auto-select top quality samples (≥80%)
- `copySelectedSamples()` - Manually copy chosen samples to reference directory
- `purgeAllData()` - Delete all training data (confirmation required)

### 4.4 Reference Audio Selector

**`ReferenceAudioSelector.svelte`** - Sample selection UI

**Features:**

- Audio preview with play button
- Quality score badges (high/medium/low)
- Multi-select checkboxes
- Total duration calculator
- Sort by quality/date

### 4.5 Direct Voice Recorder

**`DirectVoiceRecorder.svelte`** - In-app recording widget

**Implementation:**

```typescript
// Record audio using MediaRecorder API
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus'
});

// Upload recorded audio to server
const formData = new FormData();
formData.append('audio', audioBlob, 'recording.webm');
formData.append('speakerId', speakerId);

const response = await fetch('/api/voice-samples/upload', {
  method: 'POST',
  body: formData
});
```

---

## 5. CLI Commands (`packages/cli/src/commands/sovits.ts`)

### 5.1 Command Structure

```bash
mh sovits <command> [options]
```

**Available Commands:**

1. **`install`** - Install GPT-SoVITS and dependencies
   - Clones repository to `external/gpt-sovits/`
   - Creates Python venv
   - Installs requirements
   - Downloads pretrained models

2. **`start [--port 9880]`** - Start server
   - Checks if already running
   - Validates installation
   - Spawns detached Python process
   - Writes PID file

3. **`stop`** - Stop server
   - Reads PID file
   - Sends SIGTERM (graceful)
   - Force SIGKILL if needed
   - Cleans up PID file

4. **`status`** - Check server status
   - Installation check
   - Process check (PID validation)
   - Health check (HTTP request)
   - Disk usage report

5. **`logs [--tail 50]`** - Show server logs
   - Tails `logs/run/sovits.log`

6. **`download-models`** - Download pretrained models
   - ~2GB of HuggingFace models
   - Skips already downloaded files

7. **`test [text]`** - Test server
   - Sends TTS request to server
   - Reports audio size and response time

8. **`uninstall`** - Remove installation
   - Stops server if running
   - Deletes `external/gpt-sovits/` directory

### 5.2 Installation Script

**`bin/install-sovits.sh`** - Automated installation

**Steps:**

1. Check Python version (≥3.9 required)
2. Check CUDA availability (optional, GPU recommended)
3. Clone GPT-SoVITS repository
4. Create Python virtual environment
5. Install dependencies from `requirements.txt`
6. Download pretrained models via CLI command

**Key Features:**

- Idempotent (safe to re-run)
- GPU detection (falls back to CPU)
- Multi-version Python detection (`python3.11`, `python3.10`, etc.)
- Detailed progress logging

---

## 6. Security & User Isolation

### 6.1 Path Resolution Security

**Critical Security Mechanism**: The `paths` proxy in `packages/core/src/paths.ts` enforces strict access control:

```typescript
export const paths = new Proxy({}, {
  get(target, prop: string) {
    const context = getUserContext();

    // SECURITY: Block anonymous users from accessing user data paths
    if (context && context.username === 'anonymous' && !context.activeProfile) {
      throw new Error(
        `Access denied: Anonymous users cannot access user data paths. ` +
        `Attempted to access: paths.${prop}`
      );
    }

    // Return user-specific paths if authenticated
    if (context && (context.username !== 'anonymous' || context.activeProfile)) {
      return context.profilePaths[prop];
    }

    // Fallback to root paths (CLI operations only)
    return rootPaths[prop];
  }
});
```

**Security Guarantees:**

1. **Authenticated users**: Always get `profiles/{username}/` paths
2. **Anonymous users**: **Cannot** access user data (throws error)
3. **Guest mode**: Can access selected public profile (if `activeProfile` set)
4. **CLI operations**: Use root paths (no user context)

### 6.2 User Context Flow

**Request → User Context → Path Resolution → File Access**

```typescript
// 1. Web request arrives with session cookie
const sessionCookie = cookies.get('mh_session');
const session = getSession(sessionCookie.value);
const user = getUser(session.userId);

// 2. User context is set (via middleware or manual call)
await withUserContext({
  userId: user.id,
  username: user.username,
  role: user.role
}, async () => {

  // 3. All paths automatically resolve to user's profile
  const voiceConfig = paths.voiceConfig;  // profiles/alice/etc/voice.json
  const trainingDir = paths.voiceTraining;  // profiles/alice/out/voice-training/

  // 4. File operations are isolated to user's directory
  const samples = listVoiceSamples();  // Only reads alice's samples
});
```

### 6.3 File Access Validation

**No Direct File Path Input**: All file operations go through `paths` proxy

❌ **Insecure** (direct path):
```typescript
const userFile = `/home/greggles/metahuman/profiles/${username}/etc/voice.json`;
```

✅ **Secure** (via paths proxy):
```typescript
const userFile = paths.voiceConfig;  // Automatically resolves to current user
```

---

## 7. Proposed RVC Integration

### 7.1 Architecture Pattern (Following GPT-SoVITS Model)

To add RVC support, follow the same architectural patterns as GPT-SoVITS:

**Step 1**: Create RVC service provider

```typescript
// packages/core/src/tts/providers/rvc-service.ts
export class RVCService implements ITextToSpeechService {
  constructor(
    private config: RVCConfig,
    private cacheConfig: CacheConfig,
    private fallbackService?: ITextToSpeechService
  ) {}

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
    // 1. Generate base audio with Piper
    const baseAudio = await this.fallbackService.synthesize(text, options);

    // 2. Apply RVC voice conversion
    const convertedAudio = await this._convertWithRVC(baseAudio);

    return convertedAudio;
  }

  private async _convertWithRVC(inputAudio: Buffer): Promise<Buffer> {
    // Call RVC inference endpoint
    const response = await fetch(`${this.config.serverUrl}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: inputAudio
    });

    return Buffer.from(await response.arrayBuffer());
  }
}
```

**Step 2**: Add RVC configuration to `voice.json`

```json
{
  "tts": {
    "provider": "rvc",
    "rvc": {
      "serverUrl": "http://127.0.0.1:8765",
      "referenceAudioDir": "{PROFILE_DIR}/out/voices/rvc",
      "modelPath": "{PROFILE_DIR}/out/voices/rvc/models/default.pth",
      "indexPath": "{PROFILE_DIR}/out/voices/rvc/models/default.index",
      "pitchShift": 0,
      "autoFallbackToPiper": true
    }
  }
}
```

**Step 3**: Create installation script

```bash
# bin/install-rvc.sh
git clone https://github.com/Applio-RVC/Applio.git external/applio-rvc
cd external/applio-rvc
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

**Step 4**: Add CLI commands

```typescript
// packages/cli/src/commands/rvc.ts
export async function rvcCommand(args: string[]): Promise<void> {
  switch (args[0]) {
    case 'install': await installRVC(); break;
    case 'start': await startServer(); break;
    case 'stop': await stopServer(); break;
    case 'train': await trainVoice(args.slice(1)); break;
    // ...
  }
}
```

**Step 5**: Add UI components

- `RVCSettings.svelte` - Model selection, pitch shift, training controls
- `RVCTrainingWidget.svelte` - Dataset upload, training monitor
- Update `VoiceSettings.svelte` provider toggle to include RVC

### 7.2 RVC vs GPT-SoVITS Comparison

| Feature | GPT-SoVITS | RVC |
|---------|-----------|-----|
| **Training Required** | No (few-shot) | Yes (LoRA fine-tuning) |
| **Reference Audio** | 5-10 seconds | 10-15 minutes |
| **Quality** | Very high | Excellent (with training) |
| **Speed** | ~2-5 seconds | ~1-3 seconds |
| **VRAM** | 12GB+ | 6GB+ |
| **Use Case** | Quick cloning | High-fidelity custom voices |

**Recommendation**: Keep GPT-SoVITS as primary, add RVC as optional high-quality alternative for power users willing to train models.

---

## 8. System Dependencies & Installation

### 8.1 External Dependencies

**Required System Tools:**

- **Python 3.9+** - For GPT-SoVITS/RVC inference
- **ffmpeg** - Audio format conversion
- **git** - Repository cloning
- **curl** - Model downloads
- **Node.js/pnpm** - MetaHuman OS build system

**Optional (GPU Acceleration):**

- **CUDA 11.8+** - NVIDIA GPU support
- **nvidia-smi** - GPU monitoring

### 8.2 Python Virtual Environments

**Structure:**

```
metahuman/
├── external/
│   ├── gpt-sovits/
│   │   └── venv/                # Isolated Python environment
│   │       ├── bin/python3
│   │       └── lib/python3.11/site-packages/
│   └── applio-rvc/
│       └── venv/                # Separate RVC environment
```

**Benefits:**

1. **Isolation** - Dependencies don't conflict with system Python
2. **Reproducibility** - Exact package versions pinned
3. **Clean Uninstall** - Delete `external/{provider}/` to remove completely

### 8.3 Disk Space Requirements

| Component | Size |
|-----------|------|
| GPT-SoVITS Base Models | ~2GB |
| GPT-SoVITS Code + Venv | ~500MB |
| RVC Base Models | ~1GB |
| RVC Code + Venv | ~300MB |
| User Voice Profiles (per user) | ~50-200MB |

**Total**: ~4-5GB for full installation

---

## 9. Performance & Optimization

### 9.1 TTS Cache System

**`packages/core/src/tts/cache.ts`** - Audio caching

```typescript
export function getCachedAudio(
  config: CacheConfig,
  text: string,
  cacheKey: string,
  speed: number
): Buffer | null {
  const hash = crypto.createHash('sha256')
    .update(`${text}:${cacheKey}:${speed}`)
    .digest('hex');

  const cachePath = path.join(config.directory, `${hash}.wav`);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }
  return null;
}
```

**Cache Strategy:**

- **Key**: SHA-256 hash of `text:provider:voice:speed`
- **Format**: WAV files (22.05kHz, mono)
- **Eviction**: LRU with configurable max size (500MB default)
- **Invalidation**: Clear cache when reference audio changes

### 9.2 Request Deduplication

**Problem**: Multiple concurrent requests for same text waste GPU resources

**Solution**: In-memory request deduplication in `SoVITSService`:

```typescript
private activeRequests = new Map<string, Promise<Buffer>>();

async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
  const requestKey = `${text}:${speakerId}:${temperature}:${speed}`;

  // Check if already processing
  const existing = this.activeRequests.get(requestKey);
  if (existing) return existing;  // Return same promise

  // Start new request
  const promise = this._synthesizeInternal(...);
  this.activeRequests.set(requestKey, promise);

  try {
    return await promise;
  } finally {
    this.activeRequests.delete(requestKey);
  }
}
```

### 9.3 Sample Rate Normalization

**Problem**: Different TTS engines output different sample rates

**Solution**: Normalize all audio to 22.05kHz (Piper standard):

```typescript
private async _normalizeSampleRate(audioBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputFile,
      '-ar', '22050',  // Resample to 22.05kHz
      '-ac', '1',      // Convert to mono
      '-y', outputFile
    ]);

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(fs.readFileSync(outputFile));
      else reject(new Error('Normalization failed'));
    });
  });
}
```

---

## 10. Monitoring & Observability

### 10.1 Audit Logging

All TTS operations are logged via `packages/core/src/audit.ts`:

```typescript
audit({
  level: 'info',
  category: 'action',
  event: 'tts_generated',
  details: {
    provider: 'gpt-sovits',
    textLength: text.length,
    audioSize: audioBuffer.length,
    durationMs: Date.now() - startTime,
    speakerId,
    username,
  },
  actor: username,
});
```

**Logged Events:**

- `tts_generated` - Successful synthesis
- `tts_failed` - Synthesis error
- `tts_fallback_to_piper` - Provider fallback triggered
- `voice_sample_saved` - Training sample recorded
- `sovits_reference_copy` - Reference audio updated
- `sovits_server_started` - Server lifecycle event

### 10.2 Server Health Monitoring

**Endpoint**: `GET /api/sovits-server`

**Response**:

```json
{
  "running": true,
  "installed": true,
  "pid": 12345,
  "port": 9880,
  "serverUrl": "http://127.0.0.1:9880",
  "healthy": true
}
```

**UI Integration**: `ServerStatusIndicator.svelte` component polls this endpoint every 15 seconds.

### 10.3 Training Progress Tracking

**`VoiceTrainingWidget.svelte`** displays real-time metrics:

- **Samples Collected**: Count of recorded voice samples
- **Total Duration**: Sum of all sample durations
- **Target Duration**: Minimum duration for training readiness
- **Average Quality**: Mean quality score (0.0-1.0)
- **Ready for Training**: Boolean based on thresholds

---

## 11. Error Handling & Fallback

### 11.1 Provider Fallback Chain

```
GPT-SoVITS → Piper (fast fallback) → Error
RVC → Piper (fast fallback) → Error
Piper → Error (no fallback)
```

**Fallback Triggers:**

1. **Server unavailable** - HTTP connection timeout
2. **No reference audio** - Missing voice profile
3. **Synthesis timeout** - Request exceeds 30 seconds
4. **GPU memory error** - CUDA out of memory

**Implementation**:

```typescript
if (this.config.autoFallbackToPiper && this.fallbackService) {
  audit({
    level: 'info',
    event: 'tts_fallback_to_piper',
    details: { reason: error.message }
  });
  return this.fallbackService.synthesize(text, options);
}
```

### 11.2 Graceful Degradation

**Scenario 1**: GPT-SoVITS server not running

- ✅ UI shows "Server not running" status
- ✅ "Start Server" button enabled
- ✅ TTS requests auto-fallback to Piper (if enabled)
- ✅ User notified via toast message

**Scenario 2**: No reference audio configured

- ✅ UI shows "No reference audio" warning
- ✅ Training widget suggests "Select Samples" workflow
- ✅ TTS falls back to Piper
- ✅ Voice settings tab highlights reference audio section

### 11.3 Error Messages

**User-Facing Error Messages**:

- ❌ "GPT-SoVITS server not available at http://127.0.0.1:9880"
  - **Action**: Start server via Voice Settings

- ❌ "No reference audio found for speaker: default"
  - **Action**: Upload samples and copy to reference

- ❌ "GPT-SoVITS not installed. Please install it from the Addons tab first."
  - **Action**: Run `mh sovits install` or use System tab installer

---

## 12. Testing & Validation

### 12.1 Manual Testing Checklist

**TTS Generation:**

- [ ] Piper synthesis works
- [ ] GPT-SoVITS synthesis works (with reference audio)
- [ ] Fallback to Piper triggers correctly
- [ ] Cache hit returns identical audio
- [ ] Multi-user isolation (alice vs bob voice profiles)

**Voice Training:**

- [ ] Sample recording saves to correct user directory
- [ ] Quality filtering rejects low-quality samples
- [ ] Reference audio copy creates concatenated file
- [ ] Auto-export selects best quality samples

**Server Management:**

- [ ] Server starts successfully
- [ ] Server stops gracefully
- [ ] PID file cleanup on crash
- [ ] Health check detects server state

**UI Workflows:**

- [ ] Provider toggle saves to voice.json
- [ ] Server status indicator updates in real-time
- [ ] Training widget shows correct progress
- [ ] Sample selector allows multi-selection

### 12.2 CLI Testing

```bash
# Installation
mh sovits install

# Server lifecycle
mh sovits start
mh sovits status
mh sovits logs --tail 100
mh sovits test "Hello world"
mh sovits stop

# Cleanup
mh sovits uninstall
```

### 12.3 API Testing

```bash
# Health check
curl http://localhost:4321/api/sovits-server

# TTS synthesis
curl -X POST http://localhost:4321/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "provider": "gpt-sovits"}' \
  --output test.wav

# Training readiness
curl "http://localhost:4321/api/sovits-training?action=training-readiness&provider=gpt-sovits"
```

---

## 13. Future Enhancements

### 13.1 Planned Features

1. **Real-time Voice Conversion**
   - WebSocket streaming for low-latency TTS
   - Chunked audio synthesis for long texts

2. **Voice Profile Marketplace**
   - Share voice profiles between users
   - Import/export voice models as `.zip` files

3. **Advanced Training Controls**
   - Custom LoRA training parameters (RVC)
   - Training progress visualization
   - Dataset quality analysis tools

4. **Multi-language Support**
   - Automatic language detection
   - Per-language voice profiles
   - Cross-lingual voice cloning

### 13.2 Performance Optimizations

1. **Model Preloading**
   - Keep GPT-SoVITS models in VRAM
   - Reduce first-request latency from 10s to 2s

2. **Distributed Inference**
   - Load balance TTS requests across multiple GPUs
   - Remote TTS server support (external API endpoints)

3. **Progressive Audio Streaming**
   - Stream audio chunks as they're generated
   - Reduce time-to-first-audio

---

## Conclusion

The MetaHuman OS voice system **already has a robust, production-ready architecture** for multi-provider TTS with strict user isolation. The system successfully implements:

✅ **Modular provider architecture** (Piper + GPT-SoVITS, extensible to RVC)
✅ **User profile isolation** (all voice data in `profiles/{username}/`)
✅ **In-app installation workflows** (CLI + bash scripts)
✅ **Server lifecycle management** (start/stop/status/logs)
✅ **Voice training & reference audio** (few-shot cloning for GPT-SoVITS)
✅ **Comprehensive UI** (settings, training, sample selection)
✅ **Security & access control** (context-aware path resolution)

**No major architectural changes are needed.** Future enhancements (RVC, real-time streaming, marketplace) can be added incrementally following the established patterns.

---

**Document Status**: ✅ Complete
**Review Date**: 2025-11-12
**Next Steps**: Share with development team for feedback and prioritization
