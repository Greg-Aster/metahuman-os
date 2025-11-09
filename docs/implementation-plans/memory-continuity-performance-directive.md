# Memory Continuity Performance Directive

**Audience:** metahuman agent operators  
**Context:** Memory continuity instrumentation (Phase 1–3) is live but recent changes introduced severe latency during chat, capture, and monitoring flows. This directive converts the recent performance audit into concrete work orders for the automation agent.

---

## Mission Objectives

1. **Preserve cognitive continuity features** (event capture, tool context, summaries, metrics).
2. **Restore responsive UX** for persona chats, operators, and dashboards (<1.5 s server response budget).
3. **Harden storage growth** so episodic memory, metrics, and summaries scale to millions of events without reprocessing.

All tasks must maintain existing safety guards (`canWriteMemory`, `conversationVisibility`, `contextDepth`) and keep owner data boundary intact.

---

## Workstream A — Recent Tool Cache

| Step | Instruction | Deliverable |
|------|-------------|-------------|
| A1 | Implement a lightweight append-only cache for tool invocations written at capture time. Recommended path: `profiles/<user>/state/recent-tools/<conversationId>.jsonl`. Include `{eventId, toolName, success, timestamp, snippetPath}`. | Streaming writer utility + directory manifest. |
| A2 | Update `captureEvent()` callers (persona tools, file ops, approvals) to write to the cache after episodic persistence using async, non-blocking FS. | PR touches the relevant API routes. |
| A3 | Refactor `packages/core/src/context-builder.ts` so `buildContextPackage()` reads the cache file (bounded to last 10 records per `contextDepth`) instead of scanning `memory/episodic`. Fallback to the old scan only if cache missing, and memoize per request. | `recentTools` population becomes O(records), not O(files). |
| A4 | When tool outputs exceed 2 KB, persist the full payload in `logs/tool-output/<eventId>.json` and keep only a 256 char summary + pointer in both episodic memory and the cache entry. Add a retention job to trim orphaned payload files. | Storage load test + documentation snippet. |

**Acceptance tests**
- Trigger three tool invocations and confirm `recentTools` materializes without enumerating episodic files (`DEBUG` log check).
- Validate guests only see two entries and no sensitive fields when `conversationVisibility` forbids it.

---

## Workstream B — Cached Memory Metrics

| Step | Instruction | Deliverable |
|------|-------------|-------------|
| B1 | Build a background task (`brain/agents/memory-metrics-cache.ts`) that runs every 5 minutes (or on demand) to compute the heavy metrics currently handled inline. Write results to `profiles/<user>/state/memory-metrics.json`, include `generatedAt` timestamp. | Agent script + scheduler hook. |
| B2 | Change `/api/memory-metrics` to serve the cached JSON, re-computing only when the cache is older than 10 minutes. All filesystem work must use `fs.promises` with proper error paths. | Updated API route. |
| B3 | Update `MemoryMetrics.svelte` so polling interval is ≥5 minutes and expose a manual “Refresh now” action. Show stale indicator when data age >15 minutes. | UI update + UX note. |

**Acceptance tests**
- Run agent once, hit `/api/memory-metrics`, and confirm response time <50 ms even with thousands of memories.
- Kill the agent; ensure API degrades gracefully (served stale cache + warning).

---

## Workstream C — Conversation Summarizer Backpressure

| Step | Instruction | Deliverable |
|------|-------------|-------------|
| C1 | After generating a summary block, rewrite the conversation buffer file to contain: summary marker `{type: 'summary', text, range}` followed by unsummarized tail messages. Record `lastSummarizedIndex` alongside the buffer to avoid reprocessing. | Updated buffer schema + migration script. |
| C2 | Ensure the summarizer agent skips execution when another run is in progress (lock already available) **and** when the last run finished <10 minutes ago to prevent thrash. | Lock TTL enforcement. |
| C3 | Modify `persona_chat.ts` to detect summary markers when reconstructing prompts: render “Conversation summary (messages 0–12): …” once, instead of replaying each historical message. Respect `conversationVisibility` before exposing the summary. | Prompt assembly update + tests. |

**Acceptance tests**
- Generate 30 chat turns. Verify buffer size stops growing after summarization and subsequent runs summarize only new messages.
- Confirm prompts contain a single summary paragraph plus the newest raw messages.

---

## Workstream D — Async I/O & Safety Net

1. Replace synchronous FS calls in hot paths (`captureEvent`, `context-builder`, `/api/memory-*`) with their `fs.promises` equivalents. Batch operations where possible.
2. Add tracing counters for: cache hits vs. fallback scans, metrics cache age, summarizer run duration. Emit to existing audit logger.
3. Stress test: simulate 5k episodic events + 200 tool outputs and confirm chat latency remains under SLA.

**Deliverables**
- Instrumentation dashboard snippet in `docs/memory-continuity-progress.md`.
- QA checklist enumerating regression tests (CLI task, guest chat, metrics widget).

---

## Completion Criteria

- All caches survive server restarts (no in-memory only solutions).
- Fallback paths remain functional but are logged as warnings for follow-up.
- Documentation updated (`memory-continuity-progress.md`) summarizing throughput gains.
- `./bin/audit check` runs clean and no new lint errors introduced.
