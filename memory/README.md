# Memory Schemas (Minimal)

This project uses simple JSON files for memories and tasks. Files are user‑owned data under `memory/`.

## Episodic Event (`memory/episodic/YYYY/*.json`)

Example
```
{
  "id": "evt-202510210030129",
  "timestamp": "2025-10-21T00:30:12.912Z",
  "content": "Met with Sarah about the ML project",
  "type": "observation",
  "entities": ["Sarah", "ML project"],
  "tags": ["meeting", "work"],
  "importance": 0.5,
  "links": [{ "type": "relates_to", "target": "task-20251020abcd" }]
}
```

Fields
- `id` string (unique id)
- `timestamp` ISO string
- `content` free text
- `type` optional string, default `observation`
- `entities` optional string[]
- `tags` optional string[]
- `importance` optional number 0..1
- `links` optional array of `{ type, target }`

## Task (`memory/tasks/{active|completed}/*.json`)

Example
```
{
  "id": "task-20251021101500",
  "title": "Implement morning brief agent",
  "description": "Generate daily brief and notify",
  "status": "todo",
  "priority": "P2",
  "due": null,
  "tags": ["agents"],
  "dependencies": [],
  "created": "2025-10-21T10:15:00.000Z",
  "updated": "2025-10-21T10:15:00.000Z",
  "completed": null
}
```

Fields
- `status` one of `todo|in_progress|blocked|done|cancelled`
- `priority` optional `P0|P1|P2|P3`
- `created` and `updated` ISO strings; `completed` optional ISO string

## Indexing

If enabled, a semantic index is written to `memory/index/embeddings-*.json` (see `@metahuman/core/vector-index`).

