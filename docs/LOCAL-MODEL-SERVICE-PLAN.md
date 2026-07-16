# Plan: Lightweight Embedding Service for Mobile & Desktop

## Problem Statement

MetaHuman OS currently uses Ollama for semantic search embeddings. This works on desktop/server but **not on mobile devices** because Ollama doesn't run on mobile.

Need a **universal embedding solution** that:
- Works on both web servers and mobile devices
- Integrates with the existing provider bridge architecture
- Downloads models on first use (WiFi-only option)
- Can be swapped/configured via UI
- Supports dual-loading: embeddings + small LLM simultaneously

## Default Models

| Purpose | Model | Size | Dimensions |
|---------|-------|------|------------|
| **Embeddings** | [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) | 560MB | 1024 |
| **Small LLM** | qwen3:1.7b | ~1.2GB | - |

Qwen3 Embedding is the state-of-the-art model (June 2025), #1 on MTEB multilingual leaderboard.
ONNX version available: [zhiqing/Qwen3-Embedding-0.6B-ONNX](https://huggingface.co/zhiqing/Qwen3-Embedding-0.6B-ONNX)

---

## Recommended Architecture: Dedicated Embedding Service

### Overview

Create a **standalone embedding server** that:
1. Runs as a separate process alongside the main MetaHuman server
2. Exposes HTTP API for embeddings (same pattern as Ollama)
3. Integrates with provider bridge as new provider type: `local-embeddings`
4. Uses Transformers.js + ONNX for lightweight inference
5. Downloads models on first use to `profiles/{user}/models/`

```
┌─────────────────────────────────────────────────────────────┐
│                    MetaHuman OS                              │
├──────────────────────┬──────────────────────────────────────┤
│   Main Server        │   Local Model Service (NEW)          │
│   (Port 4321/4322)   │   (Port 4324)                        │
│                      │                                      │
│   ┌──────────────┐   │   ┌────────────────────────────────┐ │
│   │Provider      │───────│ /embeddings endpoint           │ │
│   │Bridge        │   │   │ /generate endpoint             │ │
│   │              │   │   │                                │ │
│   │local-models──│───────│ Transformers.js + ONNX         │ │
│   │provider      │   │   │ Qwen3-Embedding-0.6B (560MB)   │ │
│   └──────────────┘   │   │ qwen3:1.7b (1.2GB)             │ │
│                      │   │                                │ │
│                      │   │ Download via UI (WiFi-only)    │ │
│                      │   └────────────────────────────────┘ │
└──────────────────────┴──────────────────────────────────────┘
```

### Why This Architecture?

1. **Isolation**: Model inference doesn't block main server
2. **Dual-Loading**: Embeddings + small LLM simultaneously
3. **Provider Bridge Compatible**: Same interface as Ollama, easy integration
4. **Model Flexibility**: Swap models via Settings UI
5. **Mobile-First**: Works on both desktop and mobile devices

---

## Implementation Plan

### Phase 1: Embedding Service Core (Desktop/Server)

#### 1.1 Create Service Directory Structure
```
packages/embedding-service/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # Entry point, HTTP server
│   ├── embeddings.ts      # Transformers.js wrapper
│   ├── model-manager.ts   # Download & cache models
│   └── config.ts          # Configuration types
└── models/                # Downloaded models (gitignored)
```

#### 1.2 Package Dependencies
```json
{
  "name": "@metahuman/embedding-service",
  "dependencies": {
    "@huggingface/transformers": "^3.0.0",
    "fastify": "^4.0.0"
  }
}
```

**Note**: Requires the MetaHuman OS Node.js 22 runtime (for Transformers.js ESM support)

#### 1.3 Core API Design

**Endpoint**: `POST /embeddings`
```typescript
// Request
{
  "text": string | string[],
  "model": string  // e.g., "all-MiniLM-L6-v2"
}

// Response
{
  "embeddings": number[][],
  "model": string,
  "dimensions": number
}
```

**Endpoint**: `GET /models`
```typescript
// Response - list available/downloaded models
{
  "models": [
    { "id": "all-MiniLM-L6-v2", "size": "23MB", "downloaded": true },
    { "id": "nomic-embed-text-v1", "size": "45MB", "downloaded": false }
  ]
}
```

**Endpoint**: `POST /models/download`
```typescript
// Request
{ "model": "all-MiniLM-L6-v2" }

// Response (streaming progress)
{ "status": "downloading", "progress": 0.45 }
{ "status": "complete" }
```

#### 1.4 Model Manager Implementation

```typescript
// packages/embedding-service/src/model-manager.ts

import { pipeline, env } from '@huggingface/transformers';

// Configure cache directory
env.cacheDir = path.join(profilePaths.root, 'models', 'transformers');
env.allowLocalModels = true;

// Supported embedding models
const EMBEDDING_MODELS = {
  'qwen3-embedding-0.6b': {
    hfId: 'zhiqing/Qwen3-Embedding-0.6B-ONNX',
    dimensions: 1024,
    size: '560MB'
  },
  'qwen3-embedding-4b': {
    hfId: 'zhiqing/Qwen3-Embedding-4B-ONNX',
    dimensions: 1024,
    size: '2.5GB'
  },
  'all-MiniLM-L6-v2': {  // Fallback for low-memory devices
    hfId: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    size: '23MB'
  }
};

// Supported small LLMs
const LLM_MODELS = {
  'qwen3-1.7b': {
    hfId: 'Xenova/Qwen2.5-1.5B-Instruct',  // ONNX version
    size: '1.2GB'
  },
  'qwen2-0.5b': {
    hfId: 'Xenova/Qwen2-0.5B-Instruct',
    size: '400MB'
  },
  'tinyllama': {
    hfId: 'Xenova/TinyLlama-1.1B-Chat-v1.0',
    size: '600MB'
  }
};

class ModelManager {
  private embedder: Pipeline | null = null;
  private generator: Pipeline | null = null;

  async loadEmbedder(modelId: string): Promise<void> {
    const config = EMBEDDING_MODELS[modelId];
    if (!config) throw new Error(`Unknown embedding model: ${modelId}`);

    this.embedder = await pipeline('feature-extraction', config.hfId);
  }

  async loadGenerator(modelId: string): Promise<void> {
    const config = LLM_MODELS[modelId];
    if (!config) throw new Error(`Unknown LLM model: ${modelId}`);

    this.generator = await pipeline('text-generation', config.hfId);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.embedder) throw new Error('No embedding model loaded');
    const output = await this.embedder(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }

  async generate(prompt: string, options: GenerateOptions): Promise<string> {
    if (!this.generator) throw new Error('No LLM model loaded');
    const output = await this.generator(prompt, options);
    return output[0].generated_text;
  }
}
```

### Phase 2: Provider Bridge Integration

#### 2.1 Add New Provider Type

**File**: `packages/core/src/providers/types.ts`
```typescript
// Add to ProviderType union
type ProviderType = 'ollama' | 'vllm' | 'mock' | 'local-embeddings' | ...;
```

#### 2.2 Create Local Models Provider

**File**: `packages/core/src/providers/local-models.ts`
```typescript
const DEFAULT_PORT = 4324;

// Embeddings
export async function embedWithLocalService(
  text: string,
  options: { model?: string; endpoint?: string } = {}
): Promise<number[]> {
  const endpoint = options.endpoint || `http://127.0.0.1:${DEFAULT_PORT}`;
  const model = options.model || 'qwen3-embedding-0.6b';

  const response = await fetch(`${endpoint}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model })
  });

  if (!response.ok) throw new Error(`Local model service error: ${response.statusText}`);
  return (await response.json()).embeddings[0];
}

// Text Generation
export async function generateWithLocalService(
  messages: ProviderMessage[],
  options: { model?: string; endpoint?: string; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const endpoint = options.endpoint || `http://127.0.0.1:${DEFAULT_PORT}`;
  const model = options.model || 'qwen3-1.7b';

  const response = await fetch(`${endpoint}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model, ...options })
  });

  if (!response.ok) throw new Error(`Local model service error: ${response.statusText}`);
  return (await response.json()).text;
}

// Health check
export async function isLocalModelServiceRunning(
  endpoint = `http://127.0.0.1:${DEFAULT_PORT}`
): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}
```

#### 2.3 Update embeddings.ts

**File**: `packages/core/src/embeddings.ts`
```typescript
// Add to provider routing
export async function embedText(
  text: string,
  opts: { provider?: EmbeddingProvider; model?: string } = {}
): Promise<number[]> {
  const config = await loadEmbeddingsConfig();
  const provider = opts.provider || config.provider;

  switch (provider) {
    case 'ollama':
      return embedWithOllama(text, opts);

    case 'local-embeddings':  // NEW
      return embedWithLocalService(text, {
        model: opts.model || config.localEmbeddings?.model,
        endpoint: config.localEmbeddings?.endpoint
      });

    case 'mock':
      return mockEmbed(text);

    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}
```

#### 2.4 Update Configuration Schema

**File**: `etc/local-models.json` (NEW)
```json
{
  "enabled": true,
  "endpoint": "http://127.0.0.1:4324",
  "autoStart": true,
  "downloadOnWifiOnly": true,

  "embeddings": {
    "model": "qwen3-embedding-0.6b",
    "preloadAtStartup": true
  },

  "llm": {
    "model": "qwen3-1.7b",
    "preloadAtStartup": false
  },

  "availableModels": {
    "embeddings": [
      { "id": "qwen3-embedding-0.6b", "size": "560MB", "dimensions": 1024, "downloaded": false },
      { "id": "qwen3-embedding-4b", "size": "2.5GB", "dimensions": 1024, "downloaded": false },
      { "id": "all-MiniLM-L6-v2", "size": "23MB", "dimensions": 384, "downloaded": false }
    ],
    "llm": [
      { "id": "qwen3-1.7b", "size": "1.2GB", "downloaded": false },
      { "id": "qwen2-0.5b", "size": "400MB", "downloaded": false },
      { "id": "tinyllama", "size": "600MB", "downloaded": false }
    ]
  }
}
```

**File**: `etc/embeddings.json` (UPDATE)
```json
{
  "provider": "local-models",
  "model": "qwen3-embedding-0.6b",
  "cpuOnly": true,
  "preloadAtStartup": true,
  "localModels": {
    "endpoint": "http://127.0.0.1:4324"
  },
  "ollama": {
    "endpoint": "http://127.0.0.1:11434",
    "model": "nomic-embed-text"
  }
}
```

### Phase 3: Service Lifecycle Management

#### 3.1 Auto-Start Service

**File**: `packages/core/src/embedding-service-manager.ts`
```typescript
import { spawn, ChildProcess } from 'child_process';
import { systemPaths } from './paths.js';

let serviceProcess: ChildProcess | null = null;

export async function startEmbeddingService(): Promise<void> {
  if (await isLocalEmbeddingServiceRunning()) {
    console.log('[embedding-service] Already running');
    return;
  }

  const servicePath = path.join(systemPaths.root, 'packages/embedding-service');

  serviceProcess = spawn('node', ['dist/index.js'], {
    cwd: servicePath,
    stdio: 'pipe',
    env: { ...process.env, PORT: '4324' }
  });

  // Wait for ready
  await waitForService('http://127.0.0.1:4324/health', 30000);
}

export async function stopEmbeddingService(): Promise<void> {
  if (serviceProcess) {
    serviceProcess.kill();
    serviceProcess = null;
  }
}
```

#### 3.2 Integration with Main Server Startup

**Files to modify**:
- `apps/site/src/pages/api/boot.ts` - Start embedding service on boot
- `apps/react-native/nodejs-assets/nodejs-project/main.js` - Start on mobile boot

### Phase 4: Mobile Integration

The React Native app uses nodejs-mobile with Node.js 18, which fully supports Transformers.js and ESM.

#### 4.1 Mobile Startup Integration

**File**: `apps/react-native/nodejs-assets/nodejs-project/main.js`
```javascript
// Start local model service alongside main HTTP server
import { startLocalModelService } from './local-model-service.js';

// Start on port 4324 (same as desktop)
await startLocalModelService({ port: 4324 });
console.log('[local-models] Service started on port 4324');
```

#### 4.2 Build Process

```bash
# Build service for mobile (ESM bundle)
cd packages/embedding-service
pnpm run build

# Copy to mobile assets
cp -r dist/ apps/react-native/nodejs-assets/nodejs-project/local-model-service/
```

#### 4.3 Mobile-Specific Considerations

- **Storage**: Models cached in `rn_bridge.app.datadir()/models/`
- **WiFi-Only**: Respect `downloadOnWifiOnly` setting via `NetInfo.fetch()`
- **Memory**: Auto-detect device RAM, suggest appropriate model configuration
- **Background**: Service continues running when app is backgrounded

### Phase 5: Dual-Loading - Embeddings + Small LLM

The same service supports **simultaneous loading** of embedding model AND small LLM:

#### 5.1 Dual-Model Architecture

```typescript
// model-manager.ts - supports multiple loaded models
class ModelManager {
  private embedder: Pipeline | null = null;
  private generator: Pipeline | null = null;

  async loadEmbedder(model: string): Promise<void> {
    this.embedder = await pipeline('feature-extraction', model);
  }

  async loadGenerator(model: string): Promise<void> {
    this.generator = await pipeline('text-generation', model);
  }

  async embed(texts: string[]): Promise<number[][]> { ... }
  async generate(prompt: string, options: GenerateOptions): Promise<string> { ... }
}
```

#### 5.2 API Endpoints

**Embeddings**: `POST /embeddings` (unchanged)

**Text Generation**: `POST /generate`
```typescript
{
  "prompt": string,
  "model": "phi-3-mini" | "gemma-2b" | "tinyllama",
  "max_tokens": number,
  "temperature": number
}
```

**Model Status**: `GET /models/loaded`
```typescript
{
  "embedder": { "model": "all-MiniLM-L6-v2", "loaded": true },
  "generator": { "model": "phi-3-mini", "loaded": true }
}
```

#### 5.3 Memory Configurations for Mobile

| Configuration | Embedding Model | Small LLM | Total RAM | Target Devices |
|--------------|-----------------|-----------|-----------|----------------|
| **Embeddings Only** | Qwen3-Embedding-0.6B (560MB) | None | ~800MB | Budget phones (2GB) |
| **Lightweight** | MiniLM-L6 (23MB) | qwen2-0.5b (400MB) | ~600MB | Budget phones (2GB) |
| **Balanced** | Qwen3-Embedding-0.6B (560MB) | qwen3-1.7b (1.2GB) | ~2GB | Mid-range (4GB+) |
| **Quality** | Qwen3-Embedding-0.6B (560MB) | qwen3-1.7b (1.2GB) | ~2GB | High-end (6GB+) |

#### 5.4 Model Options

**Embedding Models:**
| Model | Disk Size | Dimensions | Quality |
|-------|-----------|------------|---------|
| Qwen3-Embedding-0.6B | 560MB | 1024 | Best (MTEB #1) |
| Qwen3-Embedding-4B | 2.5GB | 1024 | Premium |
| all-MiniLM-L6-v2 | 23MB | 384 | Good (legacy) |

**Small LLMs:**
| Model | Disk Size | RAM | Quality | Speed |
|-------|-----------|-----|---------|-------|
| qwen3-1.7b | 1.2GB | 1.5GB | Good | Medium |
| qwen2-0.5b | 400MB | 800MB | Basic | Fast |
| tinyllama | 600MB | 1GB | Basic | Fast |

#### 5.5 Provider Bridge Integration

Add `local-models` provider to existing provider bridge:

```typescript
// packages/core/src/providers/bridge.ts
case 'local-models':
  return callLocalModelService(messages, options);
```

Configuration in `etc/llm-backend.json`:
```json
{
  "activeBackend": "local-models",
  "localModels": {
    "endpoint": "http://127.0.0.1:4324",
    "embeddingModel": "qwen3-embedding-0.6b",
    "llmModel": "qwen3-1.7b",
    "autoStart": true
  }
}
```

### Phase 6: UI Model Management

Add model download/configuration to Settings page in the Backend section.

#### 6.1 New Settings Component

**File**: `apps/site/src/components/LocalModelsSettings.svelte`

```svelte
<script>
  let config = { embeddings: {}, llm: {}, downloadOnWifiOnly: true };
  let downloadProgress = {};

  async function downloadModel(type, modelId) {
    const response = await fetch('/api/local-models/download', {
      method: 'POST',
      body: JSON.stringify({ type, model: modelId })
    });
    // Stream progress updates...
  }
</script>

<div class="local-models-settings">
  <h3>Local Models</h3>

  <label>
    <input type="checkbox" bind:checked={config.downloadOnWifiOnly} />
    Download on WiFi only
  </label>

  <h4>Embedding Model</h4>
  <select bind:value={config.embeddings.model}>
    {#each availableEmbeddingModels as model}
      <option value={model.id}>
        {model.id} ({model.size}) {model.downloaded ? '✓' : ''}
      </option>
    {/each}
  </select>
  <button on:click={() => downloadModel('embeddings', config.embeddings.model)}>
    Download
  </button>

  <h4>Small LLM</h4>
  <select bind:value={config.llm.model}>
    {#each availableLLMModels as model}
      <option value={model.id}>
        {model.id} ({model.size}) {model.downloaded ? '✓' : ''}
      </option>
    {/each}
  </select>
  <button on:click={() => downloadModel('llm', config.llm.model)}>
    Download
  </button>
</div>
```

#### 6.2 API Endpoints for UI

**File**: `apps/site/src/pages/api/local-models/[...path].ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/local-models/config` | GET | Get current configuration |
| `/api/local-models/config` | POST | Update configuration |
| `/api/local-models/download` | POST | Start model download |
| `/api/local-models/status` | GET | Get service status & loaded models |
| `/api/local-models/models` | GET | List available models with download status |

#### 6.3 Download Progress Streaming

```typescript
// Stream download progress via SSE
export const GET: APIRoute = async ({ request }) => {
  const stream = new ReadableStream({
    async start(controller) {
      // Subscribe to download progress events
      modelManager.on('download-progress', (progress) => {
        controller.enqueue(`data: ${JSON.stringify(progress)}\n\n`);
      });
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
};
```

---

## Files to Create/Modify

### New Files
1. `packages/local-model-service/package.json`
2. `packages/local-model-service/src/index.ts` - HTTP server entry point
3. `packages/local-model-service/src/model-manager.ts` - Load/unload models
4. `packages/local-model-service/src/embeddings.ts` - Embedding inference
5. `packages/local-model-service/src/generation.ts` - LLM text generation
6. `packages/local-model-service/src/download.ts` - Model download with progress
7. `packages/core/src/providers/local-models.ts` - Provider bridge integration
8. `packages/core/src/local-model-service-manager.ts` - Service lifecycle
9. `etc/local-models.json` - Configuration file
10. `apps/site/src/components/LocalModelsSettings.svelte` - Settings UI
11. `apps/site/src/pages/api/local-models/config.ts` - Config API
12. `apps/site/src/pages/api/local-models/download.ts` - Download API
13. `apps/site/src/pages/api/local-models/status.ts` - Status API
14. `apps/site/src/pages/api/local-models/models.ts` - Models list API

### Files to Modify
1. `packages/core/src/embeddings.ts` - Add `local-models` provider
2. `packages/core/src/providers/types.ts` - Add provider type
3. `packages/core/src/providers/bridge.ts` - Add provider routing
4. `etc/embeddings.json` - Update default provider
5. `etc/llm-backend.json` - Add local-models backend option
6. `pnpm-workspace.yaml` - Add new package
7. `apps/site/src/components/BackendSettings.svelte` - Add Local Models section
8. `apps/react-native/nodejs-assets/nodejs-project/main.js` - Start service on mobile
9. `CLAUDE.md` - Remove deprecated Node.js 12 references

---

## Implementation Order

1. **Create local-model-service package** - Core service with Transformers.js + ONNX
2. **Implement model manager** - Download, load, unload models
3. **Add HTTP endpoints** - /embeddings, /generate, /health, /models
4. **Add provider bridge integration** - `local-models` provider
5. **Update configuration files** - local-models.json, embeddings.json
6. **Add service lifecycle manager** - Auto-start/stop
7. **Create Settings UI component** - Model selection, download, WiFi-only toggle
8. **Add API endpoints for UI** - Config, download progress, status
9. **Integrate with mobile** - Start service in main.js
10. **Test dual-loading** - Embeddings + LLM simultaneously
11. **Update documentation** - CLAUDE.md, remove Node.js 12 references

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Large model downloads (560MB+) | WiFi-only option, progress streaming, resume support |
| Memory pressure on mobile | Device RAM detection, suggest appropriate config |
| Service startup time | Background loading, preload setting |
| Port conflicts | Configurable port, auto-detect available port |
| Transformers.js compatibility | Use stable v3.x, test on both platforms |
| Model version drift | Pin specific model revisions in config |

---

## Success Criteria

1. Embeddings work on desktop without Ollama
2. Embeddings work on mobile (React Native)
3. Small LLM generation works on both platforms
4. Dual-loading (embeddings + LLM) works simultaneously
5. Models download via Settings UI with progress indicator
6. WiFi-only download option respected
7. Provider is swappable via configuration
8. Same code path for web and mobile
9. Integration with existing vector-index.ts
10. Service auto-starts on boot (configurable)

---

## Sources

- [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) - Default embedding model
- [Qwen3-Embedding-0.6B-ONNX](https://huggingface.co/zhiqing/Qwen3-Embedding-0.6B-ONNX) - ONNX version
- [Qwen3 Embedding Blog](https://qwenlm.github.io/blog/qwen3-embedding/) - Technical details
- [Transformers.js](https://huggingface.co/docs/transformers.js/en/tutorials/node) - Node.js inference
