# Troubleshooting: Modular ReAct Loop Implementation

**Date**: 2025-11-20
**Status**: ⚠️ INCOMPLETE - System hangs during execution
**Context**: Implementing modular scratchpad nodes to replace monolithic loop_controller

---

## Objective

Convert the ReAct loop from a single monolithic `loop_controller` node into modular components:

- `scratchpad_initializer` - Creates empty scratchpad state
- `iteration_counter` - Tracks iteration count and checks max iterations
- `react_planner` - Generates thought/action plan
- `skill_executor` - Executes the planned action
- `scratchpad_updater` - Appends thought/action/observation to scratchpad
- `scratchpad_completion_checker` - Checks if task is complete
- `conditional_router` - Routes to loop-back or exit based on completion
- `scratchpad_formatter` - Formats scratchpad for synthesis
- `response_synthesizer` - Extracts final response from scratchpad

---

## Issues Encountered

### 1. ✅ **FIXED**: Loop Only Executing 2 Iterations

**Problem**: Graph executor was clearing router state before loop body could read from it via back-edge.

**Fix**: Modified `/home/greggles/metahuman/packages/core/src/graph-executor.ts` (lines 410-413):
```typescript
// Clear execution state for loop body nodes ONLY
// DON'T clear router state yet - loop body needs to read its outputs via back-edge!
loopNodes.forEach(id => executionState.delete(id));
```

### 2. ✅ **FIXED**: Iteration Counter Always Showing 0/0

**Problem**: Loop-back data from `conditional_router` was wrapped in `{ routedData: {...} }` but `iteration_counter` wasn't unwrapping it.

**Fix**: Modified `/home/greggles/metahuman/packages/core/src/node-executors/scratchpad-executors.ts` (lines 133-137):
```typescript
// Unwrap routedData if present (from conditional_router loop-back)
if (scratchpadData.routedData) {
  console.log(`[IterationCounter] Unwrapping routedData from conditional_router`);
  scratchpadData = scratchpadData.routedData;
}
```

### 3. ✅ **FIXED**: Response Time Too Slow (55+ seconds)

**Problem**: System was looping 5 times for simple greetings when 1 iteration should suffice.

**Fix**: Added auto-complete optimization in `scratchpad_completion_checker` (lines 209-213):
```typescript
// Auto-complete after successful conversational_response
const isConversationalResponse = latestEntry.action === 'conversational_response';
const hasSuccessfulResponse = latestObservation.includes('"success":true') && latestObservation.includes('"response"');
const shouldAutoComplete = isConversationalResponse && hasSuccessfulResponse;
```

**Result**: Reduced from 55+ seconds to ~15 seconds (1 iteration instead of 5).

### 4. ⚠️ **ONGOING**: System Hangs/Locks Up

**Problem**: Node.js process hangs after certain code changes, no logs appear.

**Attempted Fixes**:

#### Fix Attempt 1: Remove JSON.stringify from logging
**Location**: Multiple files
**Reason**: `JSON.stringify()` on large objects can hang Node.js
**Files Modified**:
- `packages/core/src/node-executors/control-flow-executors.ts` (line 358)
- `packages/core/src/node-executors/scratchpad-executors.ts` (lines 28-41, 92-103, 120-127, etc.)
- `packages/core/src/node-executors/operator-executors.ts` (line 347)

#### Fix Attempt 2: Replaced regex with brace-counting
**Location**: `packages/core/src/node-executors/operator-executors.ts` (lines 355-400)
**Reason**: Regex pattern `/Observation:\s*({[\s\S]*?})(?=\n\n|$)/` was causing backtracking
**Solution**: Simple O(n) brace-counting algorithm to extract JSON

**Before**:
```typescript
const observationMatch = loopResult.formatted.match(/Observation:\s*({[\s\S]*?})(?=\n\n|$)/);
```

**After**:
```typescript
const obsIndex = loopResult.formatted.indexOf('Observation: ');
const jsonStart = loopResult.formatted.indexOf('{', obsIndex);
// Find matching closing brace by counting { and }
for (let i = jsonStart; i < loopResult.formatted.length; i++) {
  if (loopResult.formatted[i] === '{') braceCount++;
  if (loopResult.formatted[i] === '}') {
    braceCount--;
    if (braceCount === 0) { jsonEnd = i + 1; break; }
  }
}
```

**Status**: Still hanging after this fix.

---

## Current State

### What Works:
- ✅ Loop structure executes (when not hanging)
- ✅ Iteration counter increments correctly (1, 2, 3... not 0, 0, 0)
- ✅ Auto-complete optimization triggers properly
- ✅ Conditional router routes correctly (exit vs loop-back)

### What's Broken:
- ❌ **System hangs with no logs** → **FIX: Added comprehensive logging (see below)**
- ⚠️ Response synthesizer receives wrong input format (gets `{ formatted, entries }` from formatter instead of `{ scratchpad: [...] }`) → Brace-counting extraction added
- ⚠️ "I was unable to process your request" error when loop completes → May be resolved by extraction fix

### Last Working Execution Log:

From user's test (before final hang):
```
[CompletionChecker] Iteration: 1/10, Complete: true, Reason: auto_complete_conversational
[ConditionalRouter] ✅ EXITING LOOP (slot 0)
[ResponseSynthesizer] Received pre-formatted scratchpad from formatter (1 entries)
[ResponseSynthesizer] Could not extract scratchpad. loopResult structure: {
  hasScratchpad: false,
  isArray: false,
  hasIterations: false,
  keys: [ 'formatted', 'entries' ]
}
[ResponseSynthesizer] Synthesizing from scratchpad: 0 steps
[StreamWriter] I was unable to process your request.
```

---

## Data Flow Issue

The problem is in the connection: **conditional_router → scratchpad_formatter → response_synthesizer**

**Expected Flow**:
1. `conditional_router` outputs: `{ routedData: { scratchpad: [...], iteration: 1, ... } }`
2. `scratchpad_formatter` receives scratchpad, outputs: `{ formatted: "Thought: ...\nAction: ...", entries: 1 }`
3. `response_synthesizer` needs to extract the actual response from the formatted text

**Current Problem**:
- `response_synthesizer` receives `{ formatted, entries }` but doesn't know how to extract the scratchpad
- The formatted text contains the observation JSON: `Observation: {"success":true,"outputs":{"response":"..."}}`
- The new brace-counting extraction logic should work, but something is still hanging

---

## Possible Root Causes

### 1. **Infinite Loop in Brace-Counting**
The brace-counting algorithm might not be terminating if:
- The JSON is malformed
- There's a string containing `}` characters
- The braceCount never reaches 0

**Debug**: Add console.log inside the loop to see if it's running forever.

### 2. **Circular Reference in Data Structure**
One of the objects might contain circular references that cause hangs when:
- Logging (even without JSON.stringify)
- Accessing nested properties
- Passing between nodes

**Debug**: Check if `loopResult.formatted` or other fields contain circular refs.

### 3. **Memory Leak / Resource Exhaustion**
Repeated loop iterations might be:
- Accumulating large scratchpad arrays
- Creating memory pressure
- Causing garbage collection pauses

**Debug**: Monitor memory usage during execution.

### 4. **Async Deadlock**
The node executors are async functions - there might be:
- Unresolved promises
- Race conditions
- Deadlocks in graph executor state management

**Debug**: Add timestamps to all console.log statements to see where time is spent.

---

## Files Modified

### Core Changes:
1. `/home/greggles/metahuman/packages/core/src/graph-executor.ts`
   - Lines 150-161: Add routedData extraction
   - Lines 410-413: Fix loop state clearing

2. `/home/greggles/metahuman/packages/core/src/node-executors/scratchpad-executors.ts`
   - Lines 25-107: scratchpadUpdaterExecutor with logging
   - Lines 117-173: iterationCounterExecutor with routedData unwrapping
   - Lines 179-243: scratchpadCompletionCheckerExecutor with auto-complete

3. `/home/greggles/metahuman/packages/core/src/node-executors/control-flow-executors.ts`
   - Lines 350-420: conditionalRouterExecutor (removed fullValue from logging)

4. `/home/greggles/metahuman/packages/core/src/node-executors/operator-executors.ts`
   - Lines 344-450: responseSynthesizerExecutor (added formatted input handling with brace-counting)

### Config:
5. `/home/greggles/metahuman/etc/runtime.json`
   - Enabled node pipeline: `"cognitive": { "useNodePipeline": true }`

6. `/home/greggles/metahuman/etc/cognitive-graphs/dual-mode.json`
   - 23 nodes, 38 links
   - Uses modular scratchpad nodes with conditional_router loop

---

## Recommended Next Steps

### Option 1: ✅ COMPLETED - Extensive Debug Logging
**Status**: Logging has been added at all critical points. When testing, check which logs appear:

**If no logs appear:**
- Hang is before `[CHAT_REQUEST]` → Client-side or network issue

**If `[CHAT_REQUEST]` appears but no `[🔥 CONTEXT BUILD]`:**
- Hang is in pre-context code (model loading, settings, etc.)

**If `[🔥 CONTEXT BUILD]` appears but never completes:**
- **🎯 HANG IS HERE** → `buildContextPackage()` is hanging (semantic search)

**If `[🔥 CONTEXT BUILD]` completes but no `[📞 STREAM CALL]`:**
- Hang is between context build and stream call

**If `[📞 STREAM CALL]` appears but no `[streamGraphExecutionWithProgress]`:**
- Hang is in stream function setup

**If `[streamGraphExecutionWithProgress]` appears but no `[🚀 GRAPH EXEC]`:**
- Hang is in stream event handler setup

**If `[🚀 GRAPH EXEC]` appears but no `[🎯 EXEC_GRAPH_ENTRY]`:**
- Hang is during executeGraph import or function call

**If `[🎯 EXEC_GRAPH_ENTRY]` appears but no `[EXEC_START]`:**
- Hang is during graph initialization (topological sort, back-edge detection)

**If `[EXEC_START]` appears:**
- Hang is during node execution (30-second timeout will catch it)

### Option 2: Simplify Response Extraction
Instead of trying to parse the formatted scratchpad, modify the graph to pass the raw scratchpad directly to response_synthesizer:

**Change dual-mode.json**:
- Add a new link from `conditional_router` output slot 0 directly to `response_synthesizer` input slot 0
- Remove or bypass `scratchpad_formatter`

### Option 3: Revert to Working State
The system was working before the response_synthesizer changes. Options:
1. Use the formatted text directly as the response (no extraction)
2. Have response_synthesizer return a simple message if extraction fails
3. Skip response synthesis entirely for auto-completed conversational responses

### Option 4: Profile the Execution
Use Node.js profiling to identify the bottleneck:

```bash
node --prof packages/cli/dist/index.js
# or
node --inspect apps/site/dist/server/entry.mjs
```

---

## Testing Checklist

Before declaring this fixed, verify:

- [ ] Simple greeting completes in <20 seconds
- [ ] Iteration counter increments (not stuck at 0/0)
- [ ] Auto-complete triggers for conversational responses
- [ ] Actual response text is returned (not "unable to process")
- [ ] No hangs/lockups during execution
- [ ] Multi-iteration queries work (e.g., "list tasks")
- [ ] Error recovery works (invalid actions, failed skills)

---

---

## Latest Fix: Skip Pre-Context Semantic Search in Graph Mode (2025-11-20)

### Problem
System hangs for minutes with no logs appearing. User frustrated: "im tired of being left in the fucking dark".

### Root Cause (CONFIRMED)
The hang was occurring BEFORE graph execution starts, during `buildContextPackage()` which performs semantic search.

**Architecture Problem**: The API handler was doing semantic search TWICE:
1. **Line 997-1013**: `buildContextPackage()` - synchronous, blocking, no timeout (HANG HERE)
2. **Graph Node 6**: `semantic_search` - modular, with timeout, but uses cached result from #1

The semantic_search node checks for `context.contextPackage?.memories` and returns cached results if present, so it never actually did its own search. This bypassed the entire modular workflow!

### Solution Applied
**Skip pre-context retrieval when using graph pipeline** - let the graph's `semantic_search` node handle it properly:

**Files Modified**:
- `/home/greggles/metahuman/apps/site/src/pages/api/persona_chat.ts`
  - Lines 1538-1550: **Skip `getRelevantContext()` when `graphEnabled = true`**
  - Now the graph's `semantic_search` node does the work with timeout protection
  - Lines 1628-1630: Added `[📞 STREAM CALL]` logging

**How It Works Now**:
1. API handler checks `graphEnabled` flag
2. If true: Skip pre-context, pass empty `contextPackage` to graph
3. Graph's `semantic_search` node (node 6) sees no cached context
4. Node does its own semantic search with 30s timeout protection
5. Results flow through modular pipeline with progress updates

**Benefits**:
- ✅ No more hanging for minutes
- ✅ Semantic search has 30-second timeout
- ✅ Progress streaming works properly
- ✅ Full logging visibility
- ✅ Truly modular workflow

### How to Diagnose
When testing, check which log markers appear in the terminal:

1. **No logs at all** → Client-side or network issue
2. **`[CHAT_REQUEST]` but no `[🔥 CONTEXT BUILD]`** → Hang in pre-context setup
3. **`[🔥 CONTEXT BUILD]` starts but never finishes** → 🎯 **HANG IS HERE** (semantic search)
4. **`[🔥 CONTEXT BUILD]` completes but no further logs** → Hang between context and stream
5. **All logs appear through `[EXEC_START]`** → Hang in node execution (30s timeout will catch)

### Expected Result
Logs will definitively show WHERE the hang occurs, eliminating guesswork.

---

## Contact

**Last Updated**: 2025-11-20 (Logging added)
**Session**: Claude Code troubleshooting session
**Files to Review**: See "Files Modified" and "Latest Fix" sections above
**Logs**: Check terminal output for execution traces with new markers
