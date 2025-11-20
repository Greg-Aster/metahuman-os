# Graph Migration TODO - Continue Tomorrow

**Created**: 2025-11-20
**Goal**: Remove all legacy code from persona_chat.ts handler and force graph-only mode

## Current State

### ✅ What Works in Node System
- **Semantic Search Node** (`semantic_search` executor)
  - Location: `packages/core/src/node-executors/context-executors.ts:109-144`
  - Status: ✅ **FULLY IMPLEMENTED**
  - Calls `queryIndex()` with proper error handling
  - Safe to delete from handler immediately

### ⚠️ What Needs Implementation
- **Model Resolution Node** (`model_resolver` executor)
  - Location: `packages/core/src/node-executors/llm-executors.ts:84-93`
  - Status: ⚠️ **STUB ONLY** - needs proper implementation
  - Currently returns: `{ modelId: 'default', role }`
  - **Must be implemented before deleting handler code**

## Step-by-Step Plan

### Phase 1: Implement Model Resolver Node (DO FIRST)
1. Read the handler's model resolution code:
   - File: `apps/site/src/pages/api/persona_chat.ts`
   - Lines: ~1435-1509 (the `if (!graphEnabled)` block)

2. Port logic to `modelResolverExecutor`:
   ```typescript
   // Current stub at llm-executors.ts:84-93
   export const modelResolverExecutor: NodeExecutor = async (inputs, context) => {
     const role = inputs[0] || 'persona';

     // TODO: Implement this logic from handler:
     // - Call loadModelRegistry()
     // - Get role from context.role or default to 'persona'
     // - Resolve model using resolveModel(role)
     // - Handle cognitive mode routing if needed
     // - Return: { modelId, provider, model }
   };
   ```

3. Test the node in isolation:
   - Create a test graph with just model_resolver
   - Verify it returns correct model config
   - Verify it respects cognitive mode settings

### Phase 2: Delete Handler Code (AFTER PHASE 1)
Once model_resolver node is properly implemented:

1. **Delete semantic search block** (SAFE NOW):
   - File: `apps/site/src/pages/api/persona_chat.ts`
   - Lines: ~1564-1577 (approximate)
   - Search for: `if (!graphEnabled)` + `queryIndex`

2. **Delete model resolution block**:
   - File: `apps/site/src/pages/api/persona_chat.ts`
   - Lines: ~1435-1509
   - Search for: `if (!graphEnabled)` + `loadModelRegistry`
   - Also delete variable declarations at top if no longer used

3. **Force graph mode to be mandatory**:
   - Find: `const graphEnabled = ...`
   - Replace with: `const graphEnabled = true;`
   - Or delete variable and remove all `if (graphEnabled)` checks

4. **Clean up unused variables**:
   - Variables declared for legacy path but not used when graphEnabled
   - Import statements only needed for legacy code

### Phase 3: Verify Graph-Only Mode
1. Start dev server: `cd apps/site && pnpm dev`
2. Test chat with graph pipeline
3. Verify logs show:
   - `[CHAT_REQUEST] ✅ Graph enabled - model will be resolved by graph nodes`
   - NO model loading in handler (no Ollama VRAM swap)
   - NO semantic search in handler
4. Check that chat responses work correctly

## Files to Edit

### Primary File
- `apps/site/src/pages/api/persona_chat.ts`
  - Too large to read at once (26605 tokens)
  - Use grep to find specific sections:
    - Model resolution: grep for `loadModelRegistry`
    - Semantic search: grep for `queryIndex`
    - Graph check: grep for `if (!graphEnabled)`

### Node Executors to Update
- `packages/core/src/node-executors/llm-executors.ts`
  - Lines 84-93: Implement `modelResolverExecutor`
  - Reference the handler code for proper implementation

### Files to Check (Possibly Delete Later)
- `apps/site/src/middleware/userContext.ts` - Still used by 49 other endpoints
- `packages/core/src/context.ts` - Marked DEPRECATED, should be deleted eventually

## Handler Code Sections to Delete

### Section 1: Semantic Search (SAFE TO DELETE NOW)
**Location**: `apps/site/src/pages/api/persona_chat.ts` ~lines 1564-1577
**Search for**:
```typescript
if (!graphEnabled) {
  // Semantic search legacy path
  // ... queryIndex call ...
}
```

### Section 2: Model Resolution (DELETE AFTER NODE IMPLEMENTED)
**Location**: `apps/site/src/pages/api/persona_chat.ts` ~lines 1469-1509
**Search for**:
```typescript
if (!graphEnabled) {
  console.log(`[CHAT_REQUEST] ⚠️ Graph disabled - loading model in handler (LEGACY)`);
  try {
    const { loadModelRegistry } = await import('@metahuman/core');
    // ... model resolution logic ...
  }
}
```

### Section 3: Variable Declarations (DELETE IF UNUSED)
**Location**: `apps/site/src/pages/api/persona_chat.ts` ~lines 1435-1444
**Variables declared for legacy path**:
- `selectedModel`
- `selectedProvider`
- `llmTemperature`
- Others related to model config

**Check**: If these are ONLY used in legacy blocks, delete them too

## Important Notes

### Why Model Resolver Needs Implementation First
The handler code has full model resolution logic including:
- Loading model registry from `etc/models.json`
- Resolving role-based model selection
- Handling cognitive mode routing
- Fallback logic
- Error handling

The node executor currently just returns a stub. If we delete the handler code before implementing the node, **chat will break** because models won't be properly resolved.

### Why Semantic Search Can Be Deleted Now
The semantic search node is fully functional and already being used by the graph pipeline. The handler's semantic search block is redundant when graph is enabled.

### User's Key Demand
> "I DONT WANT THE OTHER CODE FUCKING UP THE SYSTEM IF IT IS NOT IN THE NODE SYSTEM I EITH WANT IT IMPLEMENTED IN THER OR IF IT IS DUPLICATE DELETE"

Translation:
- If functionality exists in nodes: DELETE handler code
- If functionality doesn't exist in nodes: IMPLEMENT in nodes FIRST, THEN delete handler

## Quick Reference Commands

### Reading Large Files
```bash
# File is too large (26605 tokens)
# Use grep instead:
grep -n "if (!graphEnabled)" apps/site/src/pages/api/persona_chat.ts
grep -n "loadModelRegistry" apps/site/src/pages/api/persona_chat.ts
grep -n "queryIndex" apps/site/src/pages/api/persona_chat.ts
```

### Testing
```bash
# Start dev server
cd apps/site && pnpm dev

# Watch logs for:
# - "Graph enabled - model will be resolved by graph nodes" (good)
# - "Graph disabled - loading model in handler" (bad - means legacy path)
```

### Checking Node Registry
```bash
# View all registered nodes
grep ":" packages/core/src/node-executors/registry.ts | grep -E "(semantic_search|model_resolver)"
```

## Tomorrow's Action Plan

1. **First**: Implement `modelResolverExecutor` in `llm-executors.ts`
   - Read handler code to understand full logic
   - Port to node executor
   - Test in isolation

2. **Second**: Delete semantic search block from handler (SAFE NOW)
   - Find with: `grep -n "if (!graphEnabled)" apps/site/src/pages/api/persona_chat.ts`
   - Delete the semantic search `if (!graphEnabled)` block

3. **Third**: Delete model resolution block from handler
   - Only after step 1 is complete and tested
   - Delete the model resolution `if (!graphEnabled)` block
   - Delete unused variable declarations

4. **Fourth**: Force graph mode
   - Change `graphEnabled` to always be true
   - Or remove the variable entirely

5. **Fifth**: Test end-to-end
   - Chat should work normally
   - No Ollama model swapping in handler
   - All logic happens in graph nodes

## Current Todo List
- [x] Remove middleware from persona_chat.ts
- [x] Verify semantic search node exists and works
- [x] Verify model resolver node exists
- [x] Identify that model resolver is a stub
- [x] Document current state
- [ ] **Implement model_resolver node executor** ← START HERE TOMORROW
- [ ] Delete semantic search from handler
- [ ] Delete model resolution from handler
- [ ] Force graph mode
- [ ] Test graph-only mode

---

**Status**: Ready to continue tomorrow. Start with implementing model_resolver node.
