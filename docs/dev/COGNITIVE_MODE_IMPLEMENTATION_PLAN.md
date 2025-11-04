# Cognitive Mode Integration - Implementation Plan

**Status:** Ready for Implementation
**Owner:** Greg Aster (MetaHuman OS)
**Date:** 2025-11-03
**Related:** [DUAL_CONSCIOUSNESS_ARCHITECTURE.md](DUAL_CONSCIOUSNESS_ARCHITECTURE.md)

## Executive Summary

The cognitive mode infrastructure (config, API, UI) is **already complete**. The missing piece is integrating mode-aware routing into the chat system to enforce the dual consciousness architecture requirements.

---

## What's Already Done ✅

### 1. Configuration System
- **File:** `persona/cognitive-mode.json`
  - Active tracking of current mode and history
  - Current mode: `dual` (as of 2025-11-04)
  - Complete audit trail of mode switches

- **Core Module:** `packages/core/src/cognitive-mode.ts`
  - `loadCognitiveMode()` - Read current mode
  - `saveCognitiveMode(mode, actor)` - Persist with audit
  - `listCognitiveModes()` - Get all mode definitions
  - `getModeDefinition(mode)` - Get specific mode details
  - `applyModeDefaults(mode)` - Hook for future integration (TODO at line 166)

### 2. API Endpoint
- **File:** `apps/site/src/pages/api/cognitive-mode.ts`
  - GET: Returns current mode + available modes
  - POST: Updates mode with validation and audit logging
  - Fully functional and tested

### 3. UI Mode Selector
- **File:** `apps/site/src/components/ChatLayout.svelte`
  - Mode selector in header (lines 184-258)
  - Visual indicators with mode-specific colors and icons:
    - 🧠 Dual Consciousness (purple glow)
    - 🛠️ Agent Mode (blue)
    - 🪄 Emulation (amber)
  - Dropdown menu for mode switching
  - Loading and error states
  - Full integration with API

### 4. Mode Definitions
Three complete mode definitions with guidance, labels, and defaults:

| Mode | Recording | Proactive Agents | Training | Memory Writes |
|------|-----------|------------------|----------|---------------|
| **Dual Consciousness** | On | Enabled | dual_trigger | read_write |
| **Agent Mode** | Off | Disabled | disabled | command_only |
| **Emulation** | Off | Disabled | disabled | read_only |

---

## What Needs Implementation

### Phase 1: Chat Router Integration (PRIMARY)

**File:** `apps/site/src/pages/api/persona_chat.ts`

> ✅ *Implementation tip:* create a helper such as `getCognitiveModeContext()` that wraps `loadCognitiveMode()` and `getModeDefinition()`, returning `{ mode, defaults, allowMemoryWrites, allowOperator }`. Both routing logic and memory-write checks should call this helper to keep behaviour consistent if defaults change later.

#### 1.1 Add Import (Line ~2)

```typescript
import { loadCognitiveMode, getModeDefinition } from '@metahuman/core/cognitive-mode';
```

#### 1.2 Modify `shouldUseOperator()` Function (Lines 239-310)

**Current behavior:** Routes based on trust level and message heuristics
**New behavior:** Check cognitive mode first, then apply mode-specific routing

```typescript
async function shouldUseOperator(message: string): Promise<boolean> {
  // Load cognitive mode first
  const cognitiveConfig = loadCognitiveMode();
  const mode = cognitiveConfig.currentMode;

  // DUAL MODE: Always use operator (mandatory routing)
  if (mode === 'dual') {
    return true;
  }

  // EMULATION MODE: Never use operator (read-only)
  if (mode === 'emulation') {
    return false;
  }

  // AGENT MODE: Use existing heuristic logic
  const trust = loadTrustLevel();
  if (trust !== 'supervised_auto' && trust !== 'bounded_auto') {
    return false;
  }

  // [Keep existing heuristic logic from lines 247-309]
  // Check for action keywords, LLM decision, etc.
  // ... rest of function unchanged
}
```

**Rationale:**
- Dual mode enforces operator-first pipeline (per architecture doc lines 28-33)
- Emulation mode is read-only, no operator needed
- Agent mode preserves current intelligent routing behavior

#### 1.3 Load Mode in `handleChatRequest()` (After Line 438)

```typescript
// Load cognitive mode to enforce mode-specific behavior
const cognitiveConfig = loadCognitiveMode();
const cognitiveMode = cognitiveConfig.currentMode;
const modeDefinition = getModeDefinition(cognitiveMode);

// Apply mode-specific memory write policies
const defaults = modeDefinition.defaults;
const allowMemoryWrites = defaults.memoryWriteLevel !== 'read_only';
const allowOperator = defaults.operatorRouting !== 'chat_only';
```

#### 1.4 Add Memory Write Filtering (Lines 825-832)

**Current behavior:** Always captures events to memory
**New behavior:** Check mode before persisting

```typescript
// Only capture events if mode allows writes
if (allowMemoryWrites) {
  const eventType = m === 'inner' ? 'inner_dialogue' : 'conversation';
  const responseForMemory = assistantResponse && assistantResponse.trim().length > 0
    ? assistantResponse.trim()
    : undefined;
  const userPath = captureEvent(`Me: "${message}"`, {
    type: eventType,
    tags: ['chat', m],
    response: responseForMemory,
  });
  const userRelPath = path.relative(ROOT, userPath);

  audit({
    level: 'info',
    category: 'action',
    event: 'chat_assistant',
    details: { mode: m, content: assistantResponse, cognitiveMode },
    actor: 'assistant'
  });

  push('answer', { response: assistantResponse, saved: { userRelPath } });
} else {
  // Emulation mode: return response without saving
  audit({
    level: 'info',
    category: 'action',
    event: 'chat_assistant_readonly',
    details: { mode: m, content: assistantResponse, cognitiveMode },
    actor: 'assistant'
  });

  push('answer', { response: assistantResponse });
}
```

#### 1.5 Propagate Memory Guard Across Writers

- Add a helper in `packages/core/src/cognitive-mode.ts`:
  ```ts
  export function canWriteMemory(defaults: CognitiveModeDefinition['defaults']): boolean {
    return defaults.memoryWriteLevel !== 'read_only';
  }
  ```
- Ensure any code path that writes to memory—`captureEvent`, task/calendar create/update/delete skills, `fs_write` into `memory/` or `persona/`—checks this guard before writing.
- In Dual mode this always returns `true`; in Agent mode it allows command outcomes; in Emulation it blocks all writes.

**Rationale:**
- Emulation mode must be read-only (architecture doc line 42)
- Agent mode captures command outcomes only
- Dual mode captures full context for training
- Add an audit entry for every `/api/persona_chat` response that includes `{ cognitiveMode, usedOperator: boolean }` to confirm routing behaves as expected.

---

### Phase 2: Mode-Specific Context Retrieval (SECONDARY)

**File:** `apps/site/src/pages/api/persona_chat.ts`

#### 2.1 Enhancement to `getRelevantContext()` (Lines 65-177)

**Current behavior:** Uses semantic search when available
**New behavior:** Enforce based on mode

```typescript
async function getRelevantContext(message: string, conversationHistory: ConversationMessage[]) {
  // Load cognitive mode
  const cognitiveConfig = loadCognitiveMode();
  const mode = cognitiveConfig.currentMode;

  // Dual mode: Mandatory semantic search (memory grounding required)
  if (mode === 'dual') {
    const indexStatus = await getIndexStatus();
    if (!indexStatus.exists) {
      // Log warning but continue - dual mode requires grounding
      console.warn('[DUAL MODE] No semantic index available - memory grounding degraded');
      // Fallback: return persona summary / recent reflections so planner has some context
      const fallbackContext = await loadPersonaSummary();
      return fallbackContext;
    }

    // Force semantic search in dual mode
    if (indexStatus.exists) {
      const results = await queryIndex(message, 5);
      // Build context from results...
    }
  }

  // Emulation mode: Allow semantic but mark as read-only
  if (mode === 'emulation') {
    // Can use semantic search for stable personality
    // but no learning signals
  }

  // Agent mode: Keep current behavior (semantic if available)
  if (mode === 'agent') {
    // Existing logic unchanged
    // Optional: still fetch persona summary + last reflections for lightweight grounding
  }

  // ... rest of function
}
```

**Rationale:**
- Dual mode requires memory grounding (architecture doc line 31)
- Emulation uses memories but doesn't update them
- Agent mode is flexible
- Add lightweight helpers (e.g., `loadPersonaSummary()`, `loadRecentReflections()`) if they do not exist so the fallback path still returns meaningful context when the semantic index is missing.

---

### Phase 3: Testing & Validation

#### 3.1 Manual Testing Checklist

**Dual Consciousness Mode:**
- [ ] Switch to Dual mode via UI dropdown
- [ ] Send a chat message
- [ ] Verify operator pipeline is invoked (check logs/audit)
- [ ] Verify semantic search is performed
- [ ] Verify memory is captured (check `memory/episodic/`)
- [ ] Verify audit log shows `cognitiveMode: "dual"`

**Agent Mode:**
- [ ] Switch to Agent mode via UI
- [ ] Send a simple message (should use chat)
- [ ] Send an action-oriented message (should use operator)
- [ ] Verify heuristic routing still works
- [ ] Verify memories are captured for commands only

**Emulation Mode:**
- [ ] Switch to Emulation mode via UI
- [ ] Send a chat message
- [ ] Verify operator is NOT invoked
- [ ] Verify NO new memory files created
- [ ] Verify response is returned successfully
- [ ] Verify audit log shows `chat_assistant_readonly`

#### 3.2 Automated Test Cases (Future)

```typescript
// Test: Dual mode enforces operator
describe('Dual Consciousness Mode', () => {
  it('should always route to operator', async () => {
    await setCognitiveMode('dual');
    const result = await shouldUseOperator('hello');
    expect(result).toBe(true);
  });

  it('should capture memories', async () => {
    await setCognitiveMode('dual');
    const beforeCount = countMemoryFiles();
    await sendChatMessage('test message');
    const afterCount = countMemoryFiles();
    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});

// Test: Emulation mode blocks writes
describe('Emulation Mode', () => {
  it('should never route to operator', async () => {
    await setCognitiveMode('emulation');
    const result = await shouldUseOperator('do something');
    expect(result).toBe(false);
  });

  it('should not capture memories', async () => {
    await setCognitiveMode('emulation');
    const beforeCount = countMemoryFiles();
    await sendChatMessage('test message');
    const afterCount = countMemoryFiles();
    expect(afterCount).toBe(beforeCount);
  });
});
```

---

## Expected Outcomes

### Dual Consciousness Mode
- ✅ Every chat goes through operator pipeline
- ✅ Mandatory memory grounding via semantic search
- ✅ Full read/write memory persistence
- ✅ Proactive agents enabled (future: via `applyModeDefaults()`)
- ✅ Dual-trigger training pipeline active (future)

### Agent Mode
- ✅ Heuristic-based routing (current behavior)
- ✅ Command outcomes captured to memory
- ✅ Proactive agents disabled
- ✅ Training pipeline disabled

### Emulation Mode
- ✅ Direct chat responses (no operator)
- ✅ Read-only access to memories
- ✅ No memory persistence
- ✅ Stable personality (no learning)
- ✅ No proactive agents

---

## Implementation Timeline

### Sprint 1: Core Routing (Day 1) ✅ COMPLETE
- [x] **30 min:** Add imports and modify `shouldUseOperator()`
- [x] **15 min:** Load mode in `handleChatRequest()`
- [x] **20 min:** Created helper function `getCognitiveModeContext()`
- [x] **Total:** 65 minutes

### Sprint 2: Memory Protection (Day 1) ✅ COMPLETE
- [x] **15 min:** Add memory write filtering
- [x] **10 min:** Add `canWriteMemory()` helper to core
- [x] **15 min:** Add cognitive mode tracking to audit logs
- [x] **Total:** 40 minutes

### Sprint 2.5: Testing & Validation
- [ ] **20 min:** Manual testing of mode switching
- [ ] **15 min:** Test emulation mode read-only behavior
- [ ] **10 min:** Verify audit logs
- [ ] **Total:** 45 minutes

### Sprint 3: Context Enhancement (Day 2) ✅ COMPLETE
- [x] **30 min:** Enhance `getRelevantContext()` with mode logic
- [x] **15 min:** Implement `loadPersonaFallbackContext()` helper function
- [x] **10 min:** Add dual mode semantic search enforcement
- [x] **10 min:** Add cognitive mode tracking to context retrieval audit logs
- [x] **Total:** 65 minutes

### Sprint 4: Documentation (Day 2) ✅ COMPLETE
- [x] **20 min:** Update CLAUDE.md with cognitive mode system documentation
- [x] **15 min:** Update testing guide with Sprint 3 test cases
- [x] **10 min:** Mark resolved regression targets in testing doc
- [x] **Total:** 45 minutes

**Grand Total:** ~3.5 hours (actual: 215 minutes across 4 sprints)

---

## Risk Assessment

### Low Risk ✅
- Configuration infrastructure is stable and tested
- UI already functional and user-tested
- Audit system already logging mode changes
- Changes are isolated to one file (`persona_chat.ts`)

### Medium Risk ⚠️
- Chat routing is critical path - needs thorough testing
- Memory write filtering must be bulletproof (data integrity)
- Semantic search enforcement could impact performance

### Mitigation Strategies
1. **Incremental rollout:** Test each mode independently
2. **Audit verification:** Verify mode appears in audit trail
3. **Rollback plan:** Mode selector allows instant switch back
4. **Performance monitoring:** Watch for semantic search latency in dual mode
5. **Memory validation:** Verify no files created in emulation mode

---

## Future Enhancements

From `cognitive-mode.ts` line 166 TODO:

```typescript
// TODO: integrate with agent scheduler, memory service, and training pipeline toggles.
```

### Phase 4 (Future): Proactive Agent Integration
- Auto-start/stop agents based on mode
  - Dual mode: Enable boredom-service, sleep-service, organizer
  - Agent/Emulation: Disable all proactive agents
- Hook into `applyModeDefaults()` function
- Add agent startup/shutdown logic to mode switching

### Phase 5 (Future): Training Pipeline Integration
- Dual mode: Enable dual-trigger training (full-cycle.ts)
- Agent/Emulation modes: Disable training entirely
- Add training status to mode selector UI
- Create training logs specific to mode

### Phase 6 (Future): Advanced Memory Service
- Implement mode-aware memory service layer
- Read-only memory proxy for emulation mode
- Command-only filter for agent mode
- Full access for dual mode

---

## Code Patterns to Follow

### Loading Cognitive Mode
```typescript
import { loadCognitiveMode, getModeDefinition } from '@metahuman/core/cognitive-mode';

const config = loadCognitiveMode();
const mode = config.currentMode; // 'dual' | 'agent' | 'emulation'
const definition = getModeDefinition(mode);
```

### Checking Mode Defaults
```typescript
const allowWrites = definition.defaults.memoryWriteLevel !== 'read_only';
const enableAgents = definition.defaults.proactiveAgents;
const enableTraining = definition.defaults.trainingPipeline !== 'disabled';
```

### Audit Pattern
```typescript
audit({
  level: 'info',
  category: 'action',
  event: 'chat_assistant',
  details: { mode: m, content: assistantResponse, cognitiveMode },
  actor: 'assistant',
});
```

---

## File Reference

### Files Requiring Modification
1. **`apps/site/src/pages/api/persona_chat.ts`** (PRIMARY)
   - Line 2: Add import
   - Lines 239-310: Modify `shouldUseOperator()`
   - Line 438+: Load mode in `handleChatRequest()`
   - Lines 825-832: Add memory write filtering
   - Lines 65-177: Enhance `getRelevantContext()` (optional)

### Existing Infrastructure (No Changes)
1. **`persona/cognitive-mode.json`** - Config storage ✅
2. **`packages/core/src/cognitive-mode.ts`** - Core logic ✅
3. **`apps/site/src/pages/api/cognitive-mode.ts`** - API ✅
4. **`apps/site/src/components/ChatLayout.svelte`** - UI ✅

### Reference Documentation
1. **`docs/dev/DUAL_CONSCIOUSNESS_ARCHITECTURE.md`**
   - Lines 36-48: Mode-specific expectations table
   - Lines 50-75: Proposed cognitive flow for dual mode

---

## Success Criteria

### Must Have (MVP)
- [x] Mode selector UI functional ✅
- [x] Dual mode enforces operator routing ✅ (Sprint 1)
- [x] Emulation mode blocks memory writes ✅ (Sprint 2)
- [x] Agent mode preserves current behavior ✅ (Sprint 1)
- [x] Audit logs show cognitive mode in context ✅ (Sprint 2)

### Should Have
- [x] Dual mode enforces semantic search ✅ (Sprint 3)
- [x] Dual mode fallback when index unavailable ✅ (Sprint 3)
- [ ] All three modes tested and validated ⏳ (Sprint 2.5 pending)
- [x] Documentation updated ✅ (Sprint 4)

### Nice to Have (Future)
- [ ] Proactive agents toggle with mode
- [ ] Training pipeline integration
- [ ] Automated test suite
- [ ] Mode-specific prompts/system messages

---

## Appendix: Architecture Alignment

### Dual Consciousness Mode Requirements
From [DUAL_CONSCIOUSNESS_ARCHITECTURE.md](DUAL_CONSCIOUSNESS_ARCHITECTURE.md) lines 36-48:

| Requirement | Current Status | Implementation Location |
|-------------|---------------|-------------------------|
| Always run operator pipeline | ❌ Missing | `shouldUseOperator()` modification |
| Mandatory memory fetch | ✅ Exists | Line 534: `getRelevantContext()` |
| Full read/write memories | ⚠️ Partial | Memory write filtering needed |
| Proactive agents enabled | ✅ Ready | Mode defaults defined |
| Dual-trigger training | ✅ Ready | `trainingPipeline: 'dual_trigger'` |
| Reflections from storage | ✅ Exists | Reflector agent operational |
| Output voice with citations | 🔄 Future | Phase 3 enhancement |

### Agent Mode Requirements

| Requirement | Current Status |
|-------------|---------------|
| Operator optional | ✅ Current heuristic behavior |
| Command outcomes only | ❌ Missing memory filter |
| Disabled proactive agents | ✅ Ready (defaults defined) |
| Informational tone | ✅ Current behavior |

### Emulation Mode Requirements

| Requirement | Current Status |
|-------------|---------------|
| Operator optional | ✅ Can be enforced |
| Read-only memories | ❌ Missing enforcement |
| No learning/training | ✅ Ready (defaults defined) |
| Stable personality | ✅ Persona system enforces |

---

## Questions & Decisions

### Q1: Should dual mode fail if semantic index doesn't exist?
**Decision:** No, log warning but continue. Better to degrade gracefully than block user.

### Q2: Should mode changes require confirmation?
**Decision:** No, allow instant switching. Mode is part of experimentation.

### Q3: Should emulation mode allow reading recent memories?
**Decision:** Yes, it's read-only, not amnesia. Access memories but don't create new ones.

### Q4: Should agent mode capture chat messages or only command outcomes?
**Decision:** Start with "command outcomes only" (check `useOperator` flag), refine based on usage.

### Q5: Should we add mode indicator in chat UI?
**Decision:** Not immediately. Header shows mode clearly. Revisit if users are confused.

---

## Next Steps

1. ✅ Review and approve this implementation plan
2. ✅ Sprint 1: Core routing integration (COMPLETE)
3. ✅ Sprint 2: Memory protection (COMPLETE)
4. ✅ Sprint 3: Context enhancement (COMPLETE)
5. ✅ Sprint 4: Documentation (COMPLETE)
6. ⏳ Sprint 2.5: Manual testing and validation (PENDING)
7. ⬜ Plan Phase 4 (proactive agent integration - future)

---

**Document Status:** ✅ Implementation Complete - Ready for Testing
**Last Updated:** 2025-11-03
**Implementation Completed:** 2025-11-03
**Next Review:** After Sprint 2.5 testing validation
