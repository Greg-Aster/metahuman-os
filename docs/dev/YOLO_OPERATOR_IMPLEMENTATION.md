# YOLO Operator Mode Implementation Notes

## Overview

"YOLO mode" is an experimental switch exposed to the chat UI that lets the operator run in a high-autonomy configuration (minimal guardrails, fewer validations). This document lays out the integration steps so the UI, API, and operator agent stay in sync. Another agent can follow these notes to build the feature without guesswork.

## Definitions

- **YOLO mode**: Operator runs with relaxed validations, softer input checks, and fewer planner constraints. Intended for power users willing to trade safety for speed.
- **Strict mode**: Current default. Planner requires placeholder reuse, executor enforces status checks, and destructive actions must be justified.
- **Experimental flag**: Stored in persona/decision rules (or the user’s session) to persist YOLO state between requests.

## Required Changes

### 1. Trust Configuration / Server State
1. Extend `persona/decision-rules.json` with e.g. `"allowExperimentalOperator": true|false` (default false).
2. When YOLO switch toggles, persist user preference:
   - Either mutate a lightweight settings file (e.g. `persona/preferences.json`)
   - Or store in `localStorage` and pass `forceYolo=true` with each request.
3. API requests to `/api/persona_chat` and `/api/operator` need to read `forceYolo` query/body flag and pass `mode: 'yolo' | 'strict'` to the operator agent.

### 2. Operator Agent Adjustments (`brain/agents/operator.ts`)
1. Accept an options object with `{ mode?: 'strict' | 'yolo' }`.
2. Planner prompt:
   - If mode === 'yolo': remove placeholder warnings, allow implicit IDs, encourage multi-step macros.
   - If mode === 'strict': keep current instructions.
3. Executor:
   - If mode === 'yolo`: downgrade hard throws to warnings (log but continue). Keep minimal guardrails for irreversible ops.
4. Critic:
   - Record failures tagged with the mode so logs reveal YOLO vs strict reliability.

### 3. API Layer
1. `/api/persona_chat` and `/api/operator` must accept a `yolo=true|false` flag in query/body.
2. When `yolo=true`, include the flag in the payload passed to the operator agent.
3. Update audit logs to note when YOLO mode runs (e.g. `details: { mode: 'yolo' }`).

### 4. Chat UI (`ChatInterface.svelte`)
1. Desktop view: insert a toggle adjacent to the existing "Operator" toggle.
   - Label: "YOLO"
   - Under the hood: boolean bound to `yoloMode`.
2. Mobile view: icon-only button (e.g. ⚡ or 🏁) with tooltip or long-press text.
3. Toggle state must survive page reloads:
   - Use `localStorage.setItem('mh-yolo-mode', 'true|false')`.
   - On mount, read saved value.
4. When YOLO is enabled, ensure the API request payload adds `yolo: true`.

### 5. Visual Feedback / UX
1. Highlight the switch when enabled (e.g., warning color).
2. Surface a toast or banner once per session warning: “YOLO mode relaxes safety checks.”
3. Optionally annotate responses (e.g., prefix `[YOLO]` in assistant messages) for easy auditing.

### 6. Reasoning Mode Integration
1. In YOLO mode, ask the planner to run a quick self-confidence check.
2. If the model claims low confidence but YOLO is active, optionally spin a reasoning pass before execution.
3. Expose this in the logs so humans can tell whether the model was overconfident.

## Testing Checklist
1. Toggle off: existing behavior unchanged.
2. Toggle on: API payload `yolo=true`; operator runs with relaxed instructions.
3. Verify you can perform multi-step tasks (read + edit + delete) without manual plan tweaks.
4. Disable YOLO, ensure state resets.
5. Confirm warning/notification is displayed once per session.
6. Run automated logs diff to confirm YOLO runs are tagged.

## Follow-up Enhancements
- Telemetry comparing success rates between strict vs YOLO.
- Adjustable levels (e.g., `strict`, `relaxed`, `wild`).
- Endpoint to clear YOLO flag remotely if run goes sideways.

---
Created: 2025-11-03  
Intent: Serve as handoff for the engineer implementing YOLO operator mode.
