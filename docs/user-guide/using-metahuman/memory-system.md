# Memory System

The memory system is the core of MetaHuman OS. It stores conversations, observations, tasks, and supporting artifacts as human-readable JSON so your data stays local and inspectable.

## Where Memories Live

Memories are stored per user under:

```
profiles/<username>/memory/
```

If you use external or encrypted storage, the profile root may be relocated. You can inspect or change the storage path with:

```bash
./bin/mh profile path
./bin/mh profile path set /path/to/storage
```

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
