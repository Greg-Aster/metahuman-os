# Reasoning Service Consolidation Plan

## 1. Current Reasoning Surfaces

| Area | Location | Purpose | Notes / Gaps |
|------|----------|---------|--------------|
| **Chat UI Reasoning Slider** | `apps/site/src/components/ChatInterface.svelte` (`reasoningDepth`, SSE `reasoning` messages) | Lets the user pick “Off/Quick/Focused/Deep” and shows streaming thought bubbles. | Purely visual; it does not influence how the backend reasons beyond toggling `reasoningDepth` in the payload. |
| **Persona Chat (legacy UI)** | `apps/site/src/components/PersonaChat.svelte` | Checkbox to enable “reasoning” before sending `/api/persona_chat`. | Same limitation: no shared engine, only a flag. |
| **Operator (ReAct) Agent** | `brain/agents/operator-react.ts` | Implements a scratchpad-like loop with hard-coded heuristics (first action, observation formatter, conversational response). | No shared catalog; reasoning output is freeform text; retry logic is minimal. |
| **Legacy Operator** | `brain/agents/operator.ts` / `operator-legacy.ts` (unused but still present) | Original planner (multi-step) with its own prompts and structures. | Dead code but still compiled; duplicates logic. |
| **Reflector Agent** | `brain/agents/reflector.ts` | Multi-step “associative chain” across memories. | Not tool-driven, but still has reasoning-style logging that could benefit from shared telemetry. |
| **Dreamer Agent** | `brain/agents/dreamer.ts` | Curates memories, generates dreams/insights, performs extraction. | Recently added activity heartbeats; no scratchpad but could reuse shared reasoning prompts for extraction steps. |
| **Other Skills / CLI** | `brain/skills/*`, `packages/cli/src/...` | Some CLI commands use “reasoning” text fields (e.g., auto-approver reasons). | Not standardized; ad-hoc strings. |
| **CenterContent Thinking Indicator** | `apps/site/src/components/CenterContent.svelte` references `reasoning` SSE events. | Displays progress bars when operator is “thinking”. | Depends on `reasoning` role from SSE but backend doesn’t emit structured stages consistently. |

### Pain Points
1. Multiple definitions of “reasoning” (UI flags vs. backend loops).
2. No centralized prompt/tool catalog, so each agent drifts stylistically.
3. Reasoning logs are scattered; some agents dump to console, others to SSE.
4. Hard-coded heuristics (e.g., “first action must be X”) lead to brittle behavior.

## 2. Target Architecture

### Service Layer
- **`packages/core/src/reasoning` module** responsible for:
  - Loading & caching tool manifests (`brain/skills`).
  - Managing scratchpad (Thought/Action/Observation) entries.
  - Generating prompts for planners (with consistent JSON schema).
  - Validating planner output (`{ thought, action?, respond?, responseStyle? }`).
  - Handling retries (invalid JSON, repeated tool failures).
  - Emitting structured events (for SSE/UI + audit logs).

### Consumers
- **Operator agent** instantiates `ReasoningEngine` per chat session.
- **Reflector/Dreamer** can opt-in for certain sub-tasks (e.g., summary generation) by calling the same engine with a smaller tool set.
- **CLI/API** can invoke reasoning flows (e.g., `mh task diagnose`) using the same service, ensuring consistent behavior.

### UI Integration
- Reasoning slider maps to `reasoningDepth` in the `ReasoningEngine` config (controls max iterations, verbosity).
- SSE “reasoning” events are produced by the engine whenever it adds a scratchpad entry, so all clients (ChatInterface, CenterContent) receive a consistent stream.

## 3. Implementation Plan
1. **Create Core Module**
   - `packages/core/src/reasoning/index.ts` exposing `ReasoningEngine`.
   - Submodules: `tool-catalog.ts`, `scratchpad.ts`, `planner.ts`, `validators.ts`.
2. **Tool Catalog**
   - Load manifests with `import.meta.glob` (Vite) or Node FS depending on environment.
   - Cache per process; invalidate by hashing manifest file timestamps (store hash in `ReasoningEngine`).
   - Provide text snippets + JSON schemas for prompts.
3. **Planner Contract**
   - Define JSON schema, e.g.:
     ```ts
     interface PlannerStep {
       thought: string;
       action?: { tool: string; args: Record<string, any> };
       respond?: boolean;
       responseStyle?: 'strict' | 'default' | 'summary';
     }
     ```
   - Add validator (AJV or manual) and automatic re-try when invalid.
4. **Observation Handling**
   - Standardize `Observation` structure (raw outputs, summarized text, errors).
   - Provide helper `formatObservation({mode, outputs})`.
   - Emit events via callback (for SSE) and keep trimmed history (e.g., last 10 entries to avoid context blow-up).
5. **Error & Retry Logic**
   - Wrap `executeSkill` so all errors return `{success:false,error:{code,message}}`.
   - Track consecutive failures per tool; advise planner when a tool is failing (inject hint into prompt).
6. **Response Modes**
   - If `respond` is true:
     - `responseStyle==='strict'`: bypass LLM, render structured output (with sanitized Markdown/JSON).
     - Else call `conversational_response` with prompt template referencing scratchpad summary + user goal.
7. **Telemetry & Logging**
   - Add `reasoning_events` channel (e.g., `logs/run/reasoning/<session>.ndjson`).
   - Provide SSE adapter in `/api/chat/stream` so the UI sliders receive updates.
   - Ensure logs can be disabled or redacted in production (env flag).
8. **Migration Steps**
   - Refactor `operator-react` to use the new engine (behind feature flag).
   - Update SSE event producers to consume new engine callbacks.
   - Deprecate legacy operator code once parity is verified.
   - Optionally, refactor dreamer/reflector to reuse partial features (tool catalog, logging) later.

## 4. Open Questions / Decisions Needed
1. **Where to store per-profile preferences (reasoning depth, max iterations)?**  
   Proposal: keep in `memory/state/chatPrefs.json` per user.
2. **Should dreamer/reflector adopt the full engine or just parts?**  
   Likely start with operator only; evaluate re-use after stabilization.
3. **Do we need GPU-specific optimizations (e.g., separate planner model) before rollout?**  
   Determine once we test latency with qwen3-coder vs. persona models.
4. **Security / Privacy:**  
   Ensure scratchpad logs don’t leak sensitive user data; possibly hash file paths or allow opt-out.

## 5. Next Steps
1. Approve this plan and create tickets:
   - Core reasoning module
   - Operator integration
   - UI/SSE updates
   - Telemetry + docs
2. Build the module behind a feature flag and ship incrementally.
3. After verification (see `reactive-operator-refactor-verification.md`), remove legacy code paths and retire per-agent reasoning logic.
