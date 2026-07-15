# MetaHuman OS Sync System

This document describes the synchronization system that enables data transfer between MetaHuman OS clients (desktop, mobile) and remote servers.

## Overview

The sync system is **agent-based**, meaning all sync operations are handled by background agents rather than client-side JavaScript. This architecture:

- Runs sync operations in the background without blocking the UI
- Provides consistent behavior across all platforms (desktop, mobile, web)
- Enables detailed logging and progress tracking
- Supports atomic operations with proper error handling
- Uses **incremental timestamp-based sync** to skip already-synced memories

## Performance: Incremental Sync

The sync system uses timestamp-based incremental sync to handle large memory collections efficiently:

| Sync Type | When Used | Performance |
|-----------|-----------|-------------|
| Incremental | After first sync | ⚡ Very fast - only checks new memories |
| First sync | No `lastMemorySyncAt` | Slower - sends exclusion list (limited to 100 IDs) |

**How it works:**
1. After a successful sync, `lastMemorySyncAt` is saved to `profiles/<username>/etc/sync-server.json`
2. On next sync, the agent passes `since=<timestamp>` to the server
3. Server filters by filename date prefix (YYYY-MM-DD) - no file reads needed
4. Only memories created AFTER the timestamp are returned

**Terminal output shows the mode:**
```
│  ⚡ Incremental sync (since 12/10/2024)   # Fast - using timestamp
│  📊 First sync - 1234 local memories       # Slower - first time setup
```

## Agents

### profile-sync

**Location:** `brain/agents/profile-sync.ts`

The primary sync agent that handles full profile synchronization. This agent **fully replaces** the legacy `syncFromRemoteServer()` client-side function.

#### What It Syncs

| Data Type | Description | Files |
|-----------|-------------|-------|
| Profile Bundle | Persona, identity, relationships | `persona/*.json` |
| Configuration | Settings, model registry | `etc/*.json` |
| Credentials | RunPod keys, LLM API keys | `etc/llm-credentials.json`, `etc/runpod.json` |
| Memories | Episodic memories, conversations | `memory/episodic/YYYY/*.json` |

#### Command Line Options

```bash
# Full sync (all data types)
./bin/mh agent run profile-sync

# Only download from server (no push)
./bin/mh agent run profile-sync -- --pull-only

# Only sync memories
./bin/mh agent run profile-sync -- --memories-only

# Only sync profile (skip memories)
./bin/mh agent run profile-sync -- --profile-only

# Force complete memory sync (ignore timestamp)
./bin/mh agent run profile-sync -- --full

# Skip device-specific configs (models.json, voice.json, etc.)
./bin/mh agent run profile-sync -- --skip-config

# Sync memories from last N days
./bin/mh agent run profile-sync -- --days=30

# Sync specific user
./bin/mh agent run profile-sync -- --user=greggles

# Login sync (persona + conversation buffer + memories, no config)
./bin/mh agent run profile-sync -- --pull-only --full --skip-config
```

#### Terminal Output

When running, you'll see formatted output like:

```
════════════════════════════════════════════════════════════
  PROFILE SYNC AGENT
════════════════════════════════════════════════════════════
  Started: 2025-12-13T10:30:00.000Z
  Mode: pull-only
  Time range: last 7 days

┌─ Syncing user: greggles
│  🌐 Server: https://mh.example.com
│  🔑 Authenticating...
│  ✓ Authenticated successfully
│  📦 Downloading profile bundle...
│  📄 Imported 12 profile files
│  🔐 Syncing credentials...
│  ✓ Credentials synced (RunPod, LLM keys, etc.)
│  🧠 Syncing memories...
│  📊 450 local memories (will be excluded)
│  ↓ Batch 1: +100 memories (100 total, 250 on server)
│  ↓ Batch 2: +100 memories (200 total, 250 on server)
│  ↓ Batch 3: +50 memories (250 total, 250 on server)
│  ✓ Imported 250 new memories
└─ ✓ User greggles sync complete

════════════════════════════════════════════════════════════
  SYNC COMPLETE
════════════════════════════════════════════════════════════
  📄 Profile files: 12
  🧠 Memories imported: 250
  🔐 Credentials: synced
  ⏱️  Finished: 2025-12-13T10:31:45.000Z

  ✓ No errors
```

### memory-sync

**Location:** `brain/agents/memory-sync.ts`

Lightweight agent for syncing only memories. Used on login for quick pull operations.

```bash
# Pull-only (used on login)
./bin/mh agent run memory-sync -- --pull-only

# Push-only (upload local memories)
./bin/mh agent run memory-sync -- --push-only

# Specific user
./bin/mh agent run memory-sync -- --user=greggles
```

## UI Integration

### SyncManager Component

**Location:** `apps/site/src/components/SyncManager.svelte`

The UI component that triggers agents and displays progress.

#### How It Works

1. User selects sync options (memories, profile, update check)
2. SyncManager triggers the appropriate agent via `/api/agents/run`
3. SyncManager polls `/api/profile-sync-state` for progress updates
4. Progress is displayed with animated UI feedback
5. Completion dialog shows results

#### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/run` | POST | Trigger an agent |
| `/api/profile-sync-state` | GET | Read current sync progress |
| `/api/update-state` | GET | Read update check results |

### Triggering Sync from Code

```typescript
// Trigger profile-sync agent
const response = await fetch('/api/agents/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent: 'profile-sync',
    args: ['--pull-only', '--days=7']
  })
});

const { success, pid } = await response.json();

// Poll for completion
const checkProgress = async () => {
  const state = await fetch('/api/profile-sync-state').then(r => r.json());
  if (state.phase === 'complete' || state.phase === 'error') {
    return state;
  }
  await new Promise(r => setTimeout(r, 1000));
  return checkProgress();
};

const result = await checkProgress();
```

## Server Configuration

Sync credentials are stored per-user in:
- Primary: `profiles/<username>/etc/sync-server.json`
- Legacy: `profiles/<username>/etc/remote-server.json`

```json
{
  "serverUrl": "https://mh.example.com",
  "username": "greggles",
  "password": "encrypted-or-plaintext",
  "lastSyncAt": "2025-12-13T10:30:00.000Z",
  "verified": true
}
```

## State Files

The sync system writes state files for UI polling:

| File | Agent | Contents |
|------|-------|----------|
| `logs/run/profile-sync-state.json` | profile-sync | Current phase, progress, results |
| `logs/run/memory-sync-state.json` | memory-sync | Memory sync progress |

Example state file:
```json
{
  "phase": "importing",
  "message": "Imported 150 memories...",
  "current": 150,
  "total": 250,
  "updatedAt": "2025-12-13T10:30:30.000Z"
}
```

Phases: `authenticating` → `fetching-profile` → `fetching-credentials` → `importing` → `complete` | `error`

## Event Flow

### On Login

1. User logs in via AuthGate
2. AuthGate triggers `profile-sync --pull-only --full --skip-config`
3. Agent syncs:
   - ✅ Persona files (`persona/*.json`)
   - ✅ Conversation buffer (`state/conversation-buffer-*.json`)
   - ✅ All memories (`memory/episodic/`)
   - ❌ Device configs (`etc/` - skipped to preserve local settings)
4. User sees their complete profile and conversation history

**Why these flags?**
- `--pull-only`: Only download, don't push local changes to server
- `--full`: Ignore `lastMemorySyncAt` timestamp, sync ALL memories (important for new devices)
- `--skip-config`: Don't overwrite device-specific configs (models.json, voice.json, etc.)

### Manual Sync (SyncManager)

1. User opens SyncManager
2. User selects options (memories, profile, update)
3. User clicks "Start Sync"
4. SyncManager triggers `profile-sync` agent
5. Progress is shown via sci-fi themed animations
6. Completion dialog shows results

### Scheduled Sync

Currently not implemented, but agents support it:
```json
{
  "profile-sync": {
    "type": "interval",
    "interval": 3600,
    "args": ["--pull-only", "--memories-only"]
  }
}
```

## Troubleshooting

### Agent Won't Start

Check for stale lock files:
```bash
ls -la logs/run/locks/
# If agent-profile-sync.lock exists but agent isn't running:
rm logs/run/locks/agent-profile-sync.lock
```

### View Agent Logs

```bash
# Real-time monitoring
tail -f logs/agents/profile-sync.log

# Or use CLI
./bin/mh agent logs profile-sync
```

### Test Server Connection

```bash
# Via CLI
curl -X POST https://mh.example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"greggles","password":"secret"}'
```

### Check Allowed Agents

Only agents listed in `ALLOWED_AGENTS` can be triggered via API:
- Location: `apps/site/src/pages/api/agents/run.ts`
- Current list: `profile-sync`, `memory-sync`, `organizer`, `reflector`, etc.

## Architecture Notes

### Why Agents Instead of Client-Side Code?

1. **Consistency**: Same behavior on desktop, mobile, web
2. **Background Processing**: Doesn't block UI
3. **Logging**: Detailed terminal output for debugging
4. **Atomicity**: Lock-based single-instance guarantee
5. **Audit Trail**: All operations logged to audit system

### Migration from Legacy Code

The following client-side functions have been replaced by agents:

| Legacy Function | Replaced By | Location |
|-----------------|-------------|----------|
| `syncFromRemoteServer()` | `profile-sync` agent | `lib/client/profile-sync.ts` (deprecated) |
| `performPullOnlySync()` | `memory-sync --pull-only` | `lib/client/profile-sync.ts` (deprecated) |

The legacy functions still exist but are no longer called from the main application flow.
