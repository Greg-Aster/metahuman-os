# Legacy Code Cleanup Plan

**Date**: 2025-11-20
**Status**: In Progress
**Priority**: High (blocks are causing system hangs)

---

## Overview

The codebase has legacy code paths that duplicate functionality now handled by the graph pipeline. This legacy code:

- ❌ Can hang for minutes (semantic search with no timeout)
- ❌ Has no progress streaming
- ❌ Has no logging visibility
- ❌ Bypasses the modular node system
- ❌ Makes debugging impossible

**Goal**: Remove all legacy code once graph pipeline is stable.

---

## Deprecated Code

### 1. `getRelevantContext()` - DEPRECATED ⚠️

**Location**: `/home/greggles/metahuman/apps/site/src/pages/api/persona_chat.ts:957-1053`

**Problem**: Performs synchronous semantic search that can hang for minutes with no timeout protection.

**Replacement**: Graph pipeline's `semantic_search` node (node 6) with:
- ✅ 30-second timeout
- ✅ Progress streaming
- ✅ Full logging
- ✅ Modular workflow

**Status**:
- ✅ Marked with `@deprecated` JSDoc
- ✅ Console warnings added
- ✅ Only runs when `graphEnabled = false`
- 🔜 **TODO**: Remove entirely once graph pipeline is stable

**Why It's Still Here**: Fallback for when graph pipeline is disabled via `etc/runtime.json` → `cognitive.useNodePipeline = false`

---

### 2. Legacy Chat Path - DEPRECATED ⚠️

**Location**: `/home/greggles/metahuman/apps/site/src/pages/api/persona_chat.ts:1659-2000+`

**Problem**: Entire legacy operator/chat implementation that duplicates graph functionality.

**Replacement**: Graph pipeline handles all chat modes via modular nodes.

**Status**:
- ✅ Warning added: "FALLBACK TO LEGACY PATH"
- ✅ Only runs when `graphEnabled = false`
- 🔜 **TODO**: Remove entirely once graph pipeline is stable

---

## Current Configuration

**Graph Pipeline Status** (`etc/runtime.json`):
```json
{
  "cognitive": {
    "useNodePipeline": true
  }
}
```

**When `useNodePipeline = true`** (current state):
- ✅ Graph pipeline is used
- ✅ Semantic search happens in nodes with timeout protection
- ✅ No legacy code runs

**When `useNodePipeline = false`** (fallback):
- ⚠️ Legacy `getRelevantContext()` runs (can hang!)
- ⚠️ No timeout protection
- ⚠️ Deprecation warnings appear in logs

---

## Removal Timeline

### Phase 1: ✅ COMPLETE (2025-11-20)
- [x] Identify the hang (semantic search in `buildContextPackage()`)
- [x] Skip pre-context when graph pipeline enabled
- [x] Add `@deprecated` warnings
- [x] Document legacy code

### Phase 2: Testing (Next 1-2 weeks)
- [ ] Verify graph pipeline stability
- [ ] Test all cognitive modes (dual, agent, emulation)
- [ ] Test multi-iteration queries
- [ ] Test error recovery
- [ ] Test with large memory indexes

### Phase 3: Removal (Once stable)
- [ ] Set `useNodePipeline: true` as hardcoded default
- [ ] Remove `getRelevantContext()` function entirely
- [ ] Remove legacy chat path (lines 1659-2000+)
- [ ] Clean up unused imports
- [ ] Update documentation

---

## Testing Checklist

Before removing legacy code, verify:

- [x] Simple greeting completes in <20 seconds
- [x] Iteration counter increments (not stuck at 0/0)
- [x] Auto-complete triggers for conversational responses
- [ ] Actual response text is returned (not "unable to process")
- [ ] No hangs/lockups during execution
- [ ] Multi-iteration queries work (e.g., "list tasks")
- [ ] Error recovery works (invalid actions, failed skills)
- [ ] Semantic search returns relevant results
- [ ] Task context included when mentioned
- [ ] Dream/reflection queries work with metadata filters

---

## How to Disable Legacy Code (For Testing)

**Option 1**: Hardcode graph pipeline (recommended for testing)
```typescript
// In persona_chat.ts, line ~1469
const pipelineFlag = true; // Force graph pipeline
graphEnabled = typeof graphPipelineOverride === 'boolean' ? graphPipelineOverride : pipelineFlag;
```

**Option 2**: Set runtime flag
```bash
# Edit etc/runtime.json
{
  "cognitive": {
    "useNodePipeline": true
  }
}
```

**Option 3**: Remove the conditional entirely (nuclear option)
```typescript
// Replace the entire context retrieval section with:
let contextInfo = '';
let usedSemantic = false;
let contextPackage: any = {};
console.log(`[CHAT_REQUEST] ✅ Using graph pipeline - semantic search handled by nodes`);
```

---

## Files to Remove (Eventually)

Once graph pipeline is stable and all tests pass:

1. **Delete**: `getRelevantContext()` function (lines 957-1053)
2. **Delete**: Legacy chat path (lines 1659-2000+)
3. **Clean up**: Remove related imports for `buildContextPackage`, `formatContextForPrompt`
4. **Update**: All documentation referencing legacy paths

**Estimated LOC Removal**: ~500-700 lines

---

## Related Issues

- **Root Cause**: Semantic search hanging (fixed by using graph nodes)
- **Symptom**: "Left in the fucking dark" - no logs during hang
- **Fix**: Skip pre-context when `graphEnabled = true`
- **Documentation**: `docs/TROUBLESHOOTING-MODULAR-REACT.md:276-326`

---

## Contact

**Last Updated**: 2025-11-20
**Owner**: Claude Code troubleshooting session
**Next Review**: After 1 week of stable graph pipeline operation
