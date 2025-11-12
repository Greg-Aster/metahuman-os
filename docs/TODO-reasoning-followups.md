# Reasoning Service Follow-ups

## Completed ✅
1. **Strict task-list responses** ✅
   - ✅ Implemented in `packages/core/src/reasoning/engine.ts` (lines 315-356)
   - ✅ When `responseStyle === 'strict'` and observation succeeds, skips `conversational_response`
   - ✅ Returns structured data directly from `lastObs.observation.content`
   - ✅ Falls back to `conversational_response` if observation fails
   - ✅ Logs `reasoning_strict_shortcut` audit event
   - ✅ Prevents failure loops when persona model unavailable

2. **Reasoning SSE adapter** ✅
   - ✅ Implemented in `brain/agents/operator-react.ts` (lines 2159-2256)
   - ✅ Progress adapter emits BOTH event formats:
     - Raw events: `{type: 'thought', content, step}`
     - UI events: `{type: 'reasoning', data: {round, stage, content}}`
   - ✅ UI reasoning slider works with `operator.useReasoningService=true`
   - ✅ Backward compatibility maintained
   - ✅ Integration test: `tests/test-reasoning-ui-integration.mjs` (2/2 passing)

3. **Regression test: "list my tasks"** ✅
   - ✅ Created `tests/test-reasoning-strict-mode.mjs`
   - ✅ Verifies strict mode logic exists in engine.ts
   - ✅ Validates observation success check
   - ✅ Confirms audit event emission
   - ✅ Tests verbatim short-circuit integration
   - ✅ All 4 test suites passing

## Remaining
1. **Persona-chat pilot** (Optional)
   - Wrap the persona chat API endpoint in `ReasoningEngine` (behind `persona.useReasoningService`).
   - Map the existing reasoning toggle/slider to engine config (max steps, observation mode).
   - Verify the fallback path (flag off) still uses the current flow.
   - **Note**: May not be necessary - persona chat is conversational, not action-oriented

2. **Docs & QA notes** (In Progress)
   - Update verification docs with strict-response behavior
   - Document SSE expectations for QA validation
   - User guide already updated with ReasoningEngine documentation

## Nice-to-haves
- Evaluate dreamer / reflector integration with the shared engine once persona chat is stable.
  - **Note**: Analysis complete - not applicable. Dreamer/reflector are creative content generation, not action-oriented reasoning.
- Add telemetry redaction options before turning on scratchpad logging in production.
