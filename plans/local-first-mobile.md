# Local-First Architecture Fix

## Vision
The mobile APK and web app are the SAME program from the same codebase. The APK is a **full-featured, standalone program** - not a thin client. When the main server is down, the app continues working using alternative LLM backends (RunPod, Claude, local models).

## Architecture Principles

1. **Single Codebase** - Astro compiles to both SSR (web server) and static (APK)
2. **Full Program in APK** - All features work offline with local data
3. **Profile Lives on Device** - User data, memories, tasks stored locally
4. **LLM Bridge** - Routes to available backend (main server, RunPod, Claude, local)
5. **Server as Hub** - Optional sync point, not required for operation
6. **Login = Profile Sync** - New device downloads profile at first login

---

## Current Problems

### 1. UI Reads from Server APIs
- ChatInterface calls `/api/conversation-buffer` on server
- Memory browser calls `/api/memories` on server
- Tasks call `/api/task/*` on server
- **Should**: Read from local IndexedDB first

### 2. LLM Calls Go Direct to Server
- Chat sends messages to `/api/persona_chat`
- Operator calls `/api/operator-react`
- **Should**: Go through LLM bridge that selects available backend

### 3. Login Doesn't Sync Profile
- New device login creates session but doesn't download data
- **Should**: Trigger full profile download for new devices

### 4. No Alternative LLM Backends
- App dies when main server's Ollama is unreachable
- **Should**: Fall back to RunPod, Claude API, or local GGUF

---

## Fix Plan

### Phase 1: Login-Time Profile Sync

**Goal**: When user logs in on a new device, download their full profile.

#### 1.1 Detect "new device" state
- **File**: `apps/site/src/components/AuthGate.svelte`
- After successful login, check if local profile exists
- If no local profile for this user → trigger full download
- Show progress UI during download

#### 1.2 Profile download on login
- Already have `downloadProfile()` in `profile-sync.ts`
- Wire it into login flow after successful auth
- Progress: metadata → persona → memories → tasks

#### 1.3 Settings integration
- **File**: `apps/site/src/components/RightSidebar.svelte` or settings panel
- Add "Profile Sync" section:
  - Last sync timestamp
  - Pending uploads count
  - "Sync Now" button
  - "Re-download Profile" button
  - WiFi-only toggle
  - Auto-sync interval

### Phase 2: Local-First Data Layer

**Goal**: All UI reads from local IndexedDB, writes locally first.

#### 2.1 Chat reads from local buffer
- **File**: `apps/site/src/components/ChatInterface.svelte`
- `onMount`: Load from `getConversationBuffer('conversation')`
- When server buffer updates, merge into local
- Show "offline" indicator when disconnected

#### 2.2 Chat writes locally first
- User sends message → Save to local buffer immediately
- Then: Try to send to server
- If server fails: Queue for later sync
- Message appears instantly regardless of server

#### 2.3 Memory browser reads local
- **File**: `apps/site/src/components/CenterContent.svelte`
- Load from `getRecentMemories()` / `getMemoriesByType()`
- Show local data instantly
- Background: Check server for new memories

#### 2.4 Task manager reads/writes local
- **File**: `apps/site/src/components/TaskManager.svelte`
- CRUD → IndexedDB first
- Background sync to server

### Phase 3: LLM Bridge

**Goal**: Route LLM calls to any available backend.

#### 3.1 Create LLM bridge service
- **File**: `apps/site/src/lib/client/llm-bridge.ts` (new)
- Backends: MainServer, RunPod, Claude API, Local (NativeLLM)
- Priority order configurable in settings
- Auto-fallback when primary unavailable

#### 3.2 Backend configurations
```typescript
interface LLMBackend {
  id: string;
  name: string;
  type: 'main-server' | 'runpod' | 'claude' | 'local';
  endpoint?: string;
  apiKey?: string;
  enabled: boolean;
  priority: number;
}
```

#### 3.3 Refactor chat to use bridge
- **File**: `apps/site/src/lib/client/unified-chat.ts`
- Instead of calling `/api/persona_chat` directly
- Call `llmBridge.generate(messages, options)`
- Bridge selects backend and makes the call

#### 3.4 Settings UI for backends
- Add/configure LLM backends
- Test connection
- Set priority order
- Enable/disable individually

### Phase 4: Offline Operation

**Goal**: App fully functional when all servers are down.

#### 4.1 On-device LLM
- Use NativeLLM plugin with GGUF model
- Download model on first setup
- Works completely offline

#### 4.2 Offline persona chat
- Load persona from local IndexedDB
- Build context from local memories
- Send to local LLM
- Save response to local buffer

#### 4.3 Queue for later sync
- All actions queued in IndexedDB
- When connectivity returns, sync queue
- Show pending count in UI

---

## File Changes

### Core Architecture
| File | Change |
|------|--------|
| `AuthGate.svelte` | Add profile download after login |
| `ChatInterface.svelte` | Read/write local buffer first |
| `CenterContent.svelte` | Read local memories |
| `TaskManager.svelte` | Read/write local tasks |
| `unified-chat.ts` | Route through LLM bridge |

### New Files
| File | Purpose |
|------|---------|
| `lib/client/llm-bridge.ts` | Multi-backend LLM routing |
| `lib/client/sync-queue.ts` | Persistent action queue |
| `components/SyncSettings.svelte` | Settings UI for sync |
| `components/LLMBackendSettings.svelte` | Settings UI for backends |

### Settings Integration
- Profile sync options in settings panel
- LLM backend configuration
- Offline mode preferences

---

## Implementation Order

### Immediate (Fix Broken State)
1. **Login-time sync** - Download profile for new devices
2. **Chat local-first** - Read/write local buffer

### Short-term (Full Offline)
3. **Memory browser local** - Read from IndexedDB
4. **LLM bridge** - Route to available backend

### Medium-term (Polish)
5. **Task manager local** - Full offline tasks
6. **Settings UI** - Configure sync and backends

### Future (Advanced)
7. **On-device LLM** - GGUF model support
8. **P2P sync** - Device-to-device without server

---

## Success Criteria

1. ✅ New device login downloads full profile
2. ✅ Chat works with no server connection
3. ✅ App falls back to RunPod/Claude when main server down
4. ✅ All data persists on device
5. ✅ Sync happens automatically when conditions met
6. ✅ Settings panel has sync and backend options
7. ✅ Same code runs on web and APK
