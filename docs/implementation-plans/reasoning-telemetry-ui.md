# Conversational Reasoning Telemetry Plan

**Status**: Draft
**Goal**: Give users real-time visual feedback while the operator/LLM is reasoning so the chat window never feels “frozen.”

## Requirements
- Show a lightweight “AI is thinking…” panel in the conversation stream whenever a reasoning phase is active.
- Automatically collapse/remove the panel once the final answer is delivered (or on error).
- Handle long ReAct iterations: display the current step (e.g., Iteration 4 / 9, Skill = `fs_write`).
- Integrate with existing reasoning events (`reasoningStages`, operator SSE, or future telemetry channel) without blocking the main response.
- Keep layout unobtrusive (gray text, smaller font, optional spinner), with a toggle to hide if desired.

## Proposed Architecture
1. **Reasoning Telemetry Store**
   - Extend the shared chat store (or add a new Svelte store) that tracks `currentReasoning: { active: boolean; stage?: string; iteration?: number; total?: number; skill?: string; message?: string; }`.
   - Update this store whenever we receive `reasoning` SSE events, operator planning logs, or persona_chat reasoningStages updates.

2. **UI Component**
   - Create `ReasoningIndicator.svelte` that subscribes to the store and renders:
     - Grey subtitle text like “Thinking… Iteration 4/9 (fs_write)”
     - Optional progress dots/spinner
     - Collapsible detail (e.g., show last few reasoning lines if developer mode is on)
   - Insert the component into the conversation history list so it appears inline with messages.

3. **Lifecycle**
   - When persona_chat starts a request: set `currentReasoning.active = true` with default text (“Analyzing request…”)
   - Each operator SSE (`react_step_planned`, `react_executing_skill`, `react_step_completed`) updates the indicator with latest iteration + skill.
   - On final answer (personachat sends `push('answer', …)`): set `active = false` and animate the indicator out (fade/slide).
   - On error or cancel: show “⚠️ Aborted after iteration 3 – see audit stream” for a few seconds, then hide.

4. **Data Sources**
   - persona_chat already streams `reasoningStages` events for simple conversational reasoning.
   - `operator-react.ts` emits SSE steps (iteration number, skill, etc.). Extend persona_chat to forward these as lightweight telemetry events to the UI (without dumping full logs).
   - Optionally subscribe to the same event bus used by the audit stream (future optimization).

5. **Testing Plan**
   - Add a test page / dev flag that simulates long ReAct runs so we can verify the indicator transitions.
   - Write unit tests for the Svelte store to ensure `active` toggles correctly when events arrive.
   - Manual QA: run a slow request (“find file” or “multi-step task”) and confirm the indicator updates until final response appears.

## Future Enhancements
- Expandable reasoning transcript (like a mini console) for power users.
- Per-mode customization (inner dialogue vs. conversation, developer vs. guest).
- Hook into new telemetry events once the operator emits them directly instead of piggybacking on persona_chat logs.

