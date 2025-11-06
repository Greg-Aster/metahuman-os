# Context Passing Fix - Dream Memory Retrieval

## Problem
When users asked about dreams (e.g., "Can you tell me what you dreamed about last night?"), the AI gave generic responses like "I don't experience dreams like humans do" instead of referencing actual dream memories stored in the system.

**Root Cause:** The operator fast-path hardcoded an empty context string when calling the `conversational_response` skill, even though context was being successfully retrieved from semantic search.

## Audit Log Evidence
```json
{
  "event": "react_fastpath_chat",
  "details": {
    "skillId": "conversational_response",
    "inputs": {
      "message": "Can you tell me what you dreamed about last night?",
      "context": ""   // ← EMPTY! Despite context being retrieved
    }
  }
}
```

## Context Flow (Before Fix)
1. ✅ `persona_chat.ts` - Builds context with semantic search (retrieves 2 dream memories)
2. ✅ `persona_chat.ts` - Sends context to `/api/operator/react` in request body
3. ✅ `/api/operator/react.ts` - Receives `taskContext` parameter
4. ❌ `/api/operator/react.ts` - **Doesn't pass it** to `runCompleteReActTask()`
5. ❌ `operator-react.ts` - OperatorTask interface **has no context field**
6. ❌ `operator-react.ts` line 178 - **Hardcodes empty string**: `context: ""`

## Files Changed

### 1. `/brain/agents/operator-react.ts`
**Added context field to OperatorTask interface:**
```typescript
export interface OperatorTask {
  id: string;
  goal: string;
  audience?: string;
  context?: string;      // ✅ NEW
  status: 'in_progress' | 'completed' | 'failed';
  created: string;
}
```

**Fixed fast-path to use task.context:**
```typescript
// BEFORE (line 178)
{ message: task.goal, context: '' }

// AFTER
{ message: task.goal, context: task.context || '' }
```

### 2. `/apps/site/src/pages/api/operator/react.ts`
**Updated function signatures to accept context:**
```typescript
// BEFORE
async function runCompleteReActTask(goal: string, audience?: string, reasoningDepth?: number)
function streamReActTask(goal: string, audience?: string, reasoningDepth?: number)

// AFTER
async function runCompleteReActTask(goal: string, audience?: string, context?: string, reasoningDepth?: number)
function streamReActTask(goal: string, audience?: string, context?: string, reasoningDepth?: number)
```

**Pass context when creating OperatorTask:**
```typescript
const task: OperatorTask = {
  id: `task-${Date.now()}`,
  goal,
  audience,
  context,       // ✅ NEW
  status: 'in_progress',
  created: new Date().toISOString(),
};
```

**Pass taskContext to both functions:**
```typescript
// BEFORE
return streamReActTask(goal, audience, reasoningDepth);
return runCompleteReActTask(goal, audience, reasoningDepth);

// AFTER
return streamReActTask(goal, audience, taskContext, reasoningDepth);
return runCompleteReActTask(goal, audience, taskContext, reasoningDepth);
```

## Context Flow (After Fix)
1. ✅ `persona_chat.ts` - Builds context with semantic search
2. ✅ `persona_chat.ts` - Sends `context: operatorContext` to `/api/operator/react`
3. ✅ `react.ts` - Receives `taskContext` from request body
4. ✅ `react.ts` - Passes `taskContext` to `runCompleteReActTask(goal, audience, taskContext, reasoningDepth)`
5. ✅ `runCompleteReActTask()` - Creates `OperatorTask` with `context: taskContext`
6. ✅ `operator-react.ts` - Fast-path uses `context: task.context || ''`
7. ✅ `conversational_response` skill - Receives context with dream memories!

## Test Results
```
✅ Context built: 2 memories retrieved
  - [dream] Score: 0.571
    **The Sieve Dreams**...
  - [reflection_summary] Score: 0.556

✅ Context formatted (1162 chars)
🎉 Context now flows end-to-end from memory retrieval to skill execution!
```

## Related Fixes (Already Complete)
1. ✅ Persona context injection - `includePersonaSummary` implementation
2. ✅ Memory field mapping - Fixed `hit.content` → `hit.item.text`
3. ✅ Dream filtering - Check both `tags` and `type` fields
4. ✅ Smart filtering - Detect dream queries, lower threshold to 0.55
5. ✅ Missing API endpoint - Created `/api/index` for memory tab

## Expected Behavior Now
When user asks: **"Can you tell me what you dreamed about last night?"**

The AI should:
1. Retrieve dream memories from semantic index (score ~0.57)
2. Pass them as context to the conversational_response skill
3. Respond with actual dream content like:
   > "Last night I dreamed about **The Sieve Dreams**... I stood before an infinite ocean, my hands cupped as if catching water..."

Instead of the generic:
   > "I don't experience dreams like humans do."

## Testing
Run the test script:
```bash
npx tsx test-context-passing.mjs
```

Or test in the web UI:
1. Navigate to http://localhost:4321
2. Ask: "Can you tell me what you dreamed about last night?"
3. Check audit stream for `"context": "..."` (should contain dream content)
4. Verify AI response references actual dream memories
