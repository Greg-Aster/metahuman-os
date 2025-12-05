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
