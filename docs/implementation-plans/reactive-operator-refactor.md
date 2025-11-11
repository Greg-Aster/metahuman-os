# Reactive Operator Refactor & Tooling Upgrade

## Goals
- Stop hallucinated answers by forcing the assistant to cite *only* tool output when responding to factual queries (tasks, file listings, etc.).
- Give the LLM authority to plan, choose skills, and retry when something fails – mirroring GPT/Claude style “tool awareness.”
- Preserve multi–user support (everything runs inside `withUserContext`).
- Avoid hard-coding funnels (e.g., “task_list → conversational_response”), but still allow templated “verbatim” responses when the user clearly wants raw data.

## Current State
- `brain/agents/operator-react.ts` maintains a light ReAct loop but the prompt is generic. It rarely chains more than one skill before emitting an answer.
- The “observation” formatter converts tool outputs into narrative text, then we pass that to `conversational_response`, which embellishes freely.
- Skills throw errors, but the loop immediately gives up after `maxIterations` with no retry logic.
- Only one LLM (“default.coder”) is used for everything (planning, tool calls, final responses).

## Proposed Architecture
1. **Structured ReAct Scratchpad**
   - Maintain a running transcript with blocks like:
     ```
     Thought 1:
     Action 1: {"tool":"task_list","args":{...}}
     Observation 1: ...
     ```
   - The planner sees the entire scratchpad plus a “Tools Catalog” section (auto-generated from `brain/skills` manifests).
   - All prompts remind the model: “Only use data from Observations. Never invent.”

2. **Tool Catalog Injection**
   - Build a helper that walks `brain/skills` manifests and emits concise docs:
     ```
     Skill: task_list
     Inputs: includeCompleted?: boolean
     Outputs: tasks[], count
     Notes: Reads active tasks from memory/...
     ```
   - Inject into the system prompt for the orchestrator at the start of every session (cache per cognitive mode).

3. **Observation Formatting / Verbatim Mode**
   - Extend `formatObservation` with two modes:
     - `structured`: produce JSON or bullet list using only tool outputs.
     - `verbatim`: return the raw tool payload (pretty-printed) so we can skip the final LLM call if the user asked “list tasks,” “show file,” etc.
   - Detect “data retrieval” intents (zero-shot classification or heuristics) to short-circuit the loop and send the formatted payload back directly.

4. **Response Skill Enhancements**
   - Update `brain/skills/conversational_response.ts` to accept `style` (default, strict, summary).
   - For strict mode, the prompt says “Repeat the data EXACTLY; no additions.” Use this when the loop decides a final natural-language hand-off is OK but hallucination must be avoided.

5. **Error-aware Retries**
   - Wrap every skill call in a try/catch that records `{success:false,errorCode,errorMessage}`.
   - Feed the error into the scratchpad so the LLM can reason: “Action failed because file missing. Next action: fs_list.”
   - Add a cheap fast-path for deterministic failures (e.g., missing task file) to surface hints immediately.

6. **Multi-model routing**
   - Keep `default.coder` for planning/tool use.
   - Use the persona/orchestrator split that already exists (`resolveModelForCognitiveMode`) to call a lighter model for final replies when possible.
   - Expose a toggle in `models.json` to force “single model mode” for low-VRAM setups.

## Implementation Steps
1. **Tool Catalog Builder**
   - Add `packages/core/src/tool-catalog.ts` that loads every skill manifest and returns text snippets.
   - Cache per process; expire when a skill file changes (watcher optional).

2. **Scratchpad + Planning Refactor**
   - In `operator-react`, replace `planStep()` logic with:
     - Construct prompt = system instructions + tool catalog + scratchpad.
     - Ask orchestrator for JSON: `{thought:string, action?:{tool,args}, respond?:boolean, responseStyle?:'strict'|'default' }`.
     - Validate JSON; if invalid, retry with fallback prompt.

3. **Observation Handling**
   - After each skill execution, store both the raw payload and the human-readable summary.
   - When the iteration result has `respond:true`, either:
     - If `responseStyle==='strict'`, send the raw structured data to user.
     - Else run `conversational_response` with the summary plus any final instructions.

4. **Error Loop**
   - Wrap `executeSkill()` to return `{success,outputs,error}`.
   - Append errors to the scratchpad.
   - If planner repeatedly chooses a failing action, detect loops and suggest alternatives (“Tool X failed twice. Consider Y.”).

5. **Testing Hooks**
   - Add debug flag to dump the scratchpad into `/logs/run/agents/operator-react.log` for each session.
   - Provide CLI command (`./bin/mh task list --debug`) that triggers the exact planner path and prints the scratchpad for regression tests.

6. **Deployment**
   - Guard the new loop behind a feature flag (`operator.reactV2=true` in `etc/runtime.json`) so we can toggle per profile.
   - Once stable, delete the legacy observation formatter/heuristics.

## Risks & Mitigations
- **Longer latency** – Planning prompts get larger. Mitigate by caching the tool catalog and trimming the scratchpad to the last N steps.
- **Model JSON errors** – Add a validator + automatic “Please return valid JSON” re-try before failing the session.
- **User confusion** – Provide UI copy in the status widget when the system is in “Strict data mode” vs “Conversational mode.”

