# Server Mode Implementation Plan

## Goal

Enable MetaHuman OS to run in two modes:
1. **Local Mode** (current): Single-user, local Ollama, all data on local machine
2. **Server Mode** (new): Multi-user, cloud GPU (RunPod serverless), persistent storage on RunPod Network Volume

Key requirement: Individual users who download the repo shouldn't need server infrastructure - the server components should be optional and cleanly separated.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        METAHUMAN OS                                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    packages/core                                 │   │
│  │  (Shared: paths, memory, auth, skills, policies, audit)         │   │
│  │  - LLMProvider interface (abstraction)                          │   │
│  │  - OllamaProvider (local)                                       │   │
│  │  - StorageClient (abstraction)                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│          ┌───────────────────┼───────────────────┐                     │
│          ▼                   ▼                   ▼                      │
│  ┌───────────────┐   ┌───────────────┐   ┌───────────────────────┐     │
│  │ packages/cli  │   │  apps/site    │   │  packages/server      │     │
│  │ (Local CLI)   │   │  (Web UI)     │   │  (NEW - Server Mode)  │     │
│  │               │   │               │   │                       │     │
│  │ Uses:         │   │ Uses:         │   │ Uses:                 │     │
│  │ - Ollama      │   │ - Core APIs   │   │ - RunPodProvider      │     │
│  │ - Local paths │   │ - Local/Server│   │ - NetworkVolumeStorage│     │
│  │               │   │   (config)    │   │ - Redis queue         │     │
│  └───────────────┘   └───────────────┘   └───────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: LLM Provider Abstraction Enhancement

**Goal**: Make LLM provider selection configuration-driven and add RunPod serverless support.

**Files to modify**:
- `packages/core/src/llm.ts` - Add RunPodServerlessProvider
- `etc/models.json` - Add provider configuration for runpod

**New provider interface**:
```typescript
// packages/core/src/providers/runpod.ts
export class RunPodServerlessProvider implements LLMProvider {
  name = 'runpod_serverless';
  private endpointId: string;
  private apiKey: string;

  constructor(config: { endpointId: string; apiKey: string }) {
    this.endpointId = config.endpointId;
    this.apiKey = config.apiKey;
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    // Call RunPod serverless endpoint
    const response = await fetch(
      `https://api.runpod.ai/v2/${this.endpointId}/runsync`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: { messages, ...options }
        }),
      }
    );
    // ... handle response
  }
}
```

**Configuration** (`etc/models.json` additions):
```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434"
    },
    "runpod_serverless": {
      "endpointId": "${RUNPOD_ENDPOINT_ID}",
      "apiKey": "${RUNPOD_API_KEY}"
    }
  },
  "deploymentMode": "local"  // or "server"
}
```

---

### Phase 2: Deployment Mode Configuration

**Goal**: Single config file determines local vs server mode.

**New file**: `etc/deployment.json`
```json
{
  "mode": "local",  // "local" | "server"

  "local": {
    "llmProvider": "ollama",
    "storagePath": "${METAHUMAN_ROOT}",
    "ollamaEndpoint": "http://localhost:11434"
  },

  "server": {
    "llmProvider": "runpod_serverless",
    "storagePath": "/runpod-volume/metahuman",
    "runpod": {
      "endpointId": "${RUNPOD_ENDPOINT_ID}",
      "apiKey": "${RUNPOD_API_KEY}"
    },
    "redis": {
      "url": "${REDIS_URL}"
    },
    "scaling": {
      "maxConcurrentInference": 3,
      "queueTimeout": 60000,
      "coldStartWarningMs": 15000
    }
  }
}
```

**New file**: `packages/core/src/deployment.ts`
```typescript
export type DeploymentMode = 'local' | 'server';

export interface DeploymentConfig {
  mode: DeploymentMode;
  local: LocalConfig;
  server: ServerConfig;
}

export function loadDeploymentConfig(): DeploymentConfig { ... }
export function getDeploymentMode(): DeploymentMode { ... }
export function isServerMode(): boolean { ... }
export function isLocalMode(): boolean { ... }
```

---

### Phase 3: Create `packages/server` (Optional Package)

**Goal**: Server-specific code that isn't needed for local users.

**Structure**:
```
packages/server/
├── package.json
├── src/
│   ├── index.ts
│   ├── providers/
│   │   ├── runpod.ts          # RunPod serverless provider
│   │   └── huggingface.ts     # HuggingFace Inference Endpoints
│   ├── queue/
│   │   ├── redis-queue.ts     # Request queuing for scaling
│   │   └── priority.ts        # Priority routing
│   ├── storage/
│   │   └── network-volume.ts  # RunPod Network Volume adapter
│   └── scaling/
│       ├── cold-start.ts      # Cold start detection/handling
│       ├── model-router.ts    # Route to fast/slow models
│       └── metrics.ts         # Usage tracking
```

**package.json** (server package):
```json
{
  "name": "@metahuman/server",
  "version": "0.1.0",
  "description": "Server deployment components for MetaHuman OS",
  "type": "module",
  "main": "dist/index.js",
  "peerDependencies": {
    "@metahuman/core": "workspace:*"
  },
  "dependencies": {
    "ioredis": "^5.3.0"
  },
  "optionalDependencies": {}
}
```

**Key**: This package is NOT a dependency of `@metahuman/core` - it's optional and only loaded in server mode.

---

### Phase 4: Conditional Provider Loading

**Goal**: Load RunPod provider only when in server mode.

**Modified** `packages/core/src/llm.ts`:
```typescript
export class LLMManager {
  constructor() {
    // Always register local providers
    this.registerProvider('ollama', new OllamaProvider());
    this.registerProvider('mock', new MockProvider());

    // Server providers loaded dynamically if in server mode
    if (isServerMode()) {
      this.loadServerProviders();
    }
  }

  private async loadServerProviders() {
    try {
      // Dynamic import - won't fail if @metahuman/server not installed
      const { RunPodServerlessProvider } = await import('@metahuman/server');
      const config = loadDeploymentConfig();
      this.registerProvider('runpod_serverless', new RunPodServerlessProvider(config.server.runpod));
    } catch (e) {
      console.warn('[llm] Server providers not available (server mode requires @metahuman/server)');
    }
  }
}
```

---

### Phase 5: Request Queue for Scaling

**Goal**: Handle concurrent requests gracefully at scale.

**New file**: `packages/server/src/queue/redis-queue.ts`
```typescript
export class InferenceQueue {
  private redis: Redis;
  private maxConcurrent: number;

  async enqueue(request: InferenceRequest): Promise<InferenceResponse> {
    // Add to queue
    const ticket = await this.redis.lpush('inference:queue', JSON.stringify(request));

    // Wait for result with timeout
    const result = await this.waitForResult(ticket, request.timeout);
    return result;
  }

  async processQueue() {
    // Worker loop - process requests respecting concurrency limits
  }
}
```

**Integration with model-router.ts**:
```typescript
export async function callLLM(options: RouterCallOptions): Promise<RouterResponse> {
  if (isServerMode()) {
    const queue = getInferenceQueue();
    return queue.enqueue({
      ...options,
      priority: options.priority || 'normal',
      timeout: options.timeout || 60000,
    });
  }

  // Local mode - direct call
  return callLLMDirect(options);
}
```

---

### Phase 6: Cold Start Handling

**Goal**: Graceful UX during GPU cold starts.

**New file**: `packages/server/src/scaling/cold-start.ts`
```typescript
export interface ColdStartConfig {
  warningThresholdMs: number;  // Show warning after this long
  maxWaitMs: number;           // Fail after this long
  keepWarmIntervalMs?: number; // Optional: ping to keep warm
}

export class ColdStartManager {
  async waitForModel(modelId: string, onProgress: (status: string) => void): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const status = await this.checkModelStatus(modelId);

      if (status === 'ready') return;

      const elapsed = Date.now() - startTime;

      if (elapsed > this.config.warningThresholdMs) {
        onProgress(`GPU warming up... (${Math.round(elapsed/1000)}s)`);
      }

      if (elapsed > this.config.maxWaitMs) {
        throw new Error('GPU cold start timeout');
      }

      await sleep(1000);
    }
  }
}
```

---

### Phase 7: Multi-User Path Isolation on Server

**Goal**: Each user's data isolated on network volume.

**Current system already supports this** via `getProfilePaths(username)`:
```
/runpod-volume/metahuman/
├── profiles/
│   ├── alice/
│   │   ├── memory/
│   │   ├── persona/
│   │   └── etc/
│   ├── bob/
│   │   ├── memory/
│   │   └── ...
│   └── ...
├── etc/                    # System config (shared)
├── brain/                  # Agents (shared)
└── logs/                   # System logs
```

**Only change needed**: Update `ROOT` resolution for server mode:
```typescript
// packages/core/src/path-builder.ts
export function findRepoRoot(): string {
  // Server mode: use METAHUMAN_ROOT env var
  if (process.env.METAHUMAN_ROOT) {
    return process.env.METAHUMAN_ROOT;
  }

  // Local mode: find pnpm-workspace.yaml
  // ... existing logic
}
```

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `packages/server/` | New optional package for server mode |
| `packages/server/src/providers/runpod.ts` | RunPod Serverless provider |
| `packages/server/src/queue/redis-queue.ts` | Request queuing |
| `packages/server/src/scaling/cold-start.ts` | Cold start handling |
| `packages/core/src/deployment.ts` | Deployment mode configuration |
| `etc/deployment.json` | Deployment configuration |
| `deploy/runpod/` | Deployment scripts and configs |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/llm.ts` | Add dynamic provider loading |
| `packages/core/src/path-builder.ts` | Support METAHUMAN_ROOT env var |
| `packages/core/src/model-router.ts` | Queue integration for server mode |
| `etc/models.json` | Add provider configs |
| `pnpm-workspace.yaml` | Add packages/server |

### Unchanged
| Component | Reason |
|-----------|--------|
| `packages/cli` | CLI is local-only, no changes needed |
| `apps/site` | Web UI works with both modes via core APIs |
| `brain/agents/` | Agents work with core APIs, mode-agnostic |

---

## Implementation Order

1. **Phase 1** - LLM Provider Abstraction (2-3 hours)
   - Create `packages/core/src/providers/runpod.ts`
   - Add to LLMManager with dynamic loading

2. **Phase 2** - Deployment Configuration (1-2 hours)
   - Create `etc/deployment.json`
   - Create `packages/core/src/deployment.ts`

3. **Phase 3** - Server Package Structure (2-3 hours)
   - Create `packages/server/` with basic structure
   - Move RunPod provider there

4. **Phase 4** - Path Resolution for Server (1 hour)
   - Update path-builder.ts for METAHUMAN_ROOT
   - Test with env var

5. **Phase 5** - Request Queue (3-4 hours)
   - Implement Redis queue
   - Integrate with model-router

6. **Phase 6** - Cold Start Handling (2 hours)
   - Implement cold start manager
   - Add progress callbacks to chat API

7. **Phase 7** - Deployment Scripts (2-3 hours)
   - Dockerfile for web server pod
   - RunPod serverless handler
   - Deployment documentation

---

## Testing Strategy

### Local Mode (existing users)
- All existing tests pass
- No `@metahuman/server` dependency required
- Default `etc/deployment.json` set to `"mode": "local"`

### Server Mode
- Set `METAHUMAN_ROOT=/tmp/test-server`
- Set `DEPLOYMENT_MODE=server`
- Mock RunPod API for unit tests
- Integration tests against real RunPod (CI/CD only)

---

## Backwards Compatibility

✅ **Individual users unaffected**:
- Default mode is `local`
- No new dependencies in core
- `@metahuman/server` is optional
- CLI works exactly as before

✅ **Existing deployments work**:
- No breaking changes to APIs
- Configuration is additive
- Path resolution falls back to current behavior

---

## Cost Estimate (Server Mode at Scale)

| Users/Day | Chats/Day | GPU Cost | Infrastructure | Total |
|-----------|-----------|----------|----------------|-------|
| 5-10 (beta) | 100-500 | ~$10-50/mo | ~$30/mo | ~$50-80/mo |
| 50-100 | 2,500-5,000 | ~$100-300/mo | ~$50/mo | ~$150-350/mo |
| 500-1,000 | 25,000-50,000 | ~$800-2,000/mo | ~$100/mo | ~$900-2,100/mo |

---

## Questions to Resolve

1. **Redis hosting**: Use RunPod Redis addon or external (Upstash)?
2. **Model tiering**: Implement fast/slow model routing in Phase 1 or later?
3. **HuggingFace**: Add HF Inference Endpoints as alternative provider?
4. **Authentication**: Use existing auth or add OAuth for server mode?

---

## Next Steps

Ready to begin implementation. Recommend starting with:
1. Phase 1 (RunPod provider) - enables testing with real serverless GPU
2. Phase 2 (deployment config) - makes mode switching clean
3. Phase 3 (server package) - proper separation of concerns

Then iterate on scaling features (queue, cold start) based on beta testing feedback.

---

# Mobile App Standalone Mode

## Goal

Enable the mobile APK to function independently when the local computer is offline, connecting directly to a cloud backend (RunPod or hosted server).

## Current Mobile Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CURRENT ARCHITECTURE                        │
│                                                                 │
│  ┌──────────────┐         ┌──────────────────────────────────┐ │
│  │ Mobile APK   │         │  Local Computer (mh.dndiy.org)   │ │
│  │              │ ──────> │  ┌─────────────────────────────┐ │ │
│  │ - Static UI  │  HTTP   │  │ apps/site (Astro server)    │ │ │
│  │ - Native     │         │  │ - 189 API endpoints         │ │ │
│  │   Voice      │         │  │ - Ollama integration        │ │ │
│  │ - WebView    │         │  │ - Memory/Persona storage    │ │ │
│  │              │         │  └─────────────────────────────┘ │ │
│  └──────────────┘         └──────────────────────────────────┘ │
│                                                                 │
│  PROBLEM: App useless when computer is off                      │
└─────────────────────────────────────────────────────────────────┘
```

## Target Architecture: Three-Tier Mobile

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     THREE-TIER MOBILE ARCHITECTURE                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          MOBILE APP                                     │ │
│  │                                                                         │ │
│  │  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────────┐ │ │
│  │  │ TIER 1: OFFLINE   │ │ TIER 2: SERVER    │ │ TIER 3: CLOUD         │ │ │
│  │  │ (Standalone)      │ │ (Paired)          │ │ (RunPod Direct)       │ │ │
│  │  │                   │ │                   │ │                       │ │ │
│  │  │ • Tiny on-device  │ │ • Full sync with  │ │ • Heavy inference     │ │ │
│  │  │   LLM (1-3B)      │ │   home server     │ │   (30B+ models)       │ │ │
│  │  │ • Local SQLite DB │ │ • Ollama GPU      │ │ • Training pipeline   │ │ │
│  │  │ • Core persona    │ │ • Complete memory │ │ • Memory consolidation│ │ │
│  │  │ • Basic chat      │ │ • All features    │ │ • Complex reasoning   │ │ │
│  │  │ • Offline-first   │ │                   │ │                       │ │ │
│  │  │                   │ │                   │ │                       │ │ │
│  │  │ USE CASE:         │ │ USE CASE:         │ │ USE CASE:             │ │ │
│  │  │ No internet,      │ │ Home network,     │ │ Away from home,       │ │ │
│  │  │ airplane mode,    │ │ full features,    │ │ need full power,      │ │ │
│  │  │ battery saving    │ │ fast local LLM    │ │ complex tasks         │ │ │
│  │  └───────────────────┘ └───────────────────┘ └───────────────────────┘ │ │
│  │           ▲                     ▲                       ▲              │ │
│  │           │                     │                       │              │ │
│  │           └─────────── AUTOMATIC TIER SELECTION ────────┘              │ │
│  │                    (connectivity + battery + task complexity)          │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                      SHARED COMPONENTS                           │   │ │
│  │  │  • Unified memory format (sync between tiers)                    │   │ │
│  │  │  • Common persona representation                                 │   │ │
│  │  │  • Consistent UI across all modes                                │   │ │
│  │  │  • Conflict resolution for offline→online sync                   │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tier Capabilities Comparison

| Feature | Tier 1 (Offline) | Tier 2 (Server) | Tier 3 (Cloud) |
|---------|------------------|-----------------|----------------|
| **LLM** | **Qwen3-1.7B** (on-device) | **Qwen3:14B** via Ollama | **Qwen3-Coder-30B** via RunPod |
| **Memory** | Local SQLite (last 30 days) | Full episodic (all time) | Full + training data |
| **Persona** | Core traits only | Full persona + facets | Full + adaptive learning |
| **Voice** | On-device TTS/STT | Server-enhanced | Cloud TTS (high quality) |
| **Features** | Basic chat, reminders | Full app features | Training, complex reasoning |
| **Latency** | Instant (<100ms) | Fast (200-500ms) | Variable (1-10s) |
| **Battery** | Low | Medium | High (network) |
| **Storage** | ~2-4GB on device | Minimal (sync) | None (cloud) |
| **Internet** | Not required | LAN only | Required |

## Code Inheritance Architecture

**CRITICAL PRINCIPLE**: The mobile app is NOT a separate codebase. It is the SAME codebase with a different build target.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SINGLE SOURCE OF TRUTH                                │
│                                                                              │
│  apps/site/src/                                                              │
│  ├── components/           ← Shared Svelte components (edit ONCE)           │
│  │   ├── ChatInterface.svelte    ← Used by BOTH web and mobile             │
│  │   ├── LeftSidebar.svelte      ← Used by BOTH                            │
│  │   ├── CenterContent.svelte    ← Used by BOTH                            │
│  │   └── ...                                                                │
│  ├── lib/                                                                    │
│  │   ├── client/           ← Client-side shared code                        │
│  │   │   ├── api-config.ts       ← Detects web vs mobile, sets base URL    │
│  │   │   ├── tier-selector.ts    ← NEW: Selects offline/server/cloud       │
│  │   │   ├── local-memory.ts     ← NEW: IndexedDB for mobile storage       │
│  │   │   └── unified-chat.ts     ← NEW: Routes to correct tier             │
│  │   └── plugins/                                                            │
│  │       ├── native-voice.ts     ← Mobile-only (graceful no-op on web)     │
│  │       └── native-llm.ts       ← NEW: Mobile-only LLM plugin             │
│  └── pages/                                                                  │
│      └── api/              ← Server-side only (excluded from mobile build)  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         BUILD TARGETS                                │    │
│  │                                                                      │    │
│  │  pnpm build (astro.config.mjs)     pnpm build:mobile                │    │
│  │         │                           (astro.config.mobile.mjs)        │    │
│  │         ▼                                    ▼                       │    │
│  │  ┌─────────────────┐              ┌─────────────────────┐           │    │
│  │  │ apps/site/dist/ │              │ apps/mobile/www/    │           │    │
│  │  │ (SSR Server)    │              │ (Static Bundle)     │           │    │
│  │  │ + API routes    │              │ - No API routes     │           │    │
│  │  │ + Node adapter  │              │ - Pre-rendered HTML │           │    │
│  │  └─────────────────┘              │ - All JS/CSS        │           │    │
│  │         │                         └─────────────────────┘           │    │
│  │         ▼                                    │                       │    │
│  │  ./start.sh                       npx cap sync android               │    │
│  │  (Web Server)                              │                         │    │
│  │                                            ▼                         │    │
│  │                                  ┌─────────────────────┐            │    │
│  │                                  │ Android APK         │            │    │
│  │                                  │ + Native plugins    │            │    │
│  │                                  │ + llama.cpp         │            │    │
│  │                                  └─────────────────────┘            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### How Feature Changes Flow

| When you edit... | Web gets it | Mobile gets it |
|------------------|-------------|----------------|
| `ChatInterface.svelte` | ✅ Immediate (dev server) | ✅ Next APK build |
| `api-config.ts` | ✅ Immediate | ✅ Next APK build |
| `pages/api/*.ts` | ✅ Immediate | ❌ N/A (server-only) |
| Native plugin (`.kt`) | ❌ N/A | ✅ Next APK build |

### Platform Detection Pattern

```typescript
// apps/site/src/lib/client/api-config.ts
import { Capacitor } from '@capacitor/core';

export function isCapacitorNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function isWeb(): boolean {
  return !isCapacitorNative();
}

// Feature that works differently on each platform
export async function getApiBaseUrl(): Promise<string> {
  if (isWeb()) {
    return '';  // Relative URLs, same origin
  }
  // Mobile: read from stored preferences
  const { value } = await Preferences.get({ key: 'server_url' });
  return value || 'https://mh.dndiy.org';
}
```

### Graceful Degradation for Native Features

```typescript
// apps/site/src/lib/client/plugins/native-llm.ts
import { Capacitor } from '@capacitor/core';

// Plugin only exists on native platforms
export const NativeLLM = Capacitor.isNativePlatform()
  ? registerPlugin<NativeLLMPlugin>('NativeLLM')
  : createWebFallback();

function createWebFallback(): NativeLLMPlugin {
  return {
    loadModel: async () => { throw new Error('On-device LLM only available in mobile app'); },
    generate: async () => { throw new Error('On-device LLM only available in mobile app'); },
    getAvailableModels: async () => ({ models: [] }),
    // ... graceful fallbacks
  };
}
```

### Build Commands

```bash
# Development (web)
cd apps/site && pnpm dev

# Production web build
cd apps/site && pnpm build        # → dist/

# Mobile build (uses SAME source, different config)
cd apps/mobile && ./scripts/build-mobile.sh   # → www/ → APK

# The build script:
# 1. Runs astro build with astro.config.mobile.mjs
# 2. Outputs static files to apps/mobile/www/
# 3. Syncs to Android assets
# 4. Builds APK with native plugins
```

### What Lives Where

| Component | Location | Used By |
|-----------|----------|---------|
| Svelte components | `apps/site/src/components/` | Both |
| Client utilities | `apps/site/src/lib/client/` | Both |
| API routes | `apps/site/src/pages/api/` | Web only |
| Native plugins | `apps/mobile/android/.../plugins/` | Mobile only |
| Build configs | `apps/site/astro.config.*.mjs` | Build system |
| Capacitor config | `apps/mobile/capacitor.config.ts` | Mobile only |

---

## Current State Analysis

### What Mobile App Already Has ✅
| Feature | Status | Notes |
|---------|--------|-------|
| Static UI bundle | ✅ | 4.2M pre-rendered in www/ |
| Native voice (STT/TTS) | ✅ | Full NativeVoicePlugin |
| Hardware button capture | ✅ | 3-layer approach working |
| API client abstraction | ✅ | apiFetch() with configurable base |
| HTTPS support | ✅ | Required for Android WebView |
| Offline UI rendering | ✅ | No server needed for UI |

### What's Missing ❌
| Feature | Gap | Solution |
|---------|-----|----------|
| Configurable server URL | Hardcoded to mh.dndiy.org | Settings screen + storage |
| Server health detection | No check before API calls | Health endpoint + fallback |
| Multiple server profiles | Single server only | Server profile management |
| Offline mode | All features need server | Local cache + graceful degradation |
| Direct RunPod connection | Goes through Astro server | Lightweight API proxy or direct |

## Implementation Phases

### Phase M0: On-Device LLM (Tier 1 Foundation) - 12-16 hours

**Goal**: Run a small LLM directly on Android for offline chat.

#### Technology Options

| Library | Language | Pros | Cons |
|---------|----------|------|------|
| **llama.cpp** | C++ (JNI) | Battle-tested, fast | Complex build |
| **MLC LLM** | Java/Kotlin | Android-native, easy | Less flexible |
| **ONNX Runtime** | Java | Microsoft backing | Model conversion needed |
| **MediaPipe LLM** | Java | Google, well integrated | Limited model support |

**Recommendation**: Start with **llama.cpp via JNI** for maximum flexibility and model support.

#### Viable On-Device Models (Qwen3 Family)

| Model | Size | RAM Needed | Quality | Speed (SD 8 Gen 2) |
|-------|------|------------|---------|-------------------|
| **Qwen3-0.6B-Q4** | 450MB | 1GB | Good | ~35 tok/s |
| **Qwen3-1.7B-Q4** | 1.2GB | 2GB | Very Good | ~18 tok/s |
| **Qwen3-4B-Q4** | 2.5GB | 4GB | Excellent | ~8 tok/s |
| Llama-3.2-1B-Q4 | 800MB | 1.5GB | Good | ~20 tok/s |

**Default recommendation**: **Qwen3-1.7B-Q4** - same model family as server/cloud, excellent quality at mobile-friendly size.

**Why Qwen3?**
- Same architecture as cloud model (Qwen3-Coder-30B)
- Consistent behavior across all tiers
- Excellent instruction following
- Good reasoning even at small sizes
- Active development and community support

#### Native Plugin Structure

```
apps/mobile/android/app/src/main/java/com/metahuman/os/
├── plugins/
│   ├── voice/
│   │   └── NativeVoicePlugin.kt      # Existing
│   └── llm/
│       ├── NativeLLMPlugin.kt        # NEW: Capacitor bridge
│       ├── LlamaEngine.kt            # NEW: llama.cpp wrapper
│       └── ModelManager.kt           # NEW: Download/load models
├── jni/
│   └── libllama.so                   # NEW: Compiled llama.cpp
└── assets/
    └── models/
        └── qwen3-1.7b-q4.gguf        # Bundled or downloaded
```

#### NativeLLMPlugin.kt Interface

```kotlin
@CapacitorPlugin(name = "NativeLLM")
class NativeLLMPlugin : Plugin() {
    private var engine: LlamaEngine? = null
    private var currentModel: String? = null

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val modelPath = call.getString("model") ?: "qwen3-1.7b-q4"

        CoroutineScope(Dispatchers.IO).launch {
            try {
                engine = LlamaEngine()
                engine?.loadModel(getModelPath(modelPath))
                currentModel = modelPath

                call.resolve(JSObject().apply {
                    put("success", true)
                    put("model", modelPath)
                })
            } catch (e: Exception) {
                call.reject("Failed to load model: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt") ?: return call.reject("No prompt")
        val maxTokens = call.getInt("maxTokens") ?: 256

        if (engine == null) {
            return call.reject("No model loaded")
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val response = engine!!.generate(prompt, maxTokens)
                call.resolve(JSObject().apply {
                    put("response", response)
                    put("tokensGenerated", response.split(" ").size)
                })
            } catch (e: Exception) {
                call.reject("Generation failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun generateStream(call: PluginCall) {
        val prompt = call.getString("prompt") ?: return call.reject("No prompt")
        val callbackId = call.callbackId

        CoroutineScope(Dispatchers.IO).launch {
            engine?.generateStream(prompt) { token ->
                // Send each token back to JS
                notifyListeners("token", JSObject().apply {
                    put("token", token)
                    put("callbackId", callbackId)
                })
            }

            notifyListeners("complete", JSObject().apply {
                put("callbackId", callbackId)
            })
        }

        call.setKeepAlive(true)
    }

    @PluginMethod
    fun getAvailableModels(call: PluginCall) {
        val models = ModelManager.getAvailableModels(context)
        call.resolve(JSObject().apply {
            put("models", JSArray(models.map { it.toJSON() }))
        })
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val modelId = call.getString("modelId") ?: return call.reject("No model ID")

        CoroutineScope(Dispatchers.IO).launch {
            ModelManager.downloadModel(context, modelId) { progress ->
                notifyListeners("downloadProgress", JSObject().apply {
                    put("modelId", modelId)
                    put("progress", progress)
                })
            }
            call.resolve(JSObject().apply { put("success", true) })
        }

        call.setKeepAlive(true)
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        engine?.unload()
        engine = null
        currentModel = null
        call.resolve()
    }
}
```

#### TypeScript Client

```typescript
// apps/site/src/lib/client/plugins/native-llm.ts
import { registerPlugin } from '@capacitor/core';

interface NativeLLMPlugin {
  loadModel(options: { model: string }): Promise<{ success: boolean; model: string }>;
  generate(options: { prompt: string; maxTokens?: number }): Promise<{ response: string }>;
  generateStream(options: { prompt: string }): Promise<void>;
  getAvailableModels(): Promise<{ models: ModelInfo[] }>;
  downloadModel(options: { modelId: string }): Promise<{ success: boolean }>;
  unloadModel(): Promise<void>;
  addListener(event: 'token', callback: (data: { token: string }) => void): Promise<void>;
  addListener(event: 'complete', callback: () => void): Promise<void>;
  addListener(event: 'downloadProgress', callback: (data: { progress: number }) => void): Promise<void>;
}

interface ModelInfo {
  id: string;
  name: string;
  size: number;  // bytes
  downloaded: boolean;
  recommended: boolean;
}

export const NativeLLM = registerPlugin<NativeLLMPlugin>('NativeLLM');

// High-level wrapper for chat
export class OfflineLLM {
  private loaded = false;

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    const models = await NativeLLM.getAvailableModels();
    const recommended = models.models.find(m => m.downloaded && m.recommended);

    if (!recommended) {
      throw new Error('No offline model available. Download one in settings.');
    }

    await NativeLLM.loadModel({ model: recommended.id });
    this.loaded = true;
  }

  async chat(message: string, persona: string): Promise<string> {
    await this.ensureLoaded();

    // Build simple prompt with persona context
    const prompt = `You are ${persona}. Respond naturally and briefly.

User: ${message}
Assistant:`;

    const result = await NativeLLM.generate({ prompt, maxTokens: 256 });
    return result.response;
  }

  async chatStream(message: string, persona: string, onToken: (token: string) => void): Promise<void> {
    await this.ensureLoaded();

    const prompt = `You are ${persona}. Respond naturally and briefly.

User: ${message}
Assistant:`;

    await NativeLLM.addListener('token', (data) => onToken(data.token));
    await NativeLLM.generateStream({ prompt });
  }
}
```

#### Local Memory Database

```typescript
// apps/site/src/lib/client/local-memory.ts
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface LocalMemoryDB extends DBSchema {
  memories: {
    key: string;  // UUID
    value: {
      id: string;
      type: 'conversation' | 'observation' | 'inner_dialogue';
      content: string;
      timestamp: string;
      synced: boolean;  // Has this been synced to server?
      metadata: {
        tier: 'offline' | 'server' | 'cloud';
        model?: string;
      };
    };
    indexes: {
      'by-timestamp': string;
      'by-synced': boolean;
    };
  };
  persona: {
    key: 'core';
    value: {
      name: string;
      traits: string[];
      summary: string;
      lastSynced: string;
    };
  };
  settings: {
    key: string;
    value: any;
  };
}

export class LocalMemory {
  private db: IDBPDatabase<LocalMemoryDB> | null = null;

  async init(): Promise<void> {
    this.db = await openDB<LocalMemoryDB>('metahuman-local', 1, {
      upgrade(db) {
        const memoryStore = db.createObjectStore('memories', { keyPath: 'id' });
        memoryStore.createIndex('by-timestamp', 'timestamp');
        memoryStore.createIndex('by-synced', 'synced');

        db.createObjectStore('persona', { keyPath: 'key' });
        db.createObjectStore('settings');
      }
    });
  }

  async saveMemory(memory: LocalMemoryDB['memories']['value']): Promise<void> {
    await this.db!.put('memories', memory);
  }

  async getRecentMemories(limit = 50): Promise<LocalMemoryDB['memories']['value'][]> {
    const all = await this.db!.getAllFromIndex('memories', 'by-timestamp');
    return all.slice(-limit).reverse();
  }

  async getUnsyncedMemories(): Promise<LocalMemoryDB['memories']['value'][]> {
    return this.db!.getAllFromIndex('memories', 'by-synced', false);
  }

  async markSynced(ids: string[]): Promise<void> {
    const tx = this.db!.transaction('memories', 'readwrite');
    for (const id of ids) {
      const memory = await tx.store.get(id);
      if (memory) {
        memory.synced = true;
        await tx.store.put(memory);
      }
    }
    await tx.done;
  }

  async getPersona(): Promise<LocalMemoryDB['persona']['value'] | undefined> {
    return this.db!.get('persona', 'core');
  }

  async setPersona(persona: LocalMemoryDB['persona']['value']): Promise<void> {
    await this.db!.put('persona', { ...persona, key: 'core' });
  }

  // Cleanup old memories to save space (keep last 30 days)
  async pruneOldMemories(daysToKeep = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const all = await this.db!.getAll('memories');
    const toDelete = all.filter(m => m.synced && new Date(m.timestamp) < cutoff);

    const tx = this.db!.transaction('memories', 'readwrite');
    for (const memory of toDelete) {
      await tx.store.delete(memory.id);
    }
    await tx.done;

    return toDelete.length;
  }
}
```

#### Build Configuration

**Android build.gradle additions**:
```gradle
android {
    defaultConfig {
        ndk {
            abiFilters 'arm64-v8a', 'armeabi-v7a'  // Most Android devices
        }
    }

    externalNativeBuild {
        cmake {
            path "src/main/cpp/CMakeLists.txt"
        }
    }
}

dependencies {
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
}
```

**CMakeLists.txt for llama.cpp**:
```cmake
cmake_minimum_required(VERSION 3.18)
project(llama_android)

set(CMAKE_CXX_STANDARD 17)

# Add llama.cpp source
add_subdirectory(llama.cpp)

# JNI bridge
add_library(llama_jni SHARED
    llama_jni.cpp
)

target_link_libraries(llama_jni
    llama
    log
)
```

#### APK Size Impact

| Component | Size |
|-----------|------|
| Current APK | 7.4 MB |
| + llama.cpp library | +2-3 MB |
| + Default model (Q4) | +1-2 GB (downloaded separately) |
| **Base APK total** | ~10 MB |
| **With model** | ~1-2 GB |

**Strategy**: Ship small APK, download model on first launch or in settings.

---

### Phase M1: Configurable Server URL (2-3 hours)

**Goal**: Allow user to configure which server the app connects to.

**Files to modify**:
- `apps/site/src/lib/client/api-config.ts` - Dynamic base URL
- `apps/mobile/capacitor.config.ts` - Dev server URL handling
- New: `apps/site/src/components/ServerSettings.svelte` - UI for configuration

**Implementation**:
```typescript
// apps/site/src/lib/client/api-config.ts
import { Preferences } from '@capacitor/preferences';

const DEFAULT_SERVERS = {
  local: 'https://mh.dndiy.org',
  cloud: 'https://api.metahuman.cloud'  // Future cloud deployment
};

export async function getApiBaseUrl(): Promise<string> {
  if (!isCapacitorNative()) {
    return '';  // Web uses relative URLs
  }

  // Try to get user-configured server
  const { value: customServer } = await Preferences.get({ key: 'server_url' });
  if (customServer) {
    return customServer;
  }

  // Fall back to default
  return DEFAULT_SERVERS.local;
}

export async function setServerUrl(url: string): Promise<void> {
  await Preferences.set({ key: 'server_url', value: url });
}
```

**New Settings UI**:
```svelte
<!-- ServerSettings.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { getApiBaseUrl, setServerUrl, testServerConnection } from '$lib/client/api-config';

  let serverUrl = '';
  let status: 'unknown' | 'checking' | 'online' | 'offline' = 'unknown';

  onMount(async () => {
    serverUrl = await getApiBaseUrl();
    await checkConnection();
  });

  async function checkConnection() {
    status = 'checking';
    const result = await testServerConnection(serverUrl);
    status = result ? 'online' : 'offline';
  }

  async function saveServer() {
    await setServerUrl(serverUrl);
    await checkConnection();
  }
</script>

<div class="server-settings">
  <h3>Server Connection</h3>
  <input bind:value={serverUrl} placeholder="https://..." />
  <button on:click={saveServer}>Save</button>
  <span class="status {status}">{status}</span>
</div>
```

---

### Phase M2: Server Health Detection (2 hours)

**Goal**: Detect server availability and show appropriate status.

**New file**: `apps/site/src/lib/client/server-health.ts`
```typescript
export interface ServerHealth {
  status: 'online' | 'offline' | 'degraded';
  latencyMs: number;
  lastChecked: Date;
  version?: string;
  capabilities: {
    chat: boolean;
    voice: boolean;
    memory: boolean;
    training: boolean;
  };
}

export async function checkServerHealth(baseUrl: string): Promise<ServerHealth> {
  const start = Date.now();

  try {
    const response = await fetch(`${baseUrl}/api/boot`, {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(5000)  // 5 second timeout
    });

    if (!response.ok) {
      return { status: 'offline', latencyMs: Date.now() - start, ... };
    }

    const data = await response.json();
    return {
      status: 'online',
      latencyMs: Date.now() - start,
      lastChecked: new Date(),
      version: data.version,
      capabilities: {
        chat: true,
        voice: data.services?.voice ?? false,
        memory: data.services?.memory ?? true,
        training: data.services?.training ?? false
      }
    };
  } catch (error) {
    return {
      status: 'offline',
      latencyMs: Date.now() - start,
      lastChecked: new Date(),
      capabilities: { chat: false, voice: false, memory: false, training: false }
    };
  }
}

// Background health monitoring
export class ServerHealthMonitor {
  private interval: number | null = null;
  private currentHealth: ServerHealth | null = null;
  private listeners: ((health: ServerHealth) => void)[] = [];

  start(checkIntervalMs = 30000) {
    this.interval = setInterval(() => this.check(), checkIntervalMs);
    this.check();  // Immediate first check
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  onHealthChange(callback: (health: ServerHealth) => void) {
    this.listeners.push(callback);
  }

  private async check() {
    const baseUrl = await getApiBaseUrl();
    this.currentHealth = await checkServerHealth(baseUrl);
    this.listeners.forEach(cb => cb(this.currentHealth!));
  }
}
```

---

### Phase M3: Multiple Server Profiles (3 hours)

**Goal**: Save and switch between multiple server configurations.

**Data model**:
```typescript
interface ServerProfile {
  id: string;
  name: string;
  url: string;
  icon: 'home' | 'cloud' | 'work' | 'custom';
  authToken?: string;  // For authenticated servers
  isDefault: boolean;
  lastConnected?: Date;
}

// Stored in Capacitor Preferences
const profiles: ServerProfile[] = [
  { id: 'home', name: 'Home Server', url: 'https://mh.dndiy.org', icon: 'home', isDefault: true },
  { id: 'cloud', name: 'Cloud Backup', url: 'https://api.metahuman.cloud', icon: 'cloud', isDefault: false }
];
```

**UI**: Server picker in app header or settings with:
- List of saved servers with status indicators (green/red dot)
- Quick switch between servers
- Add/edit/delete server profiles
- Auto-reconnect to last working server

---

### Phase M4: Minimal Cloud Backend (8-12 hours)

**Goal**: Deploy a lightweight API server that can run in the cloud with RunPod.

This is the biggest piece - we need a backend that can run independently.

**Option A: Full Astro Server on Cloud VM**
```
┌─────────────────────────────────────────┐
│ Cloud VM (DigitalOcean/Hetzner/etc)     │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ apps/site (Astro SSR)                │ │
│ │ - All 189 API endpoints              │ │
│ │ - No Ollama (uses RunPod)            │ │
│ │ - Memory on cloud storage            │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ Cost: ~$10-20/mo for VM                  │
│ RunPod: Pay per inference                │
└─────────────────────────────────────────┘
```

**Option B: Serverless Functions (Vercel/Cloudflare)**
```
┌─────────────────────────────────────────┐
│ Cloudflare Workers / Vercel Edge        │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ Minimal API Gateway                   │ │
│ │ - /api/boot (health)                  │ │
│ │ - /api/persona_chat (→ RunPod)       │ │
│ │ - /api/status (cached)                │ │
│ │ - /api/memories/* (→ R2/KV storage)  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ Cost: ~$0-5/mo (free tier viable)        │
│ RunPod: Pay per inference                │
└─────────────────────────────────────────┘
```

**Option C: RunPod Pod with Web Server**
```
┌─────────────────────────────────────────┐
│ RunPod Pod (24/7)                        │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ Container with:                       │ │
│ │ - Node.js + Astro server              │ │
│ │ - vLLM for inference                  │ │
│ │ - Network Volume for storage          │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ Cost: ~$50-100/mo (24/7 GPU pod)         │
│ Benefit: All-in-one, simple              │
└─────────────────────────────────────────┘
```

**Recommendation**: Start with Option A (Cloud VM) as it requires minimal changes:
1. Deploy Astro server to VM
2. Configure to use RunPod serverless (already working!)
3. Point mobile app to VM URL
4. Evaluate Option B/C for cost optimization later

---

### Phase M5: Direct RunPod Integration (Optional, 6-8 hours)

**Goal**: Mobile app calls RunPod directly without intermediate server.

This is more complex but eliminates server costs:

```typescript
// apps/site/src/lib/client/runpod-direct.ts
export class RunPodDirectClient {
  constructor(
    private endpointId: string,
    private apiKey: string
  ) {}

  async chat(message: string, context?: ChatContext): Promise<string> {
    // Build prompt with persona context (cached locally)
    const persona = await this.getLocalPersona();
    const messages = this.buildMessages(message, persona, context);

    // Call RunPod directly
    const response = await fetch(
      `https://api.runpod.ai/v2/${this.endpointId}/runsync`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: { messages, max_tokens: 1024 }
        })
      }
    );

    return this.parseResponse(response);
  }

  // Cache persona locally on mobile
  private async getLocalPersona(): Promise<Persona> {
    const cached = await Preferences.get({ key: 'persona_cache' });
    if (cached.value) {
      return JSON.parse(cached.value);
    }
    // Fetch from server and cache
    const persona = await apiFetch('/api/persona-core');
    await Preferences.set({ key: 'persona_cache', value: JSON.stringify(persona) });
    return persona;
  }
}
```

**Challenges**:
- API key storage security (Android Keystore)
- Memory storage (local SQLite or cloud)
- No server-side processing (simpler prompts)
- Offline conversation caching

---

### Phase M6: Offline Resilience (4-6 hours)

**Goal**: App remains usable when completely offline.

**Features**:
1. **Conversation caching**: Store recent conversations locally
2. **Persona caching**: Local copy of persona for offline display
3. **Pending queue**: Queue messages when offline, sync when online
4. **Graceful degradation**: Show cached data, disable write features

```typescript
// apps/site/src/lib/client/offline-queue.ts
export class OfflineQueue {
  private db: IDBDatabase;

  async queueMessage(message: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.add('pending_messages', {
      id,
      message,
      timestamp: Date.now(),
      status: 'pending'
    });
    return id;
  }

  async syncWhenOnline(): Promise<void> {
    const pending = await this.db.getAll('pending_messages');
    for (const msg of pending) {
      try {
        await apiFetch('/api/persona_chat', {
          method: 'POST',
          body: JSON.stringify({ message: msg.message })
        });
        await this.db.delete('pending_messages', msg.id);
      } catch (e) {
        // Still offline, try later
        break;
      }
    }
  }
}
```

---

### Phase M7: Tier Selection Engine (4-6 hours)

**Goal**: Automatically select the best tier based on connectivity, battery, and task.

```typescript
// apps/site/src/lib/client/tier-selector.ts

export type Tier = 'offline' | 'server' | 'cloud';

export interface TierSelectionContext {
  hasInternet: boolean;
  hasServerConnection: boolean;
  batteryLevel: number;  // 0-100
  isCharging: boolean;
  taskComplexity: 'simple' | 'moderate' | 'complex';
  userPreference?: Tier;  // Manual override
}

export interface TierCapabilities {
  available: boolean;
  reason?: string;
  latencyMs?: number;
}

export class TierSelector {
  private serverHealth: ServerHealthMonitor;
  private offlineLLM: OfflineLLM;

  async getCapabilities(): Promise<Record<Tier, TierCapabilities>> {
    const [serverStatus, offlineReady] = await Promise.all([
      this.serverHealth.check(),
      this.checkOfflineCapability()
    ]);

    return {
      offline: {
        available: offlineReady,
        reason: offlineReady ? undefined : 'No model downloaded',
        latencyMs: 100  // ~100ms for on-device
      },
      server: {
        available: serverStatus.status === 'online',
        reason: serverStatus.status !== 'online' ? 'Server unreachable' : undefined,
        latencyMs: serverStatus.latencyMs
      },
      cloud: {
        available: navigator.onLine,
        reason: navigator.onLine ? undefined : 'No internet connection',
        latencyMs: 2000  // ~2s typical for RunPod
      }
    };
  }

  async selectTier(context: TierSelectionContext): Promise<Tier> {
    // User manual override always wins
    if (context.userPreference) {
      const caps = await this.getCapabilities();
      if (caps[context.userPreference].available) {
        return context.userPreference;
      }
      // Fall through if preferred tier unavailable
    }

    const caps = await this.getCapabilities();

    // Decision tree based on context
    if (context.taskComplexity === 'complex') {
      // Complex tasks need cloud power
      if (caps.cloud.available) return 'cloud';
      if (caps.server.available) return 'server';
      // Fall back to offline with warning
      return 'offline';
    }

    if (!context.hasInternet) {
      // No internet = offline only
      return 'offline';
    }

    if (context.batteryLevel < 20 && !context.isCharging) {
      // Low battery = prefer local processing
      if (caps.offline.available) return 'offline';
      if (caps.server.available) return 'server';  // LAN is low power
      return 'cloud';  // Last resort
    }

    if (caps.server.available && caps.server.latencyMs! < 500) {
      // Server available and fast = use it (full features)
      return 'server';
    }

    if (context.taskComplexity === 'simple' && caps.offline.available) {
      // Simple task + offline available = save bandwidth
      return 'offline';
    }

    // Default: best available
    if (caps.server.available) return 'server';
    if (caps.cloud.available) return 'cloud';
    return 'offline';
  }

  // Detect task complexity from message content
  detectTaskComplexity(message: string): 'simple' | 'moderate' | 'complex' {
    const lowerMsg = message.toLowerCase();

    // Complex indicators
    const complexPatterns = [
      /write.*code/i, /implement/i, /debug/i, /analyze/i,
      /create.*plan/i, /design/i, /compare/i, /explain.*detail/i
    ];
    if (complexPatterns.some(p => p.test(lowerMsg))) return 'complex';

    // Simple indicators
    const simplePatterns = [
      /^(hi|hello|hey)/i, /how are you/i, /what time/i,
      /remind me/i, /set.*timer/i, /^thanks/i
    ];
    if (simplePatterns.some(p => p.test(lowerMsg))) return 'simple';

    return 'moderate';
  }

  private async checkOfflineCapability(): Promise<boolean> {
    try {
      const models = await NativeLLM.getAvailableModels();
      return models.models.some(m => m.downloaded);
    } catch {
      return false;  // Plugin not available (web browser)
    }
  }
}
```

#### Unified Chat Interface

```typescript
// apps/site/src/lib/client/unified-chat.ts

export class UnifiedChat {
  private tierSelector: TierSelector;
  private localMemory: LocalMemory;
  private offlineLLM: OfflineLLM;

  async sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
    // Get device context
    const battery = await this.getBatteryStatus();
    const context: TierSelectionContext = {
      hasInternet: navigator.onLine,
      hasServerConnection: await this.tierSelector.serverHealth.isConnected(),
      batteryLevel: battery.level * 100,
      isCharging: battery.charging,
      taskComplexity: this.tierSelector.detectTaskComplexity(message),
      userPreference: options?.forceTier
    };

    // Select tier
    const tier = await this.tierSelector.selectTier(context);

    // Execute on selected tier
    let response: string;
    let model: string;

    switch (tier) {
      case 'offline':
        response = await this.executeOffline(message);
        model = 'qwen3-1.7b-q4';  // Qwen3 family, on-device
        break;
      case 'server':
        response = await this.executeServer(message);
        model = 'qwen3:14b';  // Qwen3 family, Ollama
        break;
      case 'cloud':
        response = await this.executeCloud(message);
        model = 'qwen3-coder-30b';  // Qwen3 family, RunPod
        break;
    }

    // Save to local memory (always)
    await this.localMemory.saveMemory({
      id: crypto.randomUUID(),
      type: 'conversation',
      content: `User: ${message}\n\nAssistant: ${response}`,
      timestamp: new Date().toISOString(),
      synced: tier !== 'offline',  // Server/cloud already synced
      metadata: { tier, model }
    });

    return { response, tier, model };
  }

  private async executeOffline(message: string): Promise<string> {
    const persona = await this.localMemory.getPersona();
    return this.offlineLLM.chat(message, persona?.summary || 'a helpful assistant');
  }

  private async executeServer(message: string): Promise<string> {
    const response = await apiFetch('/api/persona_chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    return response.json().then(r => r.response);
  }

  private async executeCloud(message: string): Promise<string> {
    // Direct RunPod call or through server if configured
    const response = await apiFetch('/api/persona_chat?tier=cloud', {
      method: 'POST',
      body: JSON.stringify({ message, useCloud: true })
    });
    return response.json().then(r => r.response);
  }

  private async getBatteryStatus() {
    if ('getBattery' in navigator) {
      return (navigator as any).getBattery();
    }
    return { level: 1, charging: true };  // Assume plugged in if no API
  }
}
```

---

### Phase M8: Memory Sync Protocol (4-6 hours)

**Goal**: Bi-directional sync between offline memories and server.

```typescript
// apps/site/src/lib/client/memory-sync.ts

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
}

export class MemorySync {
  private localMemory: LocalMemory;
  private lastSyncTimestamp: string | null = null;

  async sync(): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: 0, errors: [] };

    try {
      // 1. Upload unsynced local memories
      const unsynced = await this.localMemory.getUnsyncedMemories();
      if (unsynced.length > 0) {
        const uploadResult = await apiFetch('/api/memories/bulk-upload', {
          method: 'POST',
          body: JSON.stringify({ memories: unsynced })
        });
        const { accepted, conflicts } = await uploadResult.json();
        result.uploaded = accepted.length;
        result.conflicts = conflicts.length;

        // Mark as synced
        await this.localMemory.markSynced(accepted);

        // Handle conflicts (server wins by default)
        for (const conflict of conflicts) {
          await this.localMemory.saveMemory({
            ...conflict.serverVersion,
            synced: true
          });
        }
      }

      // 2. Download new server memories since last sync
      const since = this.lastSyncTimestamp || new Date(0).toISOString();
      const downloadResult = await apiFetch(`/api/memories/since?timestamp=${since}`);
      const { memories: newMemories, serverTimestamp } = await downloadResult.json();

      for (const memory of newMemories) {
        await this.localMemory.saveMemory({
          ...memory,
          synced: true
        });
        result.downloaded++;
      }

      this.lastSyncTimestamp = serverTimestamp;

      // 3. Sync persona if changed
      await this.syncPersona();

    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : 'Unknown sync error');
    }

    return result;
  }

  private async syncPersona(): Promise<void> {
    try {
      const serverPersona = await apiFetch('/api/persona-core').then(r => r.json());
      const localPersona = await this.localMemory.getPersona();

      // Server is source of truth for persona
      if (!localPersona || serverPersona.updatedAt > localPersona.lastSynced) {
        await this.localMemory.setPersona({
          name: serverPersona.name,
          traits: serverPersona.traits,
          summary: serverPersona.summary,
          lastSynced: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('Failed to sync persona:', e);
    }
  }

  // Background sync service
  startBackgroundSync(intervalMs = 5 * 60 * 1000): void {
    // Sync when app comes online
    window.addEventListener('online', () => this.sync());

    // Periodic sync
    setInterval(() => {
      if (navigator.onLine) {
        this.sync();
      }
    }, intervalMs);

    // Initial sync
    if (navigator.onLine) {
      this.sync();
    }
  }
}
```

---

## Minimum Viable Mobile Standalone

For an MVP that works when your computer is off:

### Track A: Full Offline (Most Ambitious)
1. **Phase M0**: On-device LLM with llama.cpp
2. **Phase M1**: Configurable server URL
3. **Phase M7**: Tier selection engine
4. **Phase M8**: Memory sync protocol

**Result**: True standalone app that works anywhere, syncs when connected.

### Track B: Cloud-Connected (Simpler, Faster)
1. **Phase M1**: Configurable server URL
2. **Phase M2**: Server health detection
3. **Phase M4**: Deploy cloud backend
4. **Phase M5**: Direct RunPod integration

**Result**: Works without home server, requires internet.

### Recommended: Hybrid Approach
Start with **Track B** for quick wins, then add **Track A** for true offline.

### Cost Comparison

| Approach | Monthly Cost | Offline? | Complexity |
|----------|--------------|----------|------------|
| Track A only | $0 (device only) | ✅ Full | High |
| Track B only | $15-60 | ❌ No | Medium |
| **Hybrid A+B** | $15-60 | ✅ Degraded | Medium-High |

---

## Implementation Order (Revised)

```
Sprint 1: Cloud Independence (Week 1-2)
├── M1: Configurable server URL        ✅ COMPLETE (2025-12-04)
├── M2: Server health detection        ✅ COMPLETE (2025-12-04)
├── M4: Deploy Astro to cloud VM       ⏳ PENDING
└── M5: Direct RunPod option           ⏳ PENDING
    Result: App works without home server ✓

Sprint 2: True Offline (Week 3-4)
├── M7: Tier selection logic           ✅ COMPLETE (2025-12-04)
├── M0: NativeLLMPlugin interface      ✅ COMPLETE (2025-12-04)
├── M0: Model download UI              ✅ COMPLETE (2025-12-04)
├── M0: Build llama.cpp for Android    ⏳ PENDING (native C++ work)
└── M0: JNI bridge implementation      ⏳ PENDING (native C++ work)
    Result: Basic offline chat works ✓

Sprint 3: Sync & Polish (Week 5-6)
├── M8: Memory sync protocol           ✅ COMPLETE (2025-12-04)
├── M3: Multiple server profiles       ⏳ PENDING
├── M6: Offline resilience (queue)     ⏳ PENDING (partially done via M8)
└── UI polish & testing                ⏳ PENDING
    Result: Full three-tier system ✓
```

---

## Implementation Progress Log

### 2025-12-04: Sprint 1 Partial Complete

#### Phase M1: Configurable Server URL ✅
**Files Created:**
- `apps/site/src/lib/client/api-config.ts` - Dynamic server URL management
  - `initServerUrl()` - Initialize from Capacitor Preferences on app start
  - `setServerUrl(url)` - Save server URL persistently
  - `testServerConnection(url)` - Test connectivity with latency measurement
  - `isCapacitorNative()` - Platform detection (web vs mobile)
  - `getDefaultServers()` - Returns preset server options (home/cloud)
  - `apiUrl(path)` - Build full URL from API path
  - `apiFetch(path, init)` - Fetch wrapper with correct base URL
  - `apiEventSource(path)` - EventSource wrapper for streaming

**Packages Added:**
- `@capacitor/preferences` in `apps/mobile/package.json`
- `@capacitor/core`, `@capacitor/preferences` (dev) in `apps/site/package.json`

#### Phase M2: Server Health Detection ✅
**Files Created:**
- `apps/site/src/lib/client/server-health.ts` - Health monitoring service
  - `healthStatus` - Svelte writable store with connection status
  - `checkHealth()` - Single health check with latency
  - `startHealthMonitor()` - Periodic monitoring (30s interval)
  - `stopHealthMonitor()` - Stop monitoring
  - `forceHealthCheck()` - Immediate check
  - `getQualityColor/Label/Emoji()` - UI helpers
  - Quality tiers: excellent (<100ms), good (<250ms), fair (<500ms), poor (<1000ms), offline
  - Auto-pauses when browser tab is hidden

- `apps/site/src/components/ServerHealthIndicator.svelte` - Compact health indicator
  - Shows connection quality dot (color-coded)
  - Click to force refresh
  - Shows latency in non-compact mode

- `apps/site/src/components/ServerSettings.svelte` - Full server configuration UI
  - Connection status with live updates
  - Server selection (Home/Cloud/Custom)
  - Test connection button
  - Tier info documentation
  - **MOBILE-ONLY**: Only accessible in Capacitor native app

**Files Modified:**
- `apps/site/src/components/CenterContent.svelte`
  - Added `isMobileApp` detection via `isCapacitorNative()`
  - Added conditional "📡 Server" tab under System settings
  - Tab only appears when running in mobile app
  - Web server UI remains unchanged

**Architecture Decision:**
- Web server code unchanged - "Server" tab only shows when `isCapacitorNative() === true`
- Shared code lives in `apps/site/src/lib/client/` with runtime platform detection
- Mobile gets full server configuration; web uses relative URLs automatically

#### Phase M7: Tier Selection Engine ✅
**Files Created:**
- `apps/site/src/lib/client/tier-selection.ts` - Automatic compute tier selection
  - Three tiers defined: offline (Qwen3-1.7B), server (Qwen3:14B), cloud (Qwen3-Coder-30B)
  - `selectBestTier()` - Auto-select based on connectivity, battery, task requirements
  - `initTierSelection()` - Initialize with periodic status checks (60s)
  - `setSelectionMode()` - Set auto/prefer-offline/prefer-server/prefer-cloud/manual
  - `tierStatuses` - Svelte store tracking availability of each tier
  - `deviceStatus` - Svelte store with battery level, network type, save data mode
  - `selectedTier` - Svelte store with currently active tier
  - Device status detection via Browser APIs and optional @capacitor/device
  - Intelligent fallback: low battery → offline, slow network → offline, server latency high → cloud

- `apps/site/src/lib/client/plugins/native-llm.ts` - On-device LLM plugin interface
  - TypeScript interface for Capacitor native plugin (future JNI/llama.cpp)
  - Methods: `loadModel()`, `generate()`, `chat()`, `listModels()`, `downloadModel()`
  - Event listeners for download progress and streaming tokens
  - Graceful web fallback via `native-llm-web.ts`

- `apps/site/src/lib/client/plugins/native-llm-web.ts` - Web fallback for native LLM
  - No-op implementations for web platform
  - All methods return "not available" responses

- `apps/site/src/components/TierSelector.svelte` - Tier selection UI
  - Full mode: Shows all 3 tier cards with status, latency, capabilities
  - Compact mode: Just icon and name for header/sidebar use
  - Selection mode picker (Auto, Prefer Offline, Prefer Server, Manual)
  - Device status display (battery, network type, data saver)
  - Auto-refresh with selection reason display

**Files Modified:**
- `apps/site/src/components/ServerSettings.svelte`
  - Integrated TierSelector component in Compute Tier section
  - Added import for TierSelector

**Tier Selection Logic:**
1. Check all tier availability in parallel
2. Filter by capability requirements (e.g., 'code' requires server or cloud)
3. Filter by device constraints (battery, network)
4. Apply selection mode preferences
5. Auto mode uses smart heuristics:
   - Low battery (<15%) → prefer offline
   - Data saver enabled → prefer offline
   - Slow network (2G) → prefer offline
   - High server latency (>2000ms) → try cloud or offline
   - Default: server > cloud > offline by priority

#### Phase M8: Memory Sync Protocol ✅
**Files Created:**
- `apps/site/src/lib/client/memory-sync.ts` - Bi-directional memory sync
  - Local-first architecture: All changes saved locally first
  - `saveMemoryLocally()`, `updateMemoryLocally()`, `deleteMemoryLocally()` - Local CRUD
  - `addToQueue()` - Queue changes for sync when offline
  - `performSync()` - Push pending changes, pull server updates
  - `syncState` Svelte store - Track pending count, conflicts, sync status
  - `hasPendingChanges`, `hasConflicts` - Derived stores for UI
  - Conflict detection and resolution (server-wins default, manual option)
  - Background sync every 30 seconds when connected
  - Automatic sync trigger on `online` event
  - Uses Capacitor Preferences for mobile, localStorage for web

- `apps/site/src/components/SyncStatus.svelte` - Sync status UI
  - Compact mode: Icon with badge for pending/conflict count
  - Full mode: Detailed status with last sync time, pending changes, conflicts
  - Force sync button
  - Conflict resolution modal (keep local / keep server)

- `apps/site/src/pages/api/memory/sync/push.ts` - Server push endpoint
  - POST: Create new memories from mobile
  - PUT: Update existing memories
  - Conflict detection for existing memories
  - Audit logging for all sync operations

- `apps/site/src/pages/api/memory/sync/pull.ts` - Server pull endpoint
  - GET: Fetch memories modified since timestamp
  - Incremental sync with limit/pagination
  - Filter by memory type

- `apps/site/src/pages/api/memory/sync/[id].ts` - Individual memory endpoint
  - DELETE: Soft delete (archive) memory
  - GET: Check if memory exists

**Files Modified:**
- `apps/site/src/components/ServerSettings.svelte`
  - Added SyncStatus component in Memory Sync section
  - Shows sync status for mobile users

**Sync Protocol:**
1. User creates/updates memory → Saved locally with `syncStatus: 'pending'`
2. Background sync checks every 30s (or on `online` event)
3. Push: Send pending changes to server
4. Pull: Fetch server changes since `lastSyncTimestamp`
5. Conflict resolution: Server-wins by default, or manual resolution
6. Update local `syncStatus` to 'synced' on success

#### Phase M0: On-Device LLM Framework ✅ (Interface Complete)
**Files Created:**
- `apps/site/src/lib/client/plugins/native-llm.ts` - TypeScript plugin interface
  - `NativeLLMPlugin` interface with full API
  - `NativeLLMWrapper` class for unified access
  - Methods: `loadModel()`, `unloadModel()`, `isModelLoaded()`, `generate()`, `chat()`
  - Methods: `listModels()`, `downloadModel()`, `deleteModel()`
  - Event listeners: `downloadProgress`, `generateProgress`
  - Automatic platform detection (native vs web fallback)

- `apps/site/src/lib/client/plugins/native-llm-web.ts` - Web fallback implementation
  - No-op implementations for non-native platforms
  - Returns empty/error responses gracefully

- `apps/mobile/android/app/src/main/java/com/metahuman/os/plugins/llm/NativeLLMPlugin.kt` - Android native plugin
  - Capacitor plugin skeleton with @PluginMethod annotations
  - Methods: `isModelLoaded()`, `loadModel()`, `unloadModel()`, `generate()`, `chat()`
  - Methods: `listModels()`, `downloadModel()`, `deleteModel()`
  - Event emission: `downloadProgress` for download tracking
  - JNI stubs for future llama.cpp integration

- `apps/site/src/components/ModelManager.svelte` - Model management UI
  - Lists downloaded on-device models
  - Load/unload model controls
  - Download progress indicator
  - Available models catalog (Qwen3-1.7B, Qwen3-4B)
  - Mobile-only (gated by `isCapacitorNative()`)

**Files Modified:**
- `apps/mobile/android/app/src/main/java/com/metahuman/os/MainActivity.java`
  - Added import for NativeLLMPlugin
  - Registered plugin in `onCreate()`

- `apps/site/src/components/ServerSettings.svelte`
  - Added ModelManager component import
  - Added "On-Device AI" section with ModelManager

**Status: Interface Complete, Native Implementation Pending**
The TypeScript interface, Kotlin plugin skeleton, and UI are complete. The plugin currently returns simulated responses. Full llama.cpp integration requires:
1. Download and build llama.cpp for Android (CMake + NDK)
2. Write JNI bridge (C++ → Kotlin)
3. Implement model loading and inference in native code
4. Test on physical device with GGUF models

**Model Recommendations (Qwen3 family, consistent across tiers):**
- On-device: Qwen3-1.7B-Q4_K_M (~1.1GB) - good balance of quality/speed
- Alternative: Qwen3-4B-Q4_K_M (~2.5GB) - better quality, slower

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `apps/site/src/lib/client/server-health.ts` | Health monitoring |
| `apps/site/src/lib/client/server-profiles.ts` | Profile management |
| `apps/site/src/lib/client/offline-queue.ts` | Offline message queue |
| `apps/site/src/components/ServerSettings.svelte` | Settings UI |
| `apps/site/src/components/ServerPicker.svelte` | Quick server switch |
| `deploy/cloud/docker-compose.yml` | Cloud deployment |
| `deploy/cloud/Dockerfile` | Container image |

### Modified Files
| File | Changes |
|------|---------|
| `apps/site/src/lib/client/api-config.ts` | Dynamic base URL |
| `apps/site/src/components/LeftSidebar.svelte` | Add server status indicator |
| `apps/site/src/components/ChatInterface.svelte` | Offline handling |
| `apps/mobile/capacitor.config.ts` | Remove hardcoded URL |
| `apps/mobile/scripts/build-mobile.sh` | Build with env vars |

---

## Questions to Resolve

1. **Cloud VM provider**: DigitalOcean, Hetzner, Linode, or RunPod Pod?
2. **Storage for cloud**: Same network volume pattern or cloud storage (S3/R2)?
3. **Authentication**: How does mobile authenticate with cloud server?
4. **API key security**: How to safely store RunPod API key on mobile?
5. **Sync strategy**: Real-time sync or periodic batch sync for memories?
