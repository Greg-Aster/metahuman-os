# Memory System

The memory system is the core of MetaHuman OS. It stores conversations, observations, tasks, and supporting artifacts as human-readable JSON so your data stays local and inspectable.

## Where Memories Live

**⚠️ CRITICAL: Profile paths vary by user configuration**

Memories are stored per user, but the actual location depends on custom profile storage settings.

### Default Location

```
profiles/<username>/memory/
```

### Custom Profile Storage

**Many users have custom profile locations** for encrypted drives, external storage, or network mounts:

```
/media/user/STACK/metahuman-profiles/<username>/memory/        # Encrypted drive
/mnt/external/profiles/<username>/memory/                       # External storage
/media/nas/metahuman/<username>/memory/                         # Network storage
```

### Finding Your Actual Profile Location

**Never assume the default location.** Always use the profile resolution API:

```bash
# Check your actual profile path
./bin/mh profile path

# Or via API
import { getProfilePaths } from '@metahuman/core';
const paths = getProfilePaths('username');
console.log(paths.root);  // Shows actual location
```

**For developers:**
```typescript
import { getProfilePaths } from '@metahuman/core';

// CORRECT: Use getProfilePaths()
const profilePaths = getProfilePaths(username);
const memoryPath = profilePaths.episodic;

// WRONG: Never hardcode paths
const memoryPath = `profiles/${username}/memory/episodic/`;  // ❌ Will fail for custom storage
```

### Why This Matters

Users configure custom profile storage via `persona/users.json`:
```json
{
  "username": "user",
  "metadata": {
    "profileStorage": {
      "path": "/media/user/STACK/metahuman-profiles/user",
      "type": "encrypted",
      "fallbackBehavior": "error"
    }
  }
}
```

If you hardcode `profiles/<username>/`, you'll:
- ❌ Read wrong/missing data
- ❌ Write to wrong location
- ❌ Bypass encrypted storage
- ❌ Miss user's actual memories

**Storage Types:**
- `internal` - Default location in repo
- `external` - USB drive, network mount, or external location
- `encrypted` - LUKS, VeraCrypt, or AES-256 encrypted storage

See [Accounts & Security](../configuration-admin/accounts-security.md#custom-profile-storage) for full details.

## Memory Categories

Not every install uses every category, but common folders include:

- `episodic/` — Conversations and observations captured over time
- `tasks/` — Task records used by the task system
- `semantic/` / `procedural/` — Higher-level memory stores (used by agents/tools)
- `preferences/` — Long-lived preferences and settings derived from interactions
- `index/` — Embeddings index used for semantic search
- `audio/` — Audio inbox, transcripts, and archive
- `functions/` — Draft and verified multi-step workflows

## Capturing Memories

### Automatic (Chat)
All chat conversations are captured automatically from the web UI and CLI chat.

### Manual Capture (CLI)
```bash
./bin/mh capture "Met with Sarah about the ML project timeline"
```

### File Ingestion (CLI)
```bash
./bin/mh ingest /path/to/notes/
./bin/mh agent run ingestor
```

### Audio Ingestion (CLI)
```bash
./bin/mh audio ingest /path/to/recordings/
./bin/mh agent run transcriber
./bin/mh agent run audio-organizer
```

## Searching Memories

### Keyword Search
```bash
./bin/mh remember "design review"
```

### Semantic Search (Embeddings Index)
```bash
./bin/mh --user <username> index build
./bin/mh index query "when did I meet with Sarah?"
```

`mh remember` automatically uses semantic search if an index exists for the current user.

## Memory System Architecture

**Core Implementation**: `packages/core/src/memory.ts` (1,359 lines)

MetaHuman's memory system includes 12 specialized modules:

### Core Memory Functions
-  `memory.ts` - Main memory operations (capture, search, retrieve)
- `memory-validation.ts` - Schema validation and integrity checks
- `memory-cleanup.ts` - Pruning and archival
- `memory-policy.ts` - Access control and retention policies
- `memory-content-filter.ts` - Content filtering and safety
- `memory-metrics-cache.ts` - Performance metrics and caching

### Advanced Memory Features
- `intelligent-memory-retrieval.ts` - Smart semantic search with relevance ranking
- `function-memory.ts` - Remember function calls and tool usage
- `vector-index.ts` - Vector embeddings for semantic search
- `vector-index-queue.ts` - Background indexing queue
- `embeddings.ts` - Generate vector embeddings via Ollama
- `context-builder.ts` - Build conversation context from memories

### Memory Operations

**Create Memory** (via CLI or chat):
```bash
./bin/mh capture "Met with Sarah about the ML project"
```

**Search Memories**:
```bash
./bin/mh remember "ML project"
```

**Search Methods**:
1. **Semantic Search** (if index exists) - Vector similarity matching
2. **Keyword Search** (fallback) - Text pattern matching
3. **Tag Search** - Filter by tags added by organizer agent

## Background Agents

Several agents enrich and manage memory behind the scenes. Common examples:
- `organizer` (tags/entities and metadata enrichment)
- `transcriber` (audio transcription)
- `audio-organizer` (turns transcripts into structured memories)

Use these commands to inspect and control agents:
```bash
./bin/mh agent list
./bin/mh agent status
./bin/mh agent run <name>
```

## Next Steps

- [Task Management](task-management.md) for task-specific memory
- [Voice Features](voice-features.md) for audio workflows
- [Architecture](../advanced-features/architecture.md) for memory system details
