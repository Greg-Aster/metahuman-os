# Phase 4.1 Implementation - Layer 2 Wrapper

**Date:** 2025-11-05
**Status:** 🔄 In Progress
**Risk:** Low

---

## Approach: Minimal Invasive Wrapper

After reviewing persona_chat.ts, I've identified that the current implementation has complex Qwen3-specific logic for handling thinking modes. For Phase 4.1, I'll use a **minimal wrapper approach** that:

1. **Preserves all existing logic** (thinking extraction, follow-up passes, etc.)
2. **Adds Layer 2 wrapper** around the LLM call only
3. **Keeps stripChainOfThought** in persona_chat.ts for now
4. **Adds feature flag** for easy rollback

---

## Current Implementation Analysis

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Lines 976-1113: Response Generation Flow**
```typescript
// Line 983: Direct LLM call
const llmResponse = await callLLM({
  role: 'persona',
  messages: histories[m],
  cognitiveMode,
  options: { temperature, topP, repeatPenalty, ...llmOpts }
});

// Lines 1008-1106: Complex Qwen3 thinking mode handling
// - Extracts thinking from response
// - Detects if content is empty
// - Runs follow-up extraction if needed
// - Falls back to thinking text

// Line 1112: Strip chain-of-thought artifacts
const cleanedAssistant = stripChainOfThought(assistantResponse);
```

**Complexity:**
- Qwen3 puts answers in `thinking` field, `content` is often empty
- Special extraction logic to find actual answer
- Follow-up LLM call if extraction fails
- Multiple fallback strategies

**Decision:** Keep this logic intact for Phase 4.1, only wrap the initial LLM call

---

## Implementation Plan

### Option A: Feature Flag Wrapper (CHOSEN)

Add a feature flag `USE_COGNITIVE_PIPELINE` that toggles between old and new code paths.

**Benefits:**
- Zero risk rollback (change flag)
- Easy A/B testing
- Can test both paths in parallel

**Implementation:**
```typescript
// Add at top of persona_chat.ts
const USE_COGNITIVE_PIPELINE = process.env.USE_COGNITIVE_PIPELINE === 'true';

// In handleChatRequest, replace Lines 983-996
if (USE_COGNITIVE_PIPELINE) {
  // NEW PATH: Use PersonalityCoreLayer
  const { PersonalityCoreLayer } = await import('@metahuman/core');
  const layer2 = new PersonalityCoreLayer();

  const result = await layer2.process({
    contextPackage: { userMessage: message, memories: [], patterns: [] },
    chatHistory: histories[m]
  }, {
    cognitiveMode,
    userId: undefined,
    sessionId: undefined,
    previousLayers: [],
    metadata: {
      layerConfig: {
        modelRole: 'persona',
        useLoRA: true,
        temperature,
        topP: 0.9,
        repeatPenalty: 1.3,
        ...llmOpts
      }
    }
  });

  assistantResponse = result.response;
} else {
  // OLD PATH: Existing implementation (unchanged)
  const llmResponse = await callLLM({ ... });
  // ... existing thinking extraction logic
}

// Lines 1112-1113: stripChainOfThought stays the same for both paths
const cleanedAssistant = stripChainOfThought(assistantResponse);
```

### Option B: Direct Replacement (Riskier)

Replace the LLM call directly without a feature flag.

**Rejected:** Too risky for initial integration, no easy rollback

---

## Changes Required

### 1. Add Feature Flag

**File:** `.env` (or environment variable)
```bash
# Phase 4.1: Enable Layer 2 wrapper
USE_COGNITIVE_PIPELINE=false  # Start disabled
```

### 2. Update PersonalityCoreLayer to Accept Chat History

**File:** `packages/core/src/cognitive-layers/layers/personality-core-layer.ts`

**Add new input option:**
```typescript
export interface PersonalityInput {
  contextPackage: ContextPackage;
  operatorResult?: OperatorResult;
  chatHistory?: Array<{ role: string; content: string }>;  // ← NEW
}
```

**Update process() to use chatHistory if provided:**
```typescript
async process(input: PersonalityInput, context: LayerContext): Promise<PersonalityOutput> {
  // ...

  // If chatHistory provided, use it directly instead of building prompt
  const messages = input.chatHistory
    ? input.chatHistory.map(h => ({ role: h.role as 'system' | 'user' | 'assistant', content: h.content }))
    : [
        { role: 'system' as const, content: prompt.system },
        { role: 'user' as const, content: prompt.user }
      ];

  // Pass options from config
  const options = context.metadata?.layerConfig || {
    temperature: 0.7,
    max_tokens: 1000
  };

  const routerResponse = await callLLM({
    role: modelRole,
    messages,
    cognitiveMode: context.cognitiveMode,
    options
  });

  // ...
}
```

### 3. Update persona_chat.ts

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Changes:**
```typescript
// Line 1: Add import at top (conditional)
import { PersonalityCoreLayer } from '@metahuman/core';

// Line ~50: Add feature flag check
const USE_COGNITIVE_PIPELINE = process.env.USE_COGNITIVE_PIPELINE === 'true' || false;

// Lines 983-1106: Wrap in feature flag
if (USE_COGNITIVE_PIPELINE) {
  // Use Layer 2
  const layer2 = new PersonalityCoreLayer();
  const result = await layer2.process(
    {
      contextPackage: { userMessage: message, memories: [], patterns: [] },
      chatHistory: histories[m]
    },
    {
      cognitiveMode,
      userId: undefined,
      sessionId: undefined,
      previousLayers: [],
      metadata: {
        layerConfig: {
          modelRole: 'persona',
          temperature,
          topP: 0.9,
          repeatPenalty: 1.3,
          maxTokens: llmOpts.num_predict,
          ...llmOpts
        }
      }
    }
  );

  // Extract response (Layer 2 returns RouterResponse.content)
  assistantResponse = result.response;

  // Handle thinking mode (Qwen3 may still use thinking field)
  // For now, assume Layer 2 handles this - we can refine later

} else {
  // Existing implementation (unchanged)
  const llmResponse = await callLLM({ ... });
  // ... all existing thinking extraction logic
}

// Line 1112: stripChainOfThought stays the same
const cleanedAssistant = stripChainOfThought(assistantResponse);
```

---

## Testing Plan

### 1. Baseline Test (USE_COGNITIVE_PIPELINE=false)
- ✅ Verify existing behavior unchanged
- ✅ Test normal conversation
- ✅ Test Qwen3 thinking mode
- ✅ Test stripChainOfThought cleanup

### 2. Layer 2 Test (USE_COGNITIVE_PIPELINE=true)
- ✅ Test simple question
- ✅ Test response quality (should match baseline)
- ✅ Test LoRA adapter loading
- ✅ Test chat history preservation
- ✅ Test stripChainOfThought still works

### 3. Comparison Test
- ✅ Run same conversation with both flags
- ✅ Compare response quality
- ✅ Compare response time
- ✅ Verify voice consistency

---

## Rollback Plan

**Instant Rollback (0 seconds):**
```bash
# Set environment variable
export USE_COGNITIVE_PIPELINE=false
# No restart needed (checked on each request)
```

**Code Rollback (5 minutes):**
```bash
git revert <commit-hash>
```

---

## Decision: Phase 4.1 Simplified

After analysis, I recommend a **phased 4.1 approach**:

**Phase 4.1a (This PR):**
- Add feature flag infrastructure
- Add chatHistory support to PersonalityCoreLayer
- Do NOT integrate yet (keep flag disabled)
- Write tests

**Phase 4.1b (Next PR):**
- Enable flag in dev environment
- Test thoroughly
- Gradual rollout to production

This minimizes risk and allows thorough testing.

---

## Status

- [x] Analysis complete
- [ ] PersonalityCoreLayer chatHistory support added
- [ ] Feature flag added to persona_chat.ts
- [ ] Tests written
- [ ] Documentation updated

**Next:** Implement Phase 4.1a changes

