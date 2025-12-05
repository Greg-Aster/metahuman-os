# Mobile Standalone Mode - Implementation Complete

**Date**: 2025-12-04
**Status**: Client-side framework complete, native integration pending

---

## Overview

The MetaHuman OS mobile app now has a complete three-tier architecture framework that enables independent operation when the home server is offline. The tiers are:

| Tier | Model | Use Case | Status |
|------|-------|----------|--------|
| **Offline** | Qwen3-1.7B (on-device) | No internet, airplane mode | Framework ready |
| **Server** | Qwen3:14B (Ollama) | Home network, full features | Working |
| **Cloud** | Qwen3-Coder-30B (RunPod) | Away from home, complex tasks | Endpoint ready |

---

## Completed Components

### Phase M1: Configurable Server URL ✅

**Purpose**: Allow mobile app to connect to different servers.

**Files**:
- [api-config.ts](../apps/site/src/lib/client/api-config.ts) - Dynamic URL management
  - `initServerUrl()` - Initialize from Capacitor Preferences
  - `setServerUrl(url)` - Persist server URL
  - `testServerConnection(url)` - Test with latency measurement
  - `isCapacitorNative()` - Platform detection
  - `apiFetch()` / `apiEventSource()` - URL-aware fetch wrappers

**Packages Added**:
- `@capacitor/preferences` (mobile)
- `@capacitor/core` (site dev dependency)

---

### Phase M2: Server Health Detection ✅

**Purpose**: Monitor server availability and connection quality.

**Files**:
- [server-health.ts](../apps/site/src/lib/client/server-health.ts) - Health monitoring
  - `healthStatus` - Svelte store with connection state
  - `checkHealth()` - Single health check
  - `startHealthMonitor()` / `stopHealthMonitor()` - Background monitoring (30s)
  - Quality tiers: excellent (<100ms), good (<250ms), fair (<500ms), poor (<1000ms), offline

- [ServerHealthIndicator.svelte](../apps/site/src/components/ServerHealthIndicator.svelte)
  - Compact color-coded status dot
  - Click to force refresh

- [ServerSettings.svelte](../apps/site/src/components/ServerSettings.svelte)
  - Full server configuration UI (mobile-only)
  - Server selection, test connection, tier info

---

### Phase M7: Tier Selection Engine ✅

**Purpose**: Automatically select optimal compute tier based on context.

**Files**:
- [tier-selection.ts](../apps/site/src/lib/client/tier-selection.ts) - Selection logic
  - `TIERS` - Tier definitions with capabilities
  - `selectBestTier()` - Auto-select based on connectivity, battery, task
  - `initTierSelection()` - Initialize with periodic checks (60s)
  - `setSelectionMode()` - auto/prefer-offline/prefer-server/prefer-cloud/manual
  - Svelte stores: `tierStatuses`, `deviceStatus`, `selectedTier`

- [TierSelector.svelte](../apps/site/src/components/TierSelector.svelte)
  - Full mode: Tier cards with status, latency, capabilities
  - Compact mode: Icon + name for header use
  - Mode picker and device status display

**Selection Heuristics**:
1. Low battery (<15%) → prefer offline
2. Data saver enabled → prefer offline
3. Slow network (2G) → prefer offline
4. High server latency (>2000ms) → try cloud or offline
5. Default priority: server > cloud > offline

---

### Phase M8: Memory Sync Protocol ✅

**Purpose**: Bi-directional sync between offline memories and server.

**Files**:
- [memory-sync.ts](../apps/site/src/lib/client/memory-sync.ts) - Sync engine
  - Local-first: All changes saved locally first
  - `saveMemoryLocally()`, `updateMemoryLocally()`, `deleteMemoryLocally()`
  - `addToQueue()` - Queue changes for offline sync
  - `performSync()` - Push pending, pull server updates
  - Svelte stores: `syncState`, `hasPendingChanges`, `hasConflicts`
  - Background sync every 30s, triggers on `online` event

- [SyncStatus.svelte](../apps/site/src/components/SyncStatus.svelte)
  - Compact: Icon + badge for pending/conflicts
  - Full: Detailed status, force sync button
  - Conflict resolution modal (keep local / keep server)

- [push.ts](../apps/site/src/pages/api/memory/sync/push.ts) - Server endpoint
  - POST: Create new memories
  - PUT: Update existing memories
  - Conflict detection, audit logging

- [pull.ts](../apps/site/src/pages/api/memory/sync/pull.ts) - Server endpoint
  - GET: Fetch memories since timestamp
  - Incremental sync with pagination

---

### Phase M0: On-Device LLM Framework ✅

**Purpose**: Run small LLM directly on Android for offline chat.

**Files**:
- [native-llm.ts](../apps/site/src/lib/client/plugins/native-llm.ts) - TypeScript interface
  - `NativeLLMPlugin` interface
  - `NativeLLMWrapper` class for unified access
  - Methods: `loadModel()`, `generate()`, `chat()`, `listModels()`, `downloadModel()`
  - Event listeners: `downloadProgress`, `generateProgress`

- [native-llm-web.ts](../apps/site/src/lib/client/plugins/native-llm-web.ts) - Web fallback
  - No-op implementations for browser

- [NativeLLMPlugin.kt](../apps/mobile/android/app/src/main/java/com/metahuman/os/plugins/llm/NativeLLMPlugin.kt) - Android plugin
  - Capacitor plugin skeleton
  - All @PluginMethod stubs ready
  - JNI placeholders for llama.cpp

- [ModelManager.svelte](../apps/site/src/components/ModelManager.svelte) - UI
  - Downloaded models list
  - Load/unload controls
  - Download progress
  - Model catalog (Qwen3-1.7B, Qwen3-4B)

- [MainActivity.java](../apps/mobile/android/app/src/main/java/com/metahuman/os/MainActivity.java) - Modified
  - Registers NativeLLMPlugin

---

## Architecture

### Code Sharing

```
apps/site/src/
├── components/           ← Shared Svelte (web + mobile)
│   ├── ServerSettings.svelte    ← Mobile-only sections gated
│   ├── TierSelector.svelte
│   ├── SyncStatus.svelte
│   └── ModelManager.svelte
├── lib/client/           ← Client-side shared code
│   ├── api-config.ts           ← Platform-aware URLs
│   ├── server-health.ts
│   ├── tier-selection.ts
│   ├── memory-sync.ts
│   └── plugins/
│       ├── native-llm.ts       ← Capacitor plugin interface
│       └── native-llm-web.ts   ← Web fallback
└── pages/api/            ← Server-only (excluded from mobile)
    └── memory/sync/
        ├── push.ts
        └── pull.ts
```

### Platform Gating

All mobile-specific features use runtime detection:

```typescript
import { isCapacitorNative } from '../lib/client/api-config';

// In component
let isMobileApp = false;
onMount(() => {
  isMobileApp = isCapacitorNative();
});

// In template
{#if isMobileApp}
  <MobileOnlyFeature />
{/if}
```

**Web server code is unchanged** - mobile features only appear in the Capacitor app.

### Build Separation

| Target | Config | Output | Purpose |
|--------|--------|--------|---------|
| Web Server | `astro.config.mjs` | `apps/site/dist/` | SSR for `./start.sh` |
| Mobile App | `astro.config.mobile.mjs` | `apps/mobile/www/` | Static for APK |

**Critical**: These outputs must never cross-contaminate.

---

## UI Integration

### ServerSettings.svelte Structure

```svelte
<div class="server-settings">
  <!-- Connection Status -->
  <ServerHealthIndicator />

  <!-- Server Selection -->
  <select> Home / Cloud / Custom </select>

  <!-- Compute Tier (mobile only) -->
  {#if isMobile}
    <TierSelector />
  {/if}

  <!-- Memory Sync (mobile only) -->
  {#if isMobile}
    <SyncStatus />
  {/if}

  <!-- On-Device AI (mobile only) -->
  {#if isMobile}
    <ModelManager />
  {/if}
</div>
```

### Access Path

Settings → System → Server (tab only visible on mobile)

---

## Data Flow

### Chat Message Flow (Three-Tier)

```
User Message
    │
    ▼
TierSelector.selectBestTier()
    │
    ├─► Offline: NativeLLM.chat() → Local response
    │
    ├─► Server: apiFetch('/api/persona_chat') → Server response
    │
    └─► Cloud: apiFetch('/api/persona_chat?tier=cloud') → RunPod response
    │
    ▼
Save to LocalMemory (always)
    │
    ▼
Queue for sync if offline
```

### Sync Flow

```
App Online Event / 30s Timer
    │
    ▼
performSync()
    │
    ├─► Push: POST /api/memory/sync/push (pending memories)
    │
    └─► Pull: GET /api/memory/sync/pull?since=<timestamp>
    │
    ▼
Update local syncStatus
    │
    ▼
Resolve conflicts (if any)
```

---

## Testing

### Verify Build

```bash
cd apps/site && pnpm build
# Should complete with no errors (warnings OK)
```

### Verify Mobile Build

```bash
cd apps/mobile && ./scripts/build-mobile.sh
# Should produce APK in android/app/build/outputs/apk/
```

### Manual Testing Checklist

- [ ] Web UI unchanged (no Server tab visible)
- [ ] Mobile app shows Server tab in Settings
- [ ] Server URL can be changed and persisted
- [ ] Health indicator shows correct status
- [ ] Tier selector responds to mode changes
- [ ] Sync status shows pending count
- [ ] Model manager lists available models

---

## Model Recommendations

All tiers use the **Qwen3 family** for consistent behavior:

| Tier | Model | Size | Speed | Quality |
|------|-------|------|-------|---------|
| Offline | Qwen3-1.7B-Q4_K_M | 1.1GB | ~18 tok/s | Very Good |
| Offline (alt) | Qwen3-4B-Q4_K_M | 2.5GB | ~8 tok/s | Excellent |
| Server | Qwen3:14B | - | ~20 tok/s | Excellent |
| Cloud | Qwen3-Coder-30B | - | ~15 tok/s | Superior |

---

## What's Working Now

1. **Server mode selection**: Mobile app can connect to home server or cloud
2. **Health monitoring**: Live connection quality with latency display
3. **Tier awareness**: App knows which tiers are available
4. **Sync infrastructure**: Local-first storage with server sync
5. **Model management UI**: Ready for when llama.cpp is integrated

---

## What's Not Working Yet

1. **Offline chat**: NativeLLMPlugin returns simulated responses
2. **Cloud tier**: RunPod endpoint not deployed
3. **Actual sync**: Server endpoints exist but not fully tested
4. **Model downloads**: Download URLs point to HuggingFace but native download not implemented

See [NEXT-STEPS.md](./NEXT-STEPS.md) for remaining work.
