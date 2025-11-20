# Logging Cleanup - 2025-11-20

## Summary

Reduced excessive debug logging across the system to improve readability during development.

## Changes Made

### 1. **Removed Debug Logs** (Completely Removed)

#### `apps/site/src/pages/api/persona_chat.ts`
- ❌ Removed `[🚨 GET HANDLER]` logs (7 lines)
  - User info dumps
  - Session cookie logging
  - URL logging
  - Message preview
- ❌ Removed `[📞 STREAM CALL]` logs (3 lines)
  - Before/after timestamps
  - Success messages
- ❌ Removed `[🚀 GRAPH EXEC]` logs (3 lines)
  - Execution timestamps
  - Graph info dumps

#### `packages/core/src/tts.ts`
- ❌ Removed `[createTTSService]` logs (4 lines)
  - getUserContext() object dump (huge JSON)
  - Provider selection logs
  - Configuration dumps

#### `packages/core/src/tts/providers/kokoro-service.ts`
- ❌ Removed `[KokoroService]` verbose logs (3 lines)
  - synthesize() parameter dumps
  - Cached audio messages
  - PID repair messages (kept warnings/errors)

### 2. **Guarded with DEBUG_GRAPH** (Conditional Logging)

#### `packages/core/src/graph-executor.ts`
- 🔒 Guarded `[EXEC_START]` logs
  - Only shows when `DEBUG_GRAPH=1` environment variable is set
- 🔒 Guarded `[EXEC_END]` logs
  - Only shows when `DEBUG_GRAPH=1` environment variable is set

#### `packages/core/src/node-executors/*.ts`
- 🔒 Guarded all node executor verbose logs:
  - `[ReactPlanner]` logs
  - `[ScratchpadUpdater]` logs
  - `[ConditionalRouter]` logs
  - `[IterationCounter]` logs
  - `[CompletionChecker]` logs
  - `[ResponseSynthesizer]` logs
  - `[GraphExecutor]` routing decisions

All of these now require `DEBUG_GRAPH=1` to show.

## Expected Output Reduction

### Before (Excessive):
```
[🚨 GET HANDLER] ========== REQUEST RECEIVED at 2025-11-20T23:15:37.964Z ==========
[🚨 GET HANDLER] User: greggles (owner)
[🚨 GET HANDLER] User object: { ... 20 lines ... }
[🚨 GET HANDLER] Session cookie: fe4a99d2-32a8-4fcb-b978-98267ed0357e
[🚨 GET HANDLER] URL: /api/persona_chat?message=Tell+me+...
[🚨 GET HANDLER] Message: "Tell me how you will take over the world?"
[CHAT_REQUEST] Received: "Tell me how you will take over the world?"
[📞 STREAM CALL] ========== BEFORE streamGraphExecutionWithProgress ...
[🚀 GRAPH EXEC] About to call executeGraph() ...
[🚀 GRAPH EXEC] Graph: Dual Consciousness Mode, Nodes: 23
[🚀 GRAPH EXEC] executeGraph() called, promise created
[EXEC_START] Node 1 (user_input) starting at 2025-11-20T23:15:37.970Z
[EXEC_END] Node 1 (user_input) completed in 1ms
[EXEC_START] Node 3 (system_settings) starting at 2025-11-20T23:15:37.971Z
[EXEC_END] Node 3 (system_settings) completed in 0ms
... 40+ more node execution logs ...
[ReactPlanner] ========== REACT PLANNER ==========
[ReactPlanner] Received 3 inputs
... 20+ detailed planner logs ...
[createTTSService] getUserContext(): { ... 100+ lines of JSON ... }
[KokoroService] synthesize called: { ... verbose params ... }
```

### After (Clean):
```
[CHAT_REQUEST] Received: "Tell me how you will take over the world?"
[CHAT_REQUEST] ✅ Graph-only mode - model resolution handled by model_resolver node
[CHAT_REQUEST] Cognitive Mode: dual
[CHAT_REQUEST] Authenticated: true
[CHAT_REQUEST] Routing decision: REACT_OPERATOR (unified)
[persona_chat] graphEnabled=true, cognitiveMode=dual, useOperator=true
[persona_chat] 🔄 Attempting graph pipeline for mode: dual
[graph-pipeline] 🚀 Starting execution: Dual Consciousness Mode (Modular ReAct) v2.0
[graph-pipeline] ✅ COMPLETE: 23 total node executions in 19126ms
```

## Enabling Debug Logs

To see the verbose logs again for debugging:

```bash
# Enable graph execution logs
export DEBUG_GRAPH=1
pnpm dev

# Or for a single run
DEBUG_GRAPH=1 pnpm dev
```

## What's Still Logged

✅ **Kept Important Logs:**
- `[CHAT_REQUEST]` - Request routing decisions
- `[persona_chat]` - High-level pipeline steps
- `[graph-pipeline]` - Start/complete messages
- `[embeddings]` - Model downloads (important for first run)
- Warnings and errors (always logged)

## Files Modified

- `apps/site/src/pages/api/persona_chat.ts`
- `packages/core/src/graph-executor.ts`
- `packages/core/src/tts.ts`
- `packages/core/src/tts/providers/kokoro-service.ts`
- `packages/core/src/node-executors/operator-executors.ts`
- `packages/core/src/node-executors/scratchpad-executors.ts`
- `packages/core/src/node-executors/control-flow-executors.ts`
- `packages/core/src/node-executors/output-executors.ts`

## Verification

Count of debug logs removed/guarded:
- Completely removed: ~20 console.log statements
- Guarded with DEBUG_GRAPH: ~50+ console.log statements

Total reduction: ~70 verbose log statements per request
