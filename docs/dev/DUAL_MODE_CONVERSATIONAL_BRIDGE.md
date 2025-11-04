# Dual Mode Conversational Bridge — Implementation Checklist

**Audience:** Coding agent assigned to restore natural conversation in Dual Consciousness mode  
**Status:** Ready for implementation  
**Related:** `apps/site/src/pages/api/persona_chat.ts`, `packages/core/src/cognitive-mode.ts`, `docs/dev/COGNITIVE_MODE_TESTING.md`

---

## Goal
When cognitive mode is `dual`, every chat turn currently goes through the operator but never sends a conversational reply. This checklist directs you to:

1. Convert operator execution results into narrated chat responses.
2. Allow low-severity prompts (e.g., greetings) to bypass heavy task plans.
3. Ensure persona memories and reflections always feed the reply.
4. Keep emulation mode strictly read-only while we iterate on voice.

Follow the steps below in order; mark each subsection complete before moving on.

---

## 1. Refactor Cognitive Mode Helpers (Core)
**File:** `packages/core/src/cognitive-mode.ts`

1.1 Add a new export `canWriteMemory(mode: CognitiveModeConfig | string)` that returns `boolean` based on `allowMemoryWrites`.  
1.2 Add an export `canUseOperator(mode: CognitiveModeConfig | string)` for future planner checks.  
1.3 Ensure both helpers gracefully accept either the mode key or the full config object.

---

## 2. Load Cognitive Mode Context Once
**File:** `apps/site/src/pages/api/persona_chat.ts`

2.1 Near the top-level imports, bring in the new helpers: `import { getCognitiveMode, canWriteMemory, canUseOperator } from '@metahuman/core/cognitive-mode'`.  
2.2 In `handleChatRequest()`, directly after argument validation, call `const modeContext = await getCognitiveModeContext()` (create helper if needed) returning `{ modeKey, config }`.  
2.3 Store `allowOperator = canUseOperator(modeContext)` and `allowMemoryWrites = canWriteMemory(modeContext)` in local variables for reuse across the function.  
2.4 Pass `modeContext.modeKey` into audit logging so every exit path can log `cognitiveMode`.

---

## 3. Short-Circuit Operator Routing for Small Talk
**File:** `apps/site/src/pages/api/persona_chat.ts`

3.1 Update `shouldUseOperator()`:
- If `modeKey === 'dual'`, return `true` only when the analyzer detects actionable intent (`needsAction === true`).  
- If the message is conversational and `modeKey === 'dual'`, return `false`; we will still gather context but reply directly.

3.2 Ensure emulation mode continues to return `false`, agent mode keeps heuristic.

3.3 Adjust the caller so that when `shouldUseOperator()` returns `false`, we skip operator boot entirely and go straight to the “chat response” branch.

---

## 4. Summarize Operator Results into Chat Replies
**File:** `apps/site/src/pages/api/persona_chat.ts`

4.1 Create a helper `function summarizeOperatorResult(result: OperatorRunResult, context: ConversationContext): NarratorMessage` that:
- Accepts the final operator run data (plans, executed skills, critique).
- Generates a concise natural-language summary (use existing templating helper if available; otherwise call a new `renderOperatorSummary()` that formats plain text).

4.2 After operator execution completes, call this helper and push the output into the response payload as `assistantMessages.push(narratorMessage)`.

4.3 If the operator produced a direct chat reply already (e.g., new future skill), prioritize that text.

4.4 Remove the previous `fs_write` placeholder path; Dual mode should never rely on writing to disk for a greeting.

---

## 5. Enforce Memory Write Guard Everywhere

5.1 Guard `captureEvent()` calls (still in `persona_chat.ts`) with `if (allowMemoryWrites)`.  
5.2 Search for other memory mutations inside this handler (task create/update, calendar writes, long-form journaling) and ensure each path checks `allowMemoryWrites`.  
5.3 For the operator pipeline, inject `allowMemoryWrites` into the execution context so skills can respect it. If that path is complex, add a TODO but make sure chat-level calls are guarded now.

---

## 6. Strengthen Context Retrieval

6.1 In `getRelevantContext()`:
- When embeddings search fails, fall back to persona `core` and recent reflections.  
- For dual mode, always include persona snapshots plus any available short-term memory summary.

6.2 Ensure the returned context is fed into both operator prompts and direct narrator responses.

---

## 7. Update Audit Logging

7.1 Every audit event emitted by `persona_chat.ts` must include `{ cognitiveMode: modeContext.modeKey, usedOperator: boolean }`.  
7.2 Confirm error branches (try/catch `catch` and early returns) also append this metadata.

---

## 8. Re-run the Testing Checklist
- Use `docs/dev/COGNITIVE_MODE_TESTING.md` (already updated) and rerun:
  - Test 1.1: Dual mode greeting returns conversational reply.
  - Test 2.2: Emulation mode chat produces no new memory files.
  - Test 2.3: Emulation rejects task creation gracefully.

- Capture before/after memory counts and audit log snippets.

---

## 9. Deliverables
- Updated TypeScript files with the changes above.
- Test evidence (shell snippets or log excerpts) confirming success criteria.  
- Brief summary appended to `docs/dev/COGNITIVE_MODE_TESTING.md` noting test pass dates.

---

## 10. Short-Term File Memory (Recommended)
To keep the operator flexible without hand-authoring every follow-up path, capture recent file interactions:

- Store the absolute path of the most recent `fs_write` and expose it to subsequent plans via `task.context`.
- Cache the latest `fs_list` results so `fs_read` calls with bare filenames (e.g., `hotdog`) can be normalized automatically.
- Before executing `fs_read`, resolve relative or shorthand inputs using these caches and fall back to searching standard directories like `out/` and `memory/`.
- Log any automatic normalization so humans can audit the operator’s assumptions.

This short-term memory keeps routine workflows (read-after-write, repeat editing) autonomous while still allowing the LLM to decide which skills to run.

Once complete, dual mode should behave like a grounded conversational clone while still escalating actionable tasks through the operator. Emulation remains the safe space for persona voice polishing, and agent mode keeps its heuristic routing.
