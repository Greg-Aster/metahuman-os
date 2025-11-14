# Function Memory System - Bug Fix Report

**Date**: November 14, 2025
**Status**: ✅ RESOLVED
**Severity**: Critical - Function retrieval was completely non-functional

## Issue Summary

The function memory system was failing to retrieve function guides during operator execution, despite having 7 seeded verified functions in the database. Operator requests showed:
- `Semantic Search: false`
- `Memories: 0`
- No function guides retrieved
- Operator crashes after timeout

## Root Cause

**Bug Location**: [packages/core/src/paths.ts:181-224](../packages/core/src/paths.ts#L181-L224)

The `paths` Proxy object has a fallback mechanism for CLI/system operations (when no user context exists). This fallback returns the `rootPaths` object, which **did not include function memory paths**.

```typescript
// BEFORE (missing function paths):
const rootPaths = {
  // ... other paths ...
  curiosity: path.join(ROOT, 'memory', 'curiosity'),
  curiosityConfig: path.join(ROOT, 'etc', 'curiosity.json'),

  // Logs  ← Functions should have been here but weren't
  decisions: path.join(ROOT, 'logs', 'decisions'),
  // ...
};
```

When the vector index builder tried to access `paths.functions`, it received `undefined`, causing the indexing code to silently skip function files.

## Impact

1. ❌ Vector index contained 0 function entries
2. ❌ `retrieveFunctions()` always returned empty array
3. ❌ Operator never received function guides in context
4. ❌ Auto-learning and usage tracking never occurred
5. ❌ UI showed no functions despite 7 verified functions existing

## Fix Applied

**File**: [packages/core/src/paths.ts](../packages/core/src/paths.ts)

Added function memory paths to the `rootPaths` fallback object:

```typescript
// AFTER (fixed):
const rootPaths = {
  // ... other paths ...
  curiosity: path.join(ROOT, 'memory', 'curiosity'),
  curiosityConfig: path.join(ROOT, 'etc', 'curiosity.json'),

  // Function memory ← ADDED
  functions: path.join(ROOT, 'memory', 'functions'),
  functionsVerified: path.join(ROOT, 'memory', 'functions', 'verified'),
  functionsDrafts: path.join(ROOT, 'memory', 'functions', 'drafts'),

  // Logs
  decisions: path.join(ROOT, 'logs', 'decisions'),
  // ...
};
```

## Verification Steps

### 1. Path Resolution
```bash
npx tsx -e "import { paths } from './packages/core/src/paths.ts'; console.log('functions:', paths.functions);"
# BEFORE: functions: undefined
# AFTER:  functions: /home/greggles/metahuman/memory/functions
```

### 2. Vector Index Rebuild
```bash
./bin/mh index build
# BEFORE: Items: 1187 (0 functions)
# AFTER:  Items: 1194 (7 functions)
```

Breakdown after fix:
- 1176 episodic memories
- 11 tasks
- **7 functions** ✓

### 3. Semantic Search Test
```bash
./bin/mh index query "what tasks do I have?"
```

**Results**:
```
71.5%  memory/functions/verified/296718cb-25ee-47b2-a764-057b4c758b7b.json
       List and Summarize Active Tasks
```

### 4. Integration Test
Created [scripts/test-function-retrieval.ts](../../scripts/test-function-retrieval.ts) to verify `buildContextPackage()` retrieves functions:

**Results**:
```
Query: "what tasks do I have?"
✓ Function guides retrieved: 1
   - List and Summarize Active Tasks (71.5% match)

Query: "create a new task for testing"
✓ Function guides retrieved: 2
   - Create New Task (71.1% match)
   - Update Task Status (66.8% match)
```

## Why This Bug Occurred

The function memory system was implemented in phases:

1. **Phase 0-2**: Core function memory module created ([function-memory.ts](../packages/core/src/function-memory.ts))
2. **Phase 3**: Operator integration added ([operator-react.ts](../../brain/agents/operator-react.ts))
3. **Phase 4**: Context builder integration added ([context-builder.ts](../packages/core/src/context-builder.ts))
4. **Phase 5**: API and UI added

Function paths were added to:
- ✅ `getProfilePaths()` (line 77-79) - user-specific paths
- ✅ `systemPaths` fallback in exports (line 340-342) - after initial fallback
- ❌ **`rootPaths` object in Proxy fallback** - **MISSED**

The `rootPaths` object is the **first fallback** when no user context exists, so it takes precedence over the `systemPaths` section further down. This is why the paths worked in profile mode but failed in CLI mode.

## Lessons Learned

1. **Path system complexity**: The multi-layer fallback system (user paths → rootPaths → systemPaths) makes it easy to miss a layer
2. **Silent failures**: The vector index builder silently skipped functions when paths were undefined instead of throwing an error
3. **Integration testing**: Need end-to-end tests that verify the full pipeline (paths → index → retrieval → operator)
4. **Debug logging**: Added logging to [context-builder.ts:880-901](../packages/core/src/context-builder.ts#L880-L901) to trace function retrieval

## Related Files Modified

- [x] [packages/core/src/paths.ts](../packages/core/src/paths.ts) - Added function paths to rootPaths
- [x] [packages/core/src/context-builder.ts](../packages/core/src/context-builder.ts) - Added debug logging
- [x] [scripts/test-function-retrieval.ts](../../scripts/test-function-retrieval.ts) - Created integration test

## Current Status

✅ Function retrieval working
✅ Vector index contains all 7 seeded functions
✅ Semantic search returns relevant functions
✅ Context builder retrieves and injects function guides
⏳ **Next**: Test with actual operator execution
⏳ **Next**: Implement graceful failure handling (user request)

## Remaining Work

1. **Test Operator Integration**: Verify operator actually uses the provided function guides during execution
2. **Graceful Failure Handling**: When operator gets stuck/fails, ask user for guidance and learn from response (user suggestion)
3. **Usage Tracking**: Verify usage statistics are being recorded correctly
4. **Auto-Learning**: Test that multi-step patterns are being detected and saved as draft functions

## Testing Checklist

- [x] Paths resolve correctly in CLI mode
- [x] Vector index includes functions
- [x] Semantic search returns functions
- [x] Context builder retrieves functions
- [ ] Operator receives function guides in prompt
- [ ] Operator follows function guide steps
- [ ] Usage tracking increments counters
- [ ] Auto-learning creates draft functions
- [ ] Graceful failure handling (not yet implemented)
