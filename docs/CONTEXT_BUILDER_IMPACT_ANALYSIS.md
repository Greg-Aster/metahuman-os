# Context Builder - Impact Analysis

**Date:** 2025-11-04
**Status:** Pre-Implementation Review
**Question:** Will context builder break anything? What needs to change?

---

## TL;DR - Impact Summary

### 🟢 Low Risk, High Value

**What Changes:**
- ONE file needs refactoring: `apps/site/src/pages/api/persona_chat.ts`
- Replace ~100 lines of inline memory retrieval with `buildContextPackage()` call

**What Stays the Same:**
- All existing functionality (semantic search, fallback, persona context)
- Same memory retrieval logic (refactored, not replaced)
- Same performance targets
- No API changes (responses identical)
- No database changes
- No breaking changes to other modules

**Risk Level:** ⚠️ **LOW** - Pure refactor, no new behavior

---

## Current System Analysis

### Where Memory Retrieval Happens Now

**File:** `apps/site/src/pages/api/persona_chat.ts` (lines 172-319)

**Current Flow:**
```
User message
    ↓
persona_chat.ts (inline logic)
├─ Load persona core
├─ Check semantic index exists
├─ Query vector index (8 results)
├─ Filter results (score >= 0.62)
├─ Load memory files from disk
├─ Filter out inner_dialogue and reflections
├─ Select 2 novel memories
├─ Load active tasks (if mentioned)
├─ Add persona context (aliases, projects)
└─ Build context string
    ↓
Feed to LLM
```

**Lines of Code:** ~150 lines total for context retrieval

**Key Functions Used:**
- `getIndexStatus()` - Check if vector index exists
- `queryIndex()` - Semantic search
- `loadPersonaCore()` - Load identity
- `loadPersonaFallbackContext()` - Fallback when no index
- `listActiveTasks()` - Get active tasks
- `readFileSync()` - Read memory JSON files

### What the Context Builder Does

**Same Logic, Better Organization:**

```
User message
    ↓
buildContextPackage() - NEW
├─ Load persona core (SAME)
├─ Check semantic index (SAME)
├─ Query vector index (SAME)
├─ Filter results (SAME)
├─ Load active tasks (SAME)
├─ Load short-term state (NEW - already exists)
├─ Load persona cache (NEW - already exists)
└─ Return ContextPackage object
    ↓
formatContextForPrompt() - NEW
└─ Build context string (SAME)
    ↓
Feed to LLM (SAME)
```

**The context builder doesn't add new features - it reorganizes existing code.**

---

## What Needs to Change

### 1. Refactor persona_chat.ts (Primary Change)

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Current Code (lines 172-319):**
```typescript
// ~150 lines of inline memory retrieval
const idx = await getIndexStatus();
if (idx.exists) {
  const hits = await queryIndex(userMessage, { topK: 8 });
  // ... 50+ lines of filtering, loading, processing
}
// ... more context building
```

**New Code:**
```typescript
// Replace with context builder
import { buildContextPackage, formatContextForPrompt } from '@metahuman/core';

const contextPackage = await buildContextPackage(userMessage, cognitiveMode, {
  searchDepth: 'normal',
  similarityThreshold: 0.62,
  includeShortTermState: true
});

const context = formatContextForPrompt(contextPackage);

// Continue with existing LLM call (unchanged)
```

**Impact:**
- ✅ Reduces ~150 lines to ~10 lines
- ✅ Same behavior, cleaner code
- ✅ No API changes (users won't notice)
- ✅ Adds telemetry (audit logging)

### 2. Keep Existing Helper Functions

**Function:** `loadPersonaFallbackContext()` (lines 65-100)

**Status:** ✅ **Keep as-is** - Context builder will call this

The context builder uses the SAME fallback logic:
```typescript
// In context-builder.ts (already implemented)
if (!indexExists) {
  // Use existing fallback
  const fallbackContext = await loadPersonaFallbackContext(persona);
  // ... rest of fallback logic
}
```

### 3. Preserve Mode-Specific Logic

**Dual Mode Special Handling** (lines 172-223):

**Current:**
```typescript
if (cognitiveMode === 'dual') {
  // Special dual mode logic
  if (!indexExists) {
    memoryContext = await loadPersonaFallbackContext(persona);
  }
}
```

**New:**
```typescript
// Context builder handles this automatically
const contextPackage = await buildContextPackage(userMessage, 'dual', {
  forceSemanticSearch: true, // Dual mode always tries semantic
  includeShortTermState: true
});

// Validation
const validation = validateContextPackage(contextPackage);
if (validation.warnings.includes('semantic index unavailable')) {
  // Log warning for dual mode
}
```

---

## What Does NOT Need to Change

### ✅ Operator Pipeline
**File:** `brain/agents/operator.ts`

**Status:** No changes needed

The operator doesn't do memory retrieval - it uses the context that persona_chat.ts provides. Once we refactor persona_chat.ts, the operator automatically gets better context.

### ✅ Cognitive Mode System
**Files:**
- `packages/core/src/cognitive-mode.ts`
- `persona/cognitive-mode.json`

**Status:** No changes needed

The context builder USES cognitive modes, doesn't change them.

### ✅ Security Policy
**File:** `packages/core/src/security-policy.ts`

**Status:** No changes needed

Context builder respects existing security policy (read-only in emulation, etc.)

### ✅ Model Registry
**File:** `etc/models.json`

**Status:** No changes needed

Context builder uses existing models via model router.

### ✅ Memory Storage
**Files:**
- `memory/episodic/` - Event files
- `memory/index/` - Vector index
- `packages/core/src/memory.ts`

**Status:** No changes needed

Context builder READS from memory, doesn't change storage format.

### ✅ Audit System
**File:** `packages/core/src/audit.ts`

**Status:** No changes needed (gets better!)

Context builder ADDS more audit events, doesn't remove existing ones.

### ✅ State Management
**File:** `packages/core/src/state.ts`

**Status:** No changes needed

Context builder uses existing state system (already implemented).

### ✅ All Other API Endpoints
**Files:**
- `/api/status`
- `/api/capture`
- `/api/tasks`
- `/api/memories`
- etc.

**Status:** No changes needed

Only persona_chat.ts uses context retrieval. Other endpoints unaffected.

---

## Potential Issues & Mitigation

### Issue 1: Different Results from Context Builder

**Risk:** Medium
**Probability:** Low

**Scenario:** Context builder returns different memories than old code

**Mitigation:**
1. Unit tests comparing old vs new results
2. Benchmark script shows before/after performance
3. Audit logs track memory retrieval details
4. Can rollback in minutes (one file change)

**Test:**
```typescript
// Test that context builder matches old logic
const oldMemories = await oldGetRelevantContext(message);
const newContext = await buildContextPackage(message, mode);

expect(newContext.memories.length).toBe(oldMemories.length);
expect(newContext.memories.map(m => m.id)).toEqual(oldMemories.map(m => m.id));
```

### Issue 2: Performance Regression

**Risk:** Low
**Probability:** Very Low

**Scenario:** Context builder is slower than inline code

**Mitigation:**
1. Benchmark script captures baseline BEFORE changes
2. Run benchmarks AFTER to compare
3. Target: < 50ms overhead acceptable
4. If slower, optimize or rollback

**Evidence:**
- Context builder does SAME operations, just organized differently
- No new disk reads, no new LLM calls
- Actually adds caching opportunities (future)

### Issue 3: Missing Edge Cases

**Risk:** Medium
**Probability:** Low

**Scenario:** Old code has edge case handling we missed

**Mitigation:**
1. Read entire persona_chat.ts memory section carefully
2. Document all special cases (inner_dialogue filtering, reflection filtering)
3. Include in context builder tests
4. User testing in all 3 modes before deploying

**Edge Cases Found:**
- ✅ Filter inner_dialogue memories (line 238)
- ✅ Filter reflection/dream memories (line 239)
- ✅ Limit to 2 novel memories (line 247)
- ✅ Cap context at 900 characters (line 257)
- ✅ Track recent memory IDs to avoid repetition (line 260)
- ✅ Task context only if user mentions tasks (line 296)
- ✅ Persona context excluded when using LoRA (line 282)

**Status:** ⚠️ Some edge cases NOT in initial context builder implementation!

### Issue 4: Breaking Changes to API

**Risk:** Critical (if true)
**Probability:** Zero

**Scenario:** Clients expect specific response format

**Mitigation:**
- Context builder changes INTERNAL implementation only
- API responses stay identical
- No JSON schema changes
- No new required parameters
- Backwards compatible 100%

---

## Implementation Strategy

### Phase 1: Add Context Builder (✅ Complete)

**Status:** Done
- [x] Created `context-builder.ts`
- [x] Exported from `@metahuman/core`
- [x] Created benchmark script
- [x] Documentation written

**Impact:** Zero - No code uses it yet

### Phase 2: Refactor persona_chat.ts (Next)

**Steps:**
1. **Add missing edge cases to context builder:**
   - Inner dialogue filtering
   - Reflection/dream filtering
   - Character limit (900 chars)
   - Recent memory tracking
   - Task context conditional

2. **Refactor persona_chat.ts:**
   - Import context builder
   - Replace lines 172-319 with `buildContextPackage()`
   - Keep fallback function for now (will be used by context builder)
   - Update tests

3. **Test thoroughly:**
   - Run benchmark: before vs after
   - Test all 3 modes (dual, agent, emulation)
   - Test edge cases (no index, empty results, etc.)
   - Check audit logs

4. **Deploy with rollback plan:**
   - Keep old code in git history
   - Deploy to dev first
   - Monitor for 24 hours
   - If issues, revert is ONE file change

**Impact:** Low risk - Pure refactor, same behavior

### Phase 3: Cleanup (Future)

**After context builder proven stable:**

1. Remove old inline code (already refactored)
2. Move `loadPersonaFallbackContext()` into context-builder.ts
3. Add pattern recognition (future enhancement)
4. Add context caching (performance)

---

## Migration Checklist

### Before Refactoring

- [ ] Run baseline benchmarks: `./tests/benchmark-cognitive-baseline.sh`
- [ ] Save results: `logs/benchmarks/baseline-before.txt`
- [ ] Git commit current working state
- [ ] Create feature branch: `git checkout -b context-builder-integration`

### Edge Cases to Add to Context Builder

- [ ] Filter `inner_dialogue` type memories
- [ ] Filter memories tagged with `reflection` or `dream`
- [ ] Limit to 2 memories (not all 8 from semantic search)
- [ ] Cap total context at 900 characters
- [ ] Track recent memory IDs per mode to avoid repetition
- [ ] Conditional task context (only if user mentions tasks)
- [ ] Conditional persona context (exclude when using LoRA)

### Refactoring persona_chat.ts

- [ ] Import context builder functions
- [ ] Replace context retrieval section (lines 172-319)
- [ ] Preserve mode-specific behavior (dual/agent/emulation)
- [ ] Keep existing fallback function (will be called by context builder)
- [ ] Update audit logging (context builder adds its own events)
- [ ] Test compilation: `pnpm tsc`

### Testing

- [ ] Run benchmarks after changes
- [ ] Compare before/after: latency should be similar (< 50ms diff)
- [ ] Test emulation mode (read-only)
- [ ] Test agent mode (heuristic routing)
- [ ] Test dual mode (semantic search required)
- [ ] Test with no semantic index (fallback behavior)
- [ ] Test with empty search results
- [ ] Check audit logs for new events

### Deployment

- [ ] Merge to main (after testing passes)
- [ ] Deploy to production
- [ ] Monitor for 24 hours
- [ ] Check error logs
- [ ] If issues: `git revert` (one commit)

---

## Rollback Plan

### If Something Breaks

**Time to Rollback:** < 5 minutes

**Steps:**
```bash
# 1. Revert the commit
git revert HEAD

# 2. Rebuild
pnpm install

# 3. Restart dev server
cd apps/site && pnpm dev

# 4. Verify system working
./tests/benchmark-cognitive-baseline.sh
```

**What Gets Reverted:**
- `persona_chat.ts` goes back to old inline code
- Context builder stays in core (unused, harmless)
- No data loss (memory files unchanged)
- No config changes (models.json unchanged)

**What Stays:**
- All memory files (unchanged)
- Audit logs (extra events, but harmless)
- Benchmark baseline (useful for debugging)

---

## Will There Be Bloat or Legacy Systems?

### ❌ No Bloat

**After Refactoring:**
- Old code REMOVED (not duplicated)
- Lines of code: 150 → 10 (reduction!)
- Context builder is the NEW way (not parallel system)

**No Parallel Systems:**
- Old: Inline context retrieval in persona_chat.ts
- New: Context builder module
- No duplication - old code deleted after refactor

### ❌ No Broken Links

**What Could Break:**
- persona_chat.ts imports (all internal to that file)
- No external dependencies on removed code
- No API changes (external links safe)

**Safe Dependencies:**
- Context builder uses existing functions:
  - `queryIndex()` - Still exists
  - `loadPersonaCore()` - Still exists
  - `loadShortTermState()` - Still exists
  - All dependencies preserved

### ❌ No Legacy Systems

**Clean Architecture:**
- Context builder is THE way to get context
- No "old path" and "new path"
- Single source of truth

**Future Additions:**
- Pattern recognition → Added to context builder
- Smarter fallbacks → Added to context builder
- LoRA integration → Uses context builder

---

## Benefits of Context Builder

### 1. Better Testing

**Before:**
```typescript
// Can't test memory retrieval separately from chat endpoint
// Must mock entire HTTP request
```

**After:**
```typescript
// Can test context builder in isolation
const context = await buildContextPackage('test message', 'dual');
expect(context.memories.length).toBeGreaterThan(0);
```

### 2. Reusability

**Before:**
- Memory retrieval locked inside persona_chat.ts
- Can't reuse for other features

**After:**
- Context builder usable anywhere:
  - CLI commands
  - Agents
  - Future skills
  - New API endpoints

### 3. Better Observability

**Before:**
- No metrics on context retrieval
- Hard to debug "why did it use these memories?"

**After:**
- Every context package logged with metrics
- Can analyze: retrieval time, memory hits, fallback usage
- Easier debugging

### 4. Future-Ready

**Before:**
- Adding features means editing persona_chat.ts
- Risk of breaking chat while adding features

**After:**
- Add features to context builder (separate module)
- Test context builder independently
- Chat endpoint stays stable

---

## Final Recommendation

### 🟢 Safe to Proceed

**Why:**
1. **Low Risk:** Pure refactor, same logic
2. **Reversible:** One file change, easy rollback
3. **Tested:** Benchmark script catches regressions
4. **Incremental:** Can test thoroughly before deploying
5. **No Breaking Changes:** API unchanged, users unaffected

**Next Steps:**
1. Add missing edge cases to context builder (1 hour)
2. Refactor persona_chat.ts (2 hours)
3. Test all modes thoroughly (2 hours)
4. Deploy with monitoring (ongoing)

**Total Time:** ~5 hours of focused work
**Risk:** Low
**Value:** High (foundation for future enhancements)

---

## Questions Answered

### Q: Will it break anything?

**A:** No. Pure refactor of existing logic. Same inputs, same outputs. Thoroughly tested before deployment. Easy rollback if issues.

### Q: Is there existing code that could be adapted?

**A:** Yes! Context builder REUSES existing functions:
- `queryIndex()` - Memory search
- `loadPersonaCore()` - Identity
- `loadShortTermState()` - Orchestrator state
- `loadPersonaFallbackContext()` - Fallback

Nothing rebuilt from scratch. Just reorganized.

### Q: Will there be legacy systems or bloat?

**A:** No. Old inline code will be DELETED after refactoring. Context builder replaces it, not duplicates it. Clean architecture, single source of truth.

### Q: Will there be broken links?

**A:** No. All changes internal to persona_chat.ts. No API changes. External links (web UI, CLI) unchanged. Dependencies preserved.

---

**Verdict:** ✅ Safe to implement with proper testing and staged rollout.

**End of Impact Analysis**
