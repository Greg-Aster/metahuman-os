# Memory Continuity Implementation Plan

This document captures the phased approach for upgrading MetaHuman OS’s conversation and tool memory to match the durability expected from top assistants (ChatGPT, Claude, Gemini, Qwen).

---

## Phase 1 – Capture Every Meaningful Event

| Task | Details |
|------|---------|
| Instrument file APIs | Update `/api/files/*` endpoints so each read/write creates a structured `captureEvent` (`type: 'file_read' | 'file_write'`). Include path, snippet/summary, initiating command. |
| Log code approvals | When `/api/code-approvals/*` applies or rejects a patch, emit events describing the change and outcome. |
| Log tool outputs | For search, web calls, or agents, generate synthetic events summarising inputs + outputs. |
| Synthetic chat messages | In `ChatInterface.svelte`, append hidden `role: 'tool'` messages whenever a tool action returns data so the LLM sees them in conversation. |
| Update vector index | After `captureEvent` writes to `profiles/<user>/memory/episodic`, append the entry to the embedding index (incremental insert or schedule). |

**Goal:** Every meaningful action is memorialised as soon as it happens.

---

## Phase 2 – Prompt Assembly (`/api/persona_chat`)

| Task | Details |
|------|---------|
| Rolling chat buffer | Extend `/api/chat/history` to return the last N turns (e.g., 20) plus an optional summary string. |
| Merge local cache | On the client, merge server history with local cached responses to ensure continuity after refresh. |
| Memory retrieval hook | Before calling the LLM, run vector search (top 3–5 hits) scoped to the user’s profile using the latest user message (and previous assistant turn) as the query. Inject results into the prompt. |
| Tool snippets | Include the Phase 1 synthetic tool messages in the prompt under a “Recent actions” section. |
| Prompt template | Compose the final prompt from: system instructions, persona/profile info, trust/mode info, recent chat turns, conversation summary, retrieved memories, and tool snippets. |

**Goal:** The LLM always sees the relevant history + artefacts, not just the latest user message.

---

## Phase 3 – Summaries & Long-Term Context

| Task | Details |
|------|---------|
| Conversation summariser | Build an agent/API that periodically summarises older chat segments and stores them under `profiles/<user>/memory/semantic/chat/<timestamp>.json`. |
| Prompt integration | `/api/chat/history` returns `summary` text (latest summary). When the raw conversation exceeds the token budget, include the summary instead of verbatim turns. |
| Project summaries | When significant file work completes, auto-generate `type: 'project_summary'` events referencing involved files/tasks. |
| Embedding health checks | Add a scheduled agent to verify every episodic entry has an embedding; rebuild missing ones and log issues. |

**Goal:** Keep long-running sessions coherent without exceeding context limits.

---

## Phase 4 – Profile & Role Awareness

| Task | Details |
|------|---------|
| Persona injection | Always load persona files from `profiles/<user>/persona/*` and add them to the prompt header (name, tone, preferences). |
| Mode & trust context | Provide the current cognitive mode, trust level, and role (`owner`, `guest`, `anonymous`) in the instruction block. Ensure guests are explicitly read-only. |
| Profile selection changes | When guests switch public profiles, update the prompt metadata so the LLM knows which persona it is representing. |

**Goal:** Prompts are aware of the active profile and respect role-based constraints.

---

## Phase 5 – Observability & Testing

| Task | Details |
|------|---------|
| Memory miss log | When the assistant says “I don’t remember,” log the query, run a memory search, and store whether relevant events existed. Use this to detect capture/ retrieval failures. |
| Regression script | Automate a workflow: “open file → summarise → modify → ask later.” Verify events on disk, embeddings in the index, and prompt assembly. |
| Metrics widget | Optional dashboard showing last capture timestamp, embedding count, conversation summary age, and recent memory misses for quick health checks. |

**Goal:** Quickly detect when the memory pipeline regresses.

---

## Suggested Implementation Order
1. Phase 1 (logging) – immediate improvement with minimal risk.  
2. Phase 2 (prompt assembly) – yields tangible “remembers what happened” behaviour.  
3. Phase 3 (summaries) – necessary for long sessions.  
4. Phase 4 (profile/role awareness) – keeps multi-user flows accurate.  
5. Phase 5 (observability) – ensures reliability over time.

By following these phases, MetaHuman OS gains the layered memory architecture used by leading assistants: everything is captured, indexed, and selectively woven back into each LLM call.***
