# Cognitive Pipeline Graph Execution Plan

**Status:** Draft (2025-11-18)  
**Owners:** greggles, Claude Code  
**Scope:** Phases 3–5 of the Node Editor project – replace the imperative pipeline in `persona_chat.ts` with graph-driven execution.

---

## Objectives

1. **Parity:** Reproduce the current persona pipeline (context → operator → safety → memory) as a LiteGraph graph without regressions.
2. **Configurability:** Load/save per-mode graphs (`dual`, `agent`, `emulation`) and allow custom overrides under `etc/cognitive-graphs/`.
3. **Execution:** Interpret graphs at runtime inside `/api/persona_chat`, feeding inputs (user message, context package) and collecting outputs (assistant response, metadata).
4. **Diagnostics:** Provide logging/visual traces so users can see which nodes ran, timings, and emitted data.

---

## Phase 3 – Template Graphs (In Progress)

### Deliverables
- `etc/cognitive-graphs/dual-mode.json`
- `etc/cognitive-graphs/agent-mode.json`
- `etc/cognitive-graphs/emulation-mode.json`

Each template must map 1:1 with the current TS pipeline:

| Mode | Flow Summary |
|------|--------------|
| Dual | UserInput → SessionContext → SystemSettings → ContextBuilder → ReAct loop (Planner ↔ Skill Executor ↔ Observation Formatter ↔ Completion Checker) → ResponseSynthesizer → Safety stack → MemoryCapture → StreamWriter |
| Agent | UserInput → SystemSettings → OperatorEligibility → branch: (Operator flow) OR (PersonaLLM → Safety → StreamWriter). |
| Emulation | UserInput → PersonaLLM → ChainOfThoughtStripper → SafetyValidator (read-only) → StreamWriter (no memory writes). |

### Tasks
1. Export the current hardcoded flow into JSON graphs using the schema from `node-schemas.ts`.
2. Validate templates load in the editor (no runtime errors) and visually match expectations.
3. Store templates under `etc/cognitive-graphs/` so they’re tracked in git.

---

## Phase 4 – Graph Persistence & API (In Progress)

### Files / Routes
- `apps/site/src/pages/api/cognitive-graphs.ts` (list/delete)
- `apps/site/src/pages/api/cognitive-graph.ts` (get/save)

### Deliverables
- ✅ REST APIs to list, load, save, and delete graphs (custom graphs stored under `etc/cognitive-graphs/custom/`)
- ✅ Node Editor UI hooks (Load Graph menu, save dialog wired to APIs, delete controls for custom graphs)
- 🔄 Auto-load template on mode change + merge workflows (pending)

### Features
1. **File schema**
   ```json
   {
     "version": "1.0",
     "name": "dual-mode",
     "description": "Default dual pipeline",
     "cognitiveMode": "dual",
     "graph": { "nodes": [], "links": [] }
   }
   ```
2. **Node Editor UI**
   - ✅ “Load Graph” dropdown lists custom graphs from API alongside templates.
   - ✅ “Save Graph” button persists custom graphs via POST.
   - ◻ Auto-load template when cognitive mode changes (future).
3. **Validation**
   - Basic schema validation server-side (ensure required fields, no duplicate IDs).
   - Reject graphs with missing start/end nodes.

---

## Phase 5 – Execution Engine

### 5.1 Runtime Executor
File: `apps/site/src/lib/cognitive-nodes/executor.ts`

Responsibilities:
1. **Graph Compilation**
   - Topological sort respecting links (detect cycles, max iterations = 10 for ReAct loops).
   - Build dependency map so `onExecute` receives resolved inputs.
2. **Context Injection**
   - Provide runtime inputs: `{ userMessage, sessionId, cognitiveMode, contextPackage, settings, systemPersona }`.
   - Allow nodes to read/write to a shared execution state (e.g., `executionContext.memoryEvents`).
3. **Async Support**
   - Await `onExecute` when it returns a Promise (LLM calls, skill APIs).
   - Propagate errors with context (node type, id) and stop execution gracefully.
4. **Outputs**
   - Define a contract for terminal nodes (e.g., `StreamWriter` must set `{ responseText, facet, metadata }`).
   - Executor returns `{ response, metadata, memoryEvents, auditEntries }`.

### 5.2 persona_chat Integration
1. ✅ Feature flag `USE_NODE_PIPELINE` now routes both chat and dual/agent (operator) paths through the graph when a valid template exists; legacy flow remains as fallback.
2. On each request:
   - Load graph for current mode (custom overrides in `etc/cognitive-graphs/custom/` take precedence; cache invalidates on file change).
   - Build execution inputs from user context, session id, conversation history snapshot, `contextPackage`, safety/policy flags, and routing hints (e.g., `useOperator`).
   - Run executor; if the graph fails or produces no response, fall back to legacy pipeline (TODO: add telemetry + error surfacing).
3. Current behavior:
   - Graph output streams as a standard `answer` SSE event; histories/buffers are updated just like the legacy path.
   - Memory/audit responsibilities are handled by graph nodes (respecting `allowMemoryWrites`).
   - Graph execution now emits telemetry: success durations, node-level errors, and fallback events (`graph_pipeline_failure`, `graph_pipeline_fallback`) are logged/audited before falling back to legacy.
   - Safety / refinement nodes still live in the legacy path; hooking them into the graph remains future work.

### 5.3 Instrumentation
- ✅ Execution trace log persisted to `logs/graph-traces.ndjson` (duration, status, node errors).
- ✅ Node Editor telemetry panel + `/api/graph-traces` endpoint expose recent traces.
- ◻ Optional live SSE channel to highlight nodes during real chat execution.

---

## Milestones & Tests

| Milestone | Validation |
|-----------|------------|
| Templates stored in `etc/cognitive-graphs` | Editor loads each template; JSON schema passes. |
| Persistence API | `GET/POST /api/cognitive-graph` tested via curl; graphs saved/loaded correctly. |
| Executor unit tests | Mock graph covering branching/async nodes (todo). |
| Emulation mode via graph | `USE_NODE_PIPELINE=1` + emulation graph returns same responses as legacy path. |
| Dual/Agent regression | `node scripts/graph-regression.mjs` compares outputs (legacy vs graph) and writes report to `logs/graph-regression/`. |

---

## Open Questions
1. **Shared State:** Do nodes need a shared KV store (e.g., to hand off LLM configs), or are inputs/outputs sufficient?
2. **Security:** How do we guarantee nodes respect memory policy (e.g., `MemoryCapture` only runs if mode allows writes)?
3. **Versioning:** How do we migrate old graphs when node schema changes?

---

## Next Steps
1. Finalize template JSONs (Phase 3) – ✅ once graphs load.
2. Implement persistence API + UI controls (Phase 4).
3. Build executor + feature-flagged integration in `persona_chat.ts`.
4. Run regression suite ensuring node pipeline matches legacy behavior before flipping default.
