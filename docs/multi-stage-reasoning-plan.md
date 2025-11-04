---
title: Multi-Stage Reasoning Roadmap
date: 2025-10-29
owner: greggles
status: draft
---

# Goal
Give the chat pipeline configurable multi-stage reasoning comparable to GPT “deliberate”, Gemini “thinking”, Claude “constitutional” or DeepSeek’s verified plans. Users should select a depth in the UI and see each planning step stream in real time, while the back-end loops through planner → critic → (optional) evidence → plan refinement before producing the final answer.

# Current State
- Reasoning slider (Off→Quick→Focused→Deep) sends `reasoningDepth` to `/api/persona_chat`.
- Server runs a single planner pass followed by a final answer; longer depths only alter prompt verbosity and token limits.
- UI shows one reasoning blob per turn; no notion of stages or critiques.

# Target Pipeline
```
for round in 1..depth
  planner -> JSON {steps, confidence, blockers, openQuestions}
  critic  -> JSON {issues, required info, confidence, continue?}
  optional evidence/tool step (if critic requires)
  merge notes, append to history, emit SSE stage
  break early if critic satisfied
final responder -> user-facing answer + summary
```

# Implementation Steps
1. **Shared configuration**
   - Add `reasoning` block to `etc/agent.json` (`maxRounds`, `defaultDepth`, `critiqueEnabled`, `autoStopConfidence`, token budgets).
   - Extend `@metahuman/core` config loader if needed.

2. **UI enhancements (`ChatInterface.svelte`)**
   - Slider already present; add mode selector (fixed vs auto).
   - Render stacked reasoning stages with labels (Plan #, Critique, Evidence, Summary).
   - Collapse previous stages, keep live stage expanded.
   - Persist preferences in `chatPrefs`.

3. **SSE protocol**
   - Current `reasoning` payload is a string; change to `{ round, stage, content }`.
   - Update frontend to handle both old and new shape during migration.

4. **Back-end orchestration (`persona_chat.ts`)**
   - Wrap planner/answer in loop based on desired rounds.
   - Prompts:
     - Planner: structured JSON, include `confidence`, `blockers`, `actions`.
     - Critic: evaluate plan, request missing info, optionally mark `approve`.
     - Evidence step (optional): if critic returns `requests`, call helper to fetch memories/tools and append results.
     - Refiner: feed prior plan + critique + evidence, generate updated plan (or mark no changes).
   - Maintain shared `history` array; append each plan/critique snippet.
   - Emit SSE events with `{round, stage, content}` after each step.
   - Final answer prompt uses final plan; include short rationale summary for UI when slider depth > 0.
   - Guardrails: enforce per-stage `num_predict`, detect stalled loops, respect `maxRounds`.

5. **Testing**
   - Add manual script (`apps/site/scripts/test-reasoning.ts`) to hit API with different depths and log stages.
   - Update docs/guide with usage notes.
   - Smoke test conversation with slider Off/Quick/Deep.

# Open Questions
- Evidence step: initial version could be a stub returning `[]`; fill later with real memory/tool queries.
- Logging: include stages in audit logs or separate `logs/reasoning`?
- Should “Deep” run until critic confidence ≥ threshold, even if > slider rounds?

# Next Steps
1. Implement SSE payload changes + UI handler.
2. Add looped planner/critic pipeline.
3. Integrate config defaults and guard rails.
4. Document usage in `docs/chatinterface_modification_guide.md` once feature is stable.

