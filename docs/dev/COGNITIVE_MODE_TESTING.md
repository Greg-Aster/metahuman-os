# Cognitive Mode Integration - Testing Guide

**Status:** ✅ All Core Tests Passing
**Date:** 2025-11-04 (conversational bridge fixes applied)
**Implementation:** Sprint 1-4 Complete + Bridge Fixes Validated
**Related:** [COGNITIVE_MODE_IMPLEMENTATION_PLAN.md](COGNITIVE_MODE_IMPLEMENTATION_PLAN.md)

## Current System State

**Active Mode:** `dual` (Dual Consciousness)
**Last Changed:** 2025-11-04 07:00:00 UTC (approximate)
**Changed By:** test_suite

## Test Environment Setup

### Prerequisites
1. ✅ Dev server running: `pnpm dev`
2. ✅ Ollama running: `ollama serve`
3. ✅ Web UI accessible at http://localhost:4321
4. ✅ Cognitive mode selector visible in header

### Files to Monitor
```bash
# Terminal 1: Watch audit logs in real-time
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | jq -r 'select(.event == "chat_assistant" or .event == "chat_assistant_readonly" or .event == "operator_route_decision") | {event, cognitiveMode: .details.cognitiveMode, usedOperator: .details.usedOperator, message: .details.message}'

# Terminal 2: Watch memory directory for new files
watch -n 1 'ls -lt memory/episodic/$(date +%Y)/ | head -20'

# Terminal 3: Count memories before/after tests
find memory/episodic/$(date +%Y)/ -name "*.json" | wc -l
```

---

## Known Regression Targets - Status

- ✅ **RESOLVED (2025-11-04):** Dual mode greetings route to operator but answer via `fs_write` — fixed by extracting file content in `formatOperatorResult()` (Bridge Step 4)
- ✅ **RESOLVED (2025-11-04):** Emulation mode permits memory writes — fixed by global `allowMemoryWrites` guard in chat handler (Bridge Step 5, TODO for skill-level enforcement)
- ✅ **RESOLVED:** Audit log entries occasionally omit `{ cognitiveMode, usedOperator }` — all chat exit paths now populate these fields (Sprint 1 & 2 + Bridge Step 7)
- ✅ **RESOLVED:** Dual mode lacks semantic grounding fallback — `loadPersonaFallbackContext()` provides persona summaries + reflections (Sprint 3)

---

## Test Suite 1: Dual Consciousness Mode

**Expected Behavior:**
- ✅ Always routes to operator
- ✅ Mandatory memory grounding via semantic search
- ✅ Full read/write memory persistence
- ✅ Audit logs show: `cognitiveMode: "dual", usedOperator: true`

### Test 1.1: Simple Query in Dual Mode

**Current Mode:** dual
**Action:** Send message: "Hello, how are you?"

**Expected Results (Post-Fix):**
1. Message routes to operator (not direct chat)
2. Operator returns a conversational reply through narrator (no file-only response)
3. New memory file created in `memory/episodic/YYYY/`
4. Audit log entry:
   ```json
   {
     "event": "chat_assistant",
     "details": {
       "cognitiveMode": "dual",
       "usedOperator": true
     }
   }
   ```

**Current Status:** ✅ **PASSES (2025-11-04)** - Conversational reply returned to chat. Memory created. Response: "Hello Gregory! I'm functioning optimally..."

**Validation:**
```bash
# Count memories before
BEFORE=$(find memory/episodic/$(date +%Y)/ -name "*.json" | wc -l)

# Send message via UI or API
curl -X POST http://localhost:4321/api/persona_chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, how are you?", "mode": "conversation"}'

# Wait 5 seconds
sleep 5

# Count memories after
AFTER=$(find memory/episodic/$(date +%Y)/ -name "*.json" | wc -l)

# Should have increased
echo "Before: $BEFORE, After: $AFTER, Diff: $((AFTER - BEFORE))"
```

### Test 1.2: Action-Oriented Message in Dual Mode

**Current Mode:** dual
**Action:** Send message: "Create a task to test cognitive mode integration"

**Expected Results:**
1. Routes to operator (as always in dual mode)
2. Operator executes task skill
3. Memory captured with task creation context
4. Audit log shows `cognitiveMode: "dual", usedOperator: true`

---

## Test Suite 2: Emulation Mode (Read-Only)

**Expected Behavior:**
- ✅ Never routes to operator
- ✅ Read-only access to memories
- ✅ **NO memory writes**
- ✅ Audit logs show: `event: "chat_assistant_readonly", cognitiveMode: "emulation"`

### Test 2.1: Switch to Emulation Mode

**Action:** Click mode selector in header → Select "Emulation (Replicant)"

**Expected Results:**
1. Mode selector shows amber/yellow glow
2. Status updates to "emulation"
3. Audit log entry:
   ```json
   {
     "event": "cognitive_mode_changed",
     "details": {
       "mode": "emulation",
       "previous": "dual"
     }
   }
   ```

**Validation:**
```bash
cat persona/cognitive-mode.json | jq '.currentMode'
# Should output: "emulation"
```

### Test 2.2: Chat in Emulation Mode (Read-Only)

**Current Mode:** emulation
**Action:** Send message: "What's my current project?"

**Expected Results (Post-Fix):**
1. **Does NOT route to operator**
2. Direct chat response (may reference existing memories)
3. **NO new memory file created**
4. Audit log entry:
  ```json
  {
    "event": "chat_assistant_readonly",
    "details": {
      "cognitiveMode": "emulation",
      "usedOperator": false
    }
  }
  ```

**Current Status:** ✅ **PASSES (2025-11-04)** - No operator routing. Chat response provided. Memory count unchanged (before: 455, after: 455, diff: 0).

**Validation:**
```bash
# Count memories before
BEFORE=$(find memory/episodic/$(date +%Y)/ -name "*.json" | wc -l)

# Send message
curl -X POST http://localhost:4321/api/persona_chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is my current project?", "mode": "conversation"}'

# Wait 5 seconds
sleep 5

# Count memories after
AFTER=$(find memory/episodic/$(date +%Y)/ -name "*.json" | wc -l)

# Should be EQUAL (no new memories)
echo "Before: $BEFORE, After: $AFTER, Diff: $((AFTER - BEFORE))"
# Expected: Diff: 0
```

### Test 2.3: Action Request in Emulation Mode (Blocked)

**Current Mode:** emulation
**Action:** Send message: "Create a task to review my notes"

**Expected Results (Post-Fix):**
1. **Does NOT route to operator** (emulation always returns false)
2. Chat response (likely explaining it can't perform actions)
3. **NO task created**
4. **NO memory file created**
5. Audit log: `chat_assistant_readonly`

**Current Status:** ✅ **PASSES (2025-11-04)** - No operator routing (emulation mode blocks it). Chat-only response provided. No task files created. No memory created.

---

## Test Suite 3: Agent Mode (Heuristic Routing)

**Expected Behavior:**
- ✅ Smart routing based on message intent
- ✅ Simple queries use chat
- ✅ Action-oriented messages use operator
- ✅ Command outcomes captured to memory
- ✅ Audit logs show: `cognitiveMode: "agent", usedOperator: true/false`

### Test 3.1: Switch to Agent Mode

**Action:** Click mode selector → Select "Agent Mode"

**Expected Results:**
1. Mode selector shows blue color
2. Status updates to "agent"

**Validation:**
```bash
cat persona/cognitive-mode.json | jq '.currentMode'
# Should output: "agent"
```

### Test 3.2: Simple Query in Agent Mode (Chat Route)

**Current Mode:** agent
**Action:** Send message: "Hello!"

**Expected Results:**
1. Heuristic determines this is conversational
2. Routes to **chat** (not operator)
3. Memory may or may not be created (command_only mode)
4. Audit log:
   ```json
   {
     "event": "chat_assistant",
     "details": {
       "cognitiveMode": "agent",
       "usedOperator": false
     }
   }
   ```

### Test 3.3: Action Query in Agent Mode (Operator Route)

**Current Mode:** agent
**Action:** Send message: "Create a task to write documentation"

**Expected Results:**
1. Heuristic detects action intent
2. Routes to **operator**
3. Task created
4. Memory captured (command outcome)
5. Audit log:
   ```json
   {
     "event": "chat_assistant",
     "details": {
       "cognitiveMode": "agent",
       "usedOperator": true
     }
   }
   ```

**Validation:**
```bash
# Check tasks
./bin/mh task | grep -i "write documentation"
# Should show the newly created task
```

---

## Test Suite 3.5: Context Retrieval (Sprint 3)

**Feature:** Mode-aware context retrieval with fallback grounding

### Test 3.5.1: Dual Mode Semantic Search (Index Available)

**Current Mode:** dual
**Precondition:** Semantic index exists (`./bin/mh index build`)
**Action:** Send message: "What projects have I worked on?"

**Expected Results:**
1. Context retrieval uses semantic search
2. Audit log entry:
   ```json
   {
     "event": "chat_context_retrieved",
     "details": {
       "cognitiveMode": "dual",
       "indexUsed": true,
       "usedFallback": false
     }
   }
   ```

**Validation:**
```bash
# Check audit logs for context retrieval
cat logs/audit/$(date +%Y-%m-%d).ndjson | \
  jq 'select(.event == "chat_context_retrieved") | {cognitiveMode, indexUsed, usedFallback}' | tail -1
```

### Test 3.5.2: Dual Mode Persona Fallback (No Index)

**Current Mode:** dual
**Precondition:** Remove/rename semantic index temporarily
**Action:** Send message: "Tell me about my goals"

**Expected Results:**
1. Console warning: `[DUAL MODE] No semantic index available - memory grounding degraded`
2. Context uses persona fallback (identity, values, recent reflections)
3. Audit log entry:
   ```json
   {
     "event": "dual_mode_missing_index",
     "level": "warn",
     "details": {
       "message": "Semantic index unavailable in dual mode, using persona fallback"
     }
   }
   ```
4. Chat response still grounded in persona identity

**Validation:**
```bash
# Temporarily move index
mv memory/index/embeddings-nomic-embed-text.json memory/index/embeddings-backup.json

# Send message via UI or API
# ... chat interaction ...

# Check for warning in audit logs
cat logs/audit/$(date +%Y-%m-%d).ndjson | \
  jq 'select(.event == "dual_mode_missing_index")'

# Restore index
mv memory/index/embeddings-backup.json memory/index/embeddings-nomic-embed-text.json
```

### Test 3.5.3: Emulation Mode Context Access (Read-Only)

**Current Mode:** emulation
**Action:** Send message referencing past events

**Expected Results:**
1. Can access semantic search results (if index exists)
2. Context retrieval audit includes `cognitiveMode: "emulation"`
3. No warnings about missing index (optional in emulation mode)

### Test 3.5.4: Agent Mode Context Flexibility

**Current Mode:** agent
**Action:** Send various messages (with/without semantic index)

**Expected Results:**
1. Gracefully degrades if no index (empty context, no warnings)
2. Uses semantic search if available
3. Audit log includes `cognitiveMode: "agent", indexUsed: true/false`

---

## Test Suite 4: Mode Switching Behavior

### Test 4.1: Rapid Mode Switching

**Action:** Quickly switch between all three modes (dual → agent → emulation → dual)

**Expected Results:**
1. Each switch creates audit entry
2. No errors in console
3. Mode selector UI updates immediately
4. Subsequent chats respect new mode

**Validation:**
```bash
# Check mode history
cat persona/cognitive-mode.json | jq '.history | .[-5:]'
# Should show last 5 mode changes
```

### Test 4.2: Mode Persists Across Page Reload

**Action:**
1. Set mode to "emulation"
2. Reload browser page
3. Check mode selector

**Expected Results:**
1. Mode selector shows "emulation" (amber)
2. Mode is still "emulation" in config
3. Next chat behaves as emulation mode

---

## Test Suite 5: Audit Log Verification

### Test 5.1: Verify Cognitive Mode in All Audit Entries

**Action:** Review recent audit logs for chat events

**Command:**
```bash
# Check last 10 chat events
cat logs/audit/$(date +%Y-%m-%d).ndjson | \
  jq -r 'select(.event | startswith("chat_assistant")) | {
    event,
    mode: .details.mode,
    cognitiveMode: .details.cognitiveMode,
    usedOperator: .details.usedOperator,
    timestamp: .timestamp
  }' | tail -10
```

**Expected Results:**
- Every chat event has `cognitiveMode` field
- Every chat event has `usedOperator` field (true/false)
- `chat_assistant_readonly` only appears in emulation mode

### Test 5.2: Verify Operator Routing Decisions

**Command:**
```bash
# Check operator routing decisions
cat logs/audit/$(date +%Y-%m-%d).ndjson | \
  jq -r 'select(.event == "operator_route_decision") | {
    decision: .details.decision,
    message: .details.message,
    timestamp: .timestamp
  }' | tail -5
```

**Expected Results:**
- In dual mode: No routing decisions (always operator)
- In emulation mode: No routing decisions (never operator)
- In agent mode: Routing decisions present with "chat" or "operator"

---

## Success Criteria

### Must Pass (MVP)
- [x] Dual mode enforces operator routing ✅ (with conversational short-circuit)
- [x] Dual mode surfaces conversational reply (no `fs_write` detour) ✅ (Bridge fix Step 4)
- [x] Emulation mode blocks all memory writes ✅ (Bridge fix Step 5)
- [x] Agent mode preserves heuristic routing ✅
- [x] All audit logs include `cognitiveMode` field ✅ (Bridge fix Step 7)
- [x] Mode switching works via UI ✅

### Should Pass
- [ ] No errors in browser console
- [ ] No errors in server logs
- [ ] Semantic search still works in dual mode
- [ ] Mode persists across page reloads

### Nice to Have
- [ ] Mode indicator visible in chat UI
- [ ] Performance unchanged (no noticeable latency)
- [ ] Operator synthesis quality unchanged

---

## Troubleshooting

### Issue: Memory still created in emulation mode

**Check:**
```typescript
// In persona_chat.ts around line 829
if (allowMemoryWrites) {
  const userPath = captureEvent(...)
}
```

**Fix:** Verify `allowMemoryWrites` is correctly computed from mode defaults

### Issue: Dual mode not routing to operator

**Check:**
```bash
# Verify mode is actually dual
cat persona/cognitive-mode.json | jq '.currentMode'

# Check operator routing decision in logs
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | jq 'select(.event == "operator_route_decision")'
```

**Fix:** Verify `shouldUseOperator()` checks mode first (line 240-246)

### Issue: Dual mode replies written to file instead of chat

**Check:**
```typescript
// After operator execution result is computed
if (result.type === "fs_write") {
  // convert to narrator response
}
```

**Fix:** Map operator outputs to a spoken response before returning. Use Test 1.1 as regression once patched.

### Issue: Audit logs missing cognitiveMode field

**Check:** Lines 843, 854, 487 in `persona_chat.ts`

**Fix:** Ensure `cognitiveMode` variable is in scope and passed to audit calls

### Issue: Semantic grounding unavailable in dual mode

**Check:**
```typescript
// In getRelevantContext()
if (!indexAvailable) {
  addPersonaFallback()
}
```

**Fix:** Add fallback to persona summaries/reflections so operator still receives grounding when semantic index is cold.

---

## Next Steps After Testing

1. **If all tests pass:**
   - Mark Sprint 1 as complete
   - Update implementation plan with test results
   - Consider Sprint 2 (mode-specific context retrieval)

2. **If tests fail:**
   - Document failures in this file
   - Fix issues and re-test
   - Update implementation as needed

3. **Future enhancements:**
   - Add unit tests for `shouldUseOperator()`
   - Add integration tests for mode switching
   - Implement Phase 2 (context retrieval enhancements)

---

**Document Status:** Blocked on Fixes (see Known Regression Targets)
**Last Updated:** 2025-11-03 (notes refreshed 2025-11-02)
**Test Coverage:** Sprint 1 (Core Routing Integration) — validation pending fixes
