# vLLM Integration Plan

## Goal

Add vLLM as a first-class LLM backend alongside Ollama, with:
- Full lifecycle management (start, stop, status, model loading)
- Seamless switching between Ollama and vLLM from the Settings UI
- Automatic detection and configuration
- Integration with the existing model registry and router

---

## Why vLLM?

| Feature | Ollama | vLLM |
|---------|--------|------|
| **Throughput** | Good | Excellent (PagedAttention) |
| **Batch inference** | Limited | Native support |
| **API compatibility** | Custom + OpenAI | OpenAI-compatible |
| **Model formats** | GGUF (quantized) | HuggingFace (full precision) |
| **Memory efficiency** | Good (quantization) | Excellent (paged attention) |
| **Streaming** | Yes | Yes |
| **Multi-GPU** | Limited | Native tensor parallelism |
| **Best for** | Local dev, small models | Production, large models |

**Use case**: vLLM excels when you have a powerful GPU and want maximum throughput, especially for larger models (30B+) or when serving multiple concurrent requests.

---

## Architecture: Two Separate Layers

**IMPORTANT**: There are TWO distinct layers in the LLM system:

1. **Local Backends** (`packages/core`) - Ollama, vLLM
   - Run on the user's local machine
   - Managed by `packages/core/src/ollama.ts` and `packages/core/src/vllm.ts`
   - User switches between these in Settings UI
   - For personal/development use

2. **Server Providers** (`packages/server`) - RunPod, HuggingFace
   - Cloud GPU services for production/scaling
   - Managed by `packages/server/src/provider-bridge.ts`
   - Used when deploying to server mode
   - Completely separate from local backend selection

**These two layers do NOT conflict** - they serve different purposes:
- Local backends: "Which engine runs LLMs on MY machine?"
- Server providers: "Which cloud service handles inference when deployed?"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LLM ARCHITECTURE                                   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ packages/core/src/model-router.ts                                        ││
│  │   callLLM({ role, messages }) → selects provider based on config         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                              │                                               │
│          ┌───────────────────┴───────────────────┐                          │
│          │                                       │                          │
│          ▼                                       ▼                          │
│  ┌───────────────────────────────────┐   ┌─────────────────────────────────┐│
│  │     LOCAL BACKENDS (packages/core) │   │  SERVER PROVIDERS (pkg/server)  ││
│  │     User's machine                 │   │  Cloud deployment               ││
│  │                                    │   │                                 ││
│  │  ┌──────────┐  ┌──────────┐       │   │  ┌─────────────────────────────┐││
│  │  │ Ollama   │  │ vLLM     │       │   │  │ provider-bridge.ts          │││
│  │  │ :11434   │  │ :8000    │       │   │  │  ├─ RunPodServerlessProvider│││
│  │  │ [GGUF]   │  │ [HF]     │       │   │  │  └─ HuggingFaceProvider     │││
│  │  └──────────┘  └──────────┘       │   │  └─────────────────────────────┘││
│  │       ↑                           │   │                                 ││
│  │       └── User toggles in         │   │  Used when etc/deployment.json  ││
│  │           Settings UI             │   │  mode = "server"                ││
│  └───────────────────────────────────┘   └─────────────────────────────────┘│
│                                                                              │
│  Configuration:                                                              │
│  ├─ etc/llm-backend.json  → Which LOCAL backend (ollama/vllm)               │
│  ├─ etc/models.json       → Model assignments per role                      │
│  └─ etc/deployment.json   → Local vs Server mode                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### When Each Is Used

| Scenario | Backend Used | Config |
|----------|--------------|--------|
| Local dev, personal use | Ollama or vLLM | `etc/llm-backend.json` |
| Server deployment | RunPod/HuggingFace | `etc/deployment.json` |
| Mobile app → local server | Ollama or vLLM | Via local server |
| Mobile app → cloud | RunPod | Via server mode |

---

## Settings UI Goal

User can switch between Ollama and vLLM from the Settings tab:

```
┌─────────────────────────────────────────────────────────────────┐
│ Settings → System → LLM Backend                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐   ┌─────────────────────┐              │
│  │  🦙 Ollama          │   │  ⚡ vLLM             │              │
│  │  ────────────────   │   │  ────────────────   │              │
│  │  Status: Running    │   │  Status: Stopped    │              │
│  │  Model: qwen3:14b   │   │  Model: (none)      │              │
│  │  Port: 11434        │   │  Port: 8000         │              │
│  │                     │   │                     │              │
│  │  [● ACTIVE]         │   │  [ Switch to vLLM ] │              │
│  └─────────────────────┘   └─────────────────────┘              │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  vLLM Configuration (when active):                               │
│  Model: [Qwen/Qwen2.5-14B-Instruct     ▼]                       │
│  GPU Memory: [═══════════●══] 90%                                │
│  [Apply & Restart Server]                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: VLLMClient Core (packages/core)

**Goal**: Create a vLLM client mirroring OllamaClient functionality.

**New file**: `packages/core/src/vllm.ts`

```typescript
/**
 * vLLM Client - Manages vLLM server lifecycle and API calls
 *
 * vLLM exposes an OpenAI-compatible API at /v1/chat/completions
 */

export interface VLLMConfig {
  endpoint: string;           // Default: http://localhost:8000
  model: string;              // HuggingFace model ID
  gpuMemoryUtilization: number; // 0.0-1.0, default 0.9
  maxModelLen?: number;       // Max context length
  tensorParallelSize?: number; // For multi-GPU
}

export interface VLLMModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export class VLLMClient {
  private endpoint: string;
  private config: VLLMConfig;

  constructor(endpoint = 'http://localhost:8000') {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  // ═══════════════════════════════════════════════════════════════
  // Server Lifecycle
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check if vLLM server is running
   */
  async isRunning(): Promise<boolean>;

  /**
   * Get server health and loaded models
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'unhealthy';
    model?: string;
    version?: string;
  }>;

  /**
   * Start vLLM server with specified model
   * Spawns: python -m vllm.entrypoints.openai.api_server --model <model>
   */
  async startServer(config: VLLMConfig): Promise<{ pid: number }>;

  /**
   * Stop vLLM server
   */
  async stopServer(): Promise<void>;

  /**
   * Get currently loaded model
   */
  async getLoadedModel(): Promise<string | null>;

  // ═══════════════════════════════════════════════════════════════
  // Model Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * List available models (from /v1/models)
   */
  async listModels(): Promise<VLLMModel[]>;

  /**
   * Switch to a different model (requires server restart)
   */
  async switchModel(modelId: string): Promise<void>;

  // ═══════════════════════════════════════════════════════════════
  // Inference
  // ═══════════════════════════════════════════════════════════════

  /**
   * Chat completion (OpenAI-compatible)
   */
  async chat(
    messages: Array<{ role: string; content: string }>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    }
  ): Promise<{
    content: string;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }>;

  /**
   * Streaming chat completion
   */
  async chatStream(
    messages: Array<{ role: string; content: string }>,
    onToken: (token: string) => void,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<void>;

  /**
   * Text embeddings (if model supports)
   */
  async embeddings(text: string): Promise<number[]>;
}

// Singleton instance
export const vllm = new VLLMClient();
```

**Key differences from Ollama**:
- vLLM loads ONE model at a time (no hot-swapping)
- Server must restart to change models
- Uses OpenAI-compatible API format
- Process management needed (spawn/kill)

---

### Phase 2: VLLMProvider for LLM Manager

**Goal**: Add vLLM as a provider in the LLM abstraction layer.

**Modified file**: `packages/core/src/llm.ts`

```typescript
// Add alongside OllamaProvider

export class VLLMProvider implements LLMProvider {
  name = 'vllm';
  private client: VLLMClient;

  constructor(endpoint = 'http://localhost:8000') {
    this.client = new VLLMClient(endpoint);
  }

  async generate(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const response = await this.client.chat(
      messages.map(m => ({ role: m.role, content: m.content })),
      {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }
    );

    return {
      content: response.content,
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }

  async generateJSON<T>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
    // Add JSON instruction
    const jsonMessages = [...messages];
    // ... similar to OllamaProvider
  }
}

// In LLMManager constructor
export class LLMManager {
  constructor() {
    this.registerProvider('ollama', new OllamaProvider());
    this.registerProvider('vllm', new VLLMProvider());  // [NEW]
    this.registerProvider('openai', new OpenAIProvider());
    // ...
  }
}
```

---

### Phase 3: Backend Configuration

**Goal**: Centralized config for switching between Ollama and vLLM.

**New file**: `etc/llm-backend.json`

```json
{
  "$schema": "https://metahuman.dev/schemas/llm-backend.json",
  "version": "1.0.0",
  "description": "LLM backend configuration - controls which inference engine is used",

  "activeBackend": "ollama",

  "ollama": {
    "endpoint": "http://localhost:11434",
    "autoStart": false,
    "defaultModel": "qwen3:14b"
  },

  "vllm": {
    "endpoint": "http://localhost:8000",
    "autoStart": false,
    "model": "Qwen/Qwen2.5-14B-Instruct",
    "gpuMemoryUtilization": 0.9,
    "maxModelLen": 8192,
    "tensorParallelSize": 1,
    "dtype": "auto",
    "quantization": null
  }
}
```

**New file**: `packages/core/src/llm-backend.ts`

```typescript
export type BackendType = 'ollama' | 'vllm';

export interface BackendConfig {
  activeBackend: BackendType;
  ollama: OllamaBackendConfig;
  vllm: VLLMBackendConfig;
}

export interface BackendStatus {
  backend: BackendType;
  running: boolean;
  model?: string;
  endpoint: string;
  health: 'healthy' | 'degraded' | 'offline';
}

// Load config with caching
export function loadBackendConfig(): BackendConfig;

// Save config (triggers backend switch if activeBackend changed)
export function saveBackendConfig(config: Partial<BackendConfig>): Promise<void>;

// Get active backend status
export async function getBackendStatus(): Promise<BackendStatus>;

// Switch active backend (handles stopping old, starting new)
export async function switchBackend(to: BackendType): Promise<void>;

// Check which backends are available on this system
export async function detectAvailableBackends(): Promise<{
  ollama: { installed: boolean; running: boolean };
  vllm: { installed: boolean; running: boolean };
}>;
```

---

### Phase 4: CLI Commands

**Goal**: Add `mh vllm` commands mirroring `mh ollama`.

**New commands in** `packages/cli/src/mh-new.ts`:

```
mh vllm status          Check vLLM server status
mh vllm start [model]   Start vLLM with model
mh vllm stop            Stop vLLM server
mh vllm models          List available models on HuggingFace
mh vllm switch <model>  Switch to different model (restarts server)
mh vllm doctor          Diagnose vLLM setup

mh backend status       Show active backend (ollama/vllm)
mh backend switch       Switch between backends
mh backend auto         Auto-detect best backend
```

**Example usage**:
```bash
# Start vLLM with a model
./bin/mh vllm start Qwen/Qwen2.5-14B-Instruct

# Check status
./bin/mh vllm status
# Output:
# vLLM Status: Running
# Endpoint: http://localhost:8000
# Model: Qwen/Qwen2.5-14B-Instruct
# GPU Memory: 12.4GB / 24GB (52%)

# Switch active backend
./bin/mh backend switch vllm
# Output:
# Switching backend from ollama to vllm...
# Stopping Ollama...
# Starting vLLM with Qwen/Qwen2.5-14B-Instruct...
# Backend switched to vllm
```

---

### Phase 5: Settings UI

**Goal**: Backend selection and management in web UI.

**New file**: `apps/site/src/components/BackendSettings.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  interface BackendStatus {
    backend: 'ollama' | 'vllm';
    running: boolean;
    model?: string;
    health: 'healthy' | 'degraded' | 'offline';
  }

  let activeBackend: 'ollama' | 'vllm' = 'ollama';
  let ollamaStatus: BackendStatus;
  let vllmStatus: BackendStatus;
  let switching = false;

  async function switchTo(backend: 'ollama' | 'vllm') {
    if (switching) return;
    switching = true;

    try {
      await fetch('/api/llm-backend/switch', {
        method: 'POST',
        body: JSON.stringify({ backend })
      });
      activeBackend = backend;
      await refreshStatus();
    } finally {
      switching = false;
    }
  }
</script>

<div class="backend-settings">
  <h3>LLM Backend</h3>

  <div class="backend-cards">
    <!-- Ollama Card -->
    <div class="backend-card" class:active={activeBackend === 'ollama'}>
      <div class="backend-header">
        <span class="backend-name">🦙 Ollama</span>
        <span class="status-dot" class:running={ollamaStatus?.running}></span>
      </div>
      <div class="backend-info">
        <p>Local inference with GGUF models</p>
        <p class="model">Model: {ollamaStatus?.model || 'None'}</p>
      </div>
      <button
        on:click={() => switchTo('ollama')}
        disabled={activeBackend === 'ollama' || switching}
      >
        {activeBackend === 'ollama' ? 'Active' : 'Switch to Ollama'}
      </button>
    </div>

    <!-- vLLM Card -->
    <div class="backend-card" class:active={activeBackend === 'vllm'}>
      <div class="backend-header">
        <span class="backend-name">⚡ vLLM</span>
        <span class="status-dot" class:running={vllmStatus?.running}></span>
      </div>
      <div class="backend-info">
        <p>High-throughput inference</p>
        <p class="model">Model: {vllmStatus?.model || 'None'}</p>
      </div>
      <button
        on:click={() => switchTo('vllm')}
        disabled={activeBackend === 'vllm' || switching}
      >
        {activeBackend === 'vllm' ? 'Active' : 'Switch to vLLM'}
      </button>
    </div>
  </div>

  <!-- vLLM Configuration (when active) -->
  {#if activeBackend === 'vllm'}
    <div class="vllm-config">
      <h4>vLLM Configuration</h4>
      <label>
        Model:
        <input bind:value={vllmModel} placeholder="Qwen/Qwen2.5-14B-Instruct" />
      </label>
      <label>
        GPU Memory Utilization:
        <input type="range" min="0.5" max="0.95" step="0.05" bind:value={gpuUtil} />
        <span>{gpuUtil * 100}%</span>
      </label>
      <button on:click={applyVLLMConfig}>Apply & Restart</button>
    </div>
  {/if}
</div>
```

**Integration in SystemSettings.svelte**:
- Add BackendSettings as a new section
- Show current backend status in header
- Link to backend switching

---

### Phase 6: API Endpoints

**Goal**: REST API for backend management.

**New files**:

`apps/site/src/pages/api/llm-backend/status.ts`:
```typescript
export const GET: APIRoute = async ({ cookies }) => {
  const status = await getBackendStatus();
  const available = await detectAvailableBackends();

  return new Response(JSON.stringify({
    active: status,
    available,
  }));
};
```

`apps/site/src/pages/api/llm-backend/switch.ts`:
```typescript
export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);
  const { backend } = await request.json();

  await switchBackend(backend);

  audit({
    event: 'backend_switch',
    actor: user.username,
    details: { from: currentBackend, to: backend }
  });

  return new Response(JSON.stringify({ success: true }));
};

export const POST = requireOwner(handler);
```

`apps/site/src/pages/api/llm-backend/vllm/start.ts`:
`apps/site/src/pages/api/llm-backend/vllm/stop.ts`:
`apps/site/src/pages/api/llm-backend/vllm/config.ts`:

---

### Phase 7: Model Registry Integration

**Goal**: Allow models.json to specify vllm as provider.

**Updated `etc/models.json` schema**:

```json
{
  "models": {
    "default.persona": {
      "provider": "ollama",
      "model": "qwen3:14b",
      ...
    },
    "high-throughput.persona": {
      "provider": "vllm",
      "model": "Qwen/Qwen2.5-14B-Instruct",
      "options": {
        "temperature": 0.8,
        "maxTokens": 2048
      }
    }
  }
}
```

**Modified `packages/core/src/model-router.ts`**:
```typescript
async function callProvider(
  provider: string,
  messages: LLMMessage[],
  options: LLMOptions
): Promise<LLMResponse> {
  switch (provider) {
    case 'ollama':
      return llm.generate(messages, 'ollama', options);
    case 'vllm':
      return llm.generate(messages, 'vllm', options);  // [NEW]
    case 'openai':
      return llm.generate(messages, 'openai', options);
    // ...
  }
}
```

---

### Phase 8: Auto-Detection & Smart Switching

**Goal**: Automatically detect and use the best available backend.

**Logic**:
```typescript
export async function autoSelectBackend(): Promise<BackendType> {
  const available = await detectAvailableBackends();

  // If vLLM is running with a model, prefer it (higher throughput)
  if (available.vllm.running) {
    return 'vllm';
  }

  // If Ollama is running, use it
  if (available.ollama.running) {
    return 'ollama';
  }

  // Neither running - check which is installed
  if (available.vllm.installed) {
    return 'vllm';
  }

  if (available.ollama.installed) {
    return 'ollama';
  }

  throw new Error('No LLM backend available');
}
```

**Startup behavior** (configurable):
- `auto`: Detect and use best available
- `ollama`: Always use Ollama
- `vllm`: Always use vLLM
- `fallback`: Try primary, fall back to other

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `packages/core/src/vllm.ts` | vLLM client (API, lifecycle) |
| `packages/core/src/llm-backend.ts` | Backend switching logic |
| `etc/llm-backend.json` | Backend configuration |
| `apps/site/src/components/BackendSettings.svelte` | Settings UI |
| `apps/site/src/pages/api/llm-backend/*.ts` | API endpoints |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/llm.ts` | Add VLLMProvider |
| `packages/core/src/model-router.ts` | Support vllm provider |
| `packages/core/src/index.ts` | Export vllm client |
| `packages/cli/src/mh-new.ts` | Add vllm/backend commands |
| `apps/site/src/components/SystemSettings.svelte` | Add backend section |
| `etc/models.json` | Support provider: "vllm" |

---

## Implementation Order

```
Phase 1: VLLMClient Core                    [4-6 hours]
├── Create packages/core/src/vllm.ts
├── Implement isRunning(), getHealth()
├── Implement chat(), chatStream()
├── Implement startServer(), stopServer()
└── Add to packages/core/src/index.ts exports

Phase 2: VLLMProvider                       [2 hours]
├── Add VLLMProvider class to llm.ts
├── Register in LLMManager
└── Test basic generation

Phase 3: Backend Configuration              [3 hours]
├── Create etc/llm-backend.json schema
├── Create packages/core/src/llm-backend.ts
├── Implement switchBackend()
└── Implement detectAvailableBackends()

Phase 4: CLI Commands                       [3-4 hours]
├── Add mh vllm status/start/stop/models
├── Add mh backend status/switch
├── Add mh vllm doctor
└── Test all commands

Phase 5: Settings UI                        [4-6 hours]
├── Create BackendSettings.svelte
├── Integrate into SystemSettings
├── Add status indicators
└── Add vLLM configuration panel

Phase 6: API Endpoints                      [2-3 hours]
├── Create /api/llm-backend/* routes
├── Add authentication guards
├── Add audit logging
└── Test from UI

Phase 7: Model Registry Integration         [2 hours]
├── Update model-router.ts
├── Test provider: "vllm" in models.json
└── Document configuration

Phase 8: Auto-Detection & Polish            [2-3 hours]
├── Implement autoSelectBackend()
├── Add startup behavior config
├── Error handling & fallbacks
└── Documentation
```

**Total estimated time**: 22-31 hours

---

## Prerequisites

### vLLM Installation
```bash
# Install vLLM (requires CUDA)
pip install vllm

# Or with specific CUDA version
pip install vllm --extra-index-url https://download.pytorch.org/whl/cu121

# Verify installation
python -c "import vllm; print(vllm.__version__)"
```

### Hardware Requirements
- NVIDIA GPU with 16GB+ VRAM (for 14B models)
- CUDA 11.8+ or 12.x
- 32GB+ system RAM recommended

### Model Compatibility
| Model | VRAM Required | Notes |
|-------|---------------|-------|
| Qwen2.5-7B-Instruct | ~14GB | Good balance |
| Qwen2.5-14B-Instruct | ~28GB | Needs 2x GPU or quantization |
| Qwen2.5-32B-Instruct | ~64GB | Multi-GPU required |
| Llama-3.1-8B-Instruct | ~16GB | Popular alternative |

---

## Testing Strategy

### Unit Tests
- VLLMClient methods with mocked HTTP
- Backend switching logic
- Provider selection

### Integration Tests
- Start/stop vLLM server
- Chat completion E2E
- Backend switching E2E

### Manual Testing
1. Start vLLM from CLI
2. Switch backend in UI
3. Chat with vLLM backend
4. Switch back to Ollama
5. Verify model registry works with both

---

## Rollback Plan

If issues arise:
1. Set `activeBackend: "ollama"` in config
2. All existing functionality unchanged
3. vLLM code paths only activated when explicitly selected

---

## Questions to Resolve

1. **Process management**: Use PM2, systemd, or custom process spawning?
2. **GPU sharing**: Can Ollama and vLLM share GPU, or must one be stopped?
3. **Model storage**: Separate HuggingFace cache or shared with Ollama?
4. **Quantization**: Support AWQ/GPTQ in vLLM config?
5. **Multi-GPU**: Expose tensor parallelism in UI?

---

## Next Steps

Ready to begin implementation. Recommend starting with:
1. **Phase 1** (VLLMClient) - Core functionality
2. **Phase 3** (Backend Config) - Switching infrastructure
3. **Phase 4** (CLI) - Quick testing without UI
4. Then UI phases once backend is solid
