# Functions Memory Orchestrator Plan

## 1. Objectives
1. Give the orchestrator a persistent catalog of “how-to” functions stored under each user profile so it can resolve ambiguous commands without hardcoding.
2. Automatically consult those functions during planning/routing, and learn new functions from successful executions.
3. Expose the functions as a first-class memory tab in the UI so users can inspect, edit, and share them.

## 2. Scope & Assumptions
- Applies to profile-specific memory roots (e.g., `profiles/<user>/memory/`).
- Leverages existing memory indexer & context builder (`getRelevantContext`, vector index).
- Works with both persona-only mode and ReAct operator mode.
- We keep `fs_write` validation rules; functions must reference allowed directories.

## 3. Data Model & Storage
### 3.1 Folder Layout
```
profiles/<user>/memory/functions/
  YYYY/
    function-<timestamp>-<slug>.json
```

### 3.2 JSON Schema (V1)
```json
{
  "id": "func-20251114-abc123",
  "title": "Create sandwich file in out/",
  "summary": "How to create a sandwich.txt file in out/ when user omits path",
  "steps": [
    "Default path to out/<filename>",
    "Use fs_write with overwrite=true if user explicitly says so"
  ],
  "examples": [
    {"prompt": "Make sandwich file", "resultPath": "out/sandwich.txt"}
  ],
  "skillsUsed": ["fs_list", "fs_write"],
  "createdAt": "...",
  "updatedAt": "...",
  "trust": "verified|draft",
  "tags": ["filesystem","fallback"]
}
```

### 3.3 Metadata for Indexing
- Embed `summary + steps` into vector index (tag as `function`).
- Store lightweight inverted index (JSON manifest) for quick keyword lookup (e.g., map `create file` → file IDs).

## 4. Retrieval Flow Changes
1. **Context Builder Hook**  
   - Modify `getRelevantContext` to always query `memory/functions/` alongside episodic memories.
   - Prioritize function entries when the user message contains verbs like `make`, `create`, `run`, or when previous operator attempt failed with `skill_execution_failed`.
2. **Planner Prompt Augmentation**  
   - If a function is returned, inject a `# Function Guide` section before the rest of context.
   - Encourage the LLM to adapt the steps rather than copying verbatim.
3. **Fallback Consultation**  
   - When the operator encounters repeated `Input 'path' failed validation` (or other known errors), trigger a “function lookup” retry before aborting.

## 5. Learning New Functions
1. **Capture Points**  
   - After a successful operator run that executed at least one skill, check if the user asked for a procedure lacking a matching function.
   - Evaluate who approved the actions (`trust level` must be ≥ supervised_auto).
2. **Function Generator**  
   - Build a summarizer that converts the operator report (plan + skill steps) into the JSON schema.
   - Auto-save into `memory/functions/` with `trust: draft`.
   - Optionally prompt the user (via UI toast) to confirm/promote the new function.
3. **Deduplication**  
   - Compute a hash of `skillsUsed + goal signature` to avoid duplicating near-identical guides.

## 6. UI & UX
1. **Memory Tab**  
   - Add “Functions” tab in the memory viewer (same grouping as Episodic/Semantic).  
   - Render cards with title, summary, tags, last-updated, quick search.
2. **Function Inspector**  
   - Show step-by-step instructions, examples, and allow editing (write back to JSON, regenerate embedding).
   - Provide CTA to “Promote Draft” or “Archive”.
3. **Operator Console Integration**  
   - When a function is used, display a chip (e.g., “Function: Create sandwich file”) in the operator monitor.

## 7. API & Backend Tasks
1. **File Utilities**  
   - Add helper in `@metahuman/core` to list/read/write function files (respecting profile sandbox).
2. **REST Endpoints**  
   - `/api/memory/functions/list`, `/api/memory/functions/:id`, `/api/memory/functions/promote`.
3. **Indexer Updates**  
   - Extend the background indexers to ingest new/updated function files and refresh embeddings.
4. **Event Logging**  
   - Audit when functions are referenced or created (`function_used`, `function_saved` events).

## 8. Implementation Milestones
1. **Foundations**
   - Create folder structure & schema docs.
   - Build CRUD helpers + embedder integration.
2. **Retrieval Integration**
   - Update context builder & planner prompt injection.
   - Add fallback lookup logic after repeated skill failures.
3. **Learning Pipeline**
   - Operator summary → function draft generator.
   - UI confirmation workflow.
4. **UI Surfaces**
   - Memory tab, inspector, and operator chip.
5. **Testing & Validation**
   - Unit tests for schema IO.
   - Smoke test: ask for “make sandwich file” with no path; verify the function guide is used and skill call passes.
   - Regression tests for curiosity + other memory flows to ensure no conflicts.

## 9. Open Questions / Risks
- Versioning of functions (do we keep history or just latest file?).
- How to handle conflicting functions (e.g., same task with different trust levels).
- Whether functions should sync between profiles or remain private.

## 10. Next Steps
1. Review this plan with stakeholders.
2. Once approved, spin a dedicated implementation ticket per milestone.
3. Schedule a short design session to finalize schema + UI mocks before coding.
