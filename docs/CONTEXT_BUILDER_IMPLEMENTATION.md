# Context Builder - Initial Implementation

**Date:** 2025-11-04
**Version:** 1.0
**Status:** Increment 1 Complete
**Related:** [COGNITIVE_ARCHITECTURE_PRAGMATIC_ROADMAP.md](COGNITIVE_ARCHITECTURE_PRAGMATIC_ROADMAP.md)

---

## Overview

This document describes the initial implementation of the **Context Builder** - the foundation of the three-layer cognitive architecture's "subconscious layer."

**Philosophy:** Build incrementally with existing pre-trained models, add hooks for future LoRA integration.

---

## What We Built

### 1. Baseline Benchmark Script

**File:** `tests/benchmark-cognitive-baseline.sh`

**Purpose:** Measure current performance before any changes

**Tests:**
- Emulation mode response time (target: <8s)
- Agent mode chat (target: <8s)
- Agent mode with operator (target: <20s)
- Dual consciousness mode (target: <25s)
- Semantic search latency (target: <2s)
- Audit log analysis (timing breakdown)

**Usage:**
```bash
# Run benchmarks
./tests/benchmark-cognitive-baseline.sh

# Save baseline for comparison
./tests/benchmark-cognitive-baseline.sh > logs/benchmarks/baseline-$(date +%Y-%m-%d).txt
```

### 2. Context Builder Module

**File:** `packages/core/src/context-builder.ts`

**Purpose:** Extract memory retrieval and context preparation into reusable module

**Key Interface:**
```typescript
interface ContextPackage {
  // Memory grounding
  memories: RelevantMemory[];
  memoryCount: number;
  fallbackUsed: boolean;

  // Persona context
  persona: PersonaSummary;

  // Short-term state (orchestrator working memory)
  currentFocus?: string;
  activeTasks: string[];
  recentTopics: string[];

  // Patterns (future enhancement)
  patterns: DetectedPattern[];

  // Metadata
  mode: CognitiveModeId;
  retrievalTime: number;
  timestamp: string;
  indexStatus: 'available' | 'missing' | 'error';
}
```

**Main Function:**
```typescript
export async function buildContextPackage(
  userMessage: string,
  mode: CognitiveModeId,
  options?: ContextBuilderOptions
): Promise<ContextPackage>
```

**Helper Functions:**
- `formatContextForPrompt()` - Convert context package to prompt string
- `validateContextPackage()` - Check context quality and warnings

---

## How It Works

### Step 1: Memory Retrieval

```typescript
// Semantic search if index available
if (indexExists) {
  const hits = await queryIndex(userMessage, { topK: 8 });
  memories = hits.filter(hit => hit.score >= 0.62);
}
// Fallback: No memories, rely on persona summary
else {
  memories = [];
  fallbackUsed = true;
}
```

### Step 2: Persona Summary

```typescript
// Load persona core
const personaCore = loadPersonaCore();

// Load persona cache (frequent facts, themes, quirks)
const personaCache = getPersonaContext();

persona = {
  name: personaCore.identity.name,
  role: personaCore.identity.role,
  coreValues: personaCore.values,
  recentThemes: personaCache.recentThemes,
  frequentFacts: personaCache.frequentFacts
};
```

### Step 3: Short-Term State

```typescript
// Load orchestrator working memory
const state = loadShortTermState();

currentFocus = state.currentFocus;
activeTasks = state.activeTasks;
recentTopics = state.conversationContext.lastTopics;
```

### Step 4: Pattern Recognition (Future)

```typescript
// Placeholder for future enhancement
patterns = [];

// Future: Analyze memories for patterns
// - Recurring themes
// - Frequently mentioned people/projects
// - Behavioral patterns
```

### Step 5: Build & Audit

```typescript
const contextPackage: ContextPackage = {
  memories,
  persona,
  currentFocus,
  activeTasks,
  recentTopics,
  patterns,
  mode,
  retrievalTime,
  timestamp: new Date().toISOString(),
  indexStatus
};

// Audit logging
auditAction('context_package_built', {
  mode,
  memoriesFound: memories.length,
  retrievalTime,
  indexStatus,
  fallbackUsed
});

return contextPackage;
```

---

## Current Implementation Status

### ✅ Complete

- [x] Baseline benchmark script
- [x] Core `ContextPackage` interface
- [x] Memory retrieval (semantic search + fallback)
- [x] Persona summary integration
- [x] Short-term state integration
- [x] Audit logging
- [x] Helper functions for prompt formatting
- [x] Validation function for context quality
- [x] Exported from `@metahuman/core`

### 🔄 Using Pre-Trained Models

**Current Configuration** (from `etc/models.json`):

| Role | Model | Size | Purpose |
|------|-------|------|---------|
| Orchestrator | `phi3:mini` | 2.2GB | Fast routing decisions |
| Persona | `qwen3-coder:30b` | 18GB | Conversational responses |
| Curator | `qwen3:14b` | 9.3GB | Memory curation |
| Coder | `qwen3-coder:30b` | 18GB | Code generation |
| Planner | `qwen3-coder:30b` | 18GB | Task planning |
| Summarizer | `qwen3:14b` | 9.3GB | Summarization |

**LoRA Placeholders:**
- `persona.with-lora` - Configured but optional
- Future: Custom trained adapters can be added to `etc/models.json`
- Future: Per-user LoRA adapters when multi-user support added

---

## Integration Points

### Future: Personality Core (Layer 2)

The context builder prepares the `ContextPackage` which will be consumed by the personality core:

```typescript
// Future usage in personality-core.ts
import { buildContextPackage } from '@metahuman/core';

const context = await buildContextPackage(userMessage, mode);

// Pass context to persona model for response generation
const response = await callLLM({
  role: 'persona',
  messages: [
    { role: 'system', content: formatContextForPrompt(context) },
    { role: 'user', content: userMessage }
  ],
  cognitiveMode: mode
});
```

### Future: Meta-Cognition (Layer 3)

The context can inform validation:

```typescript
// Future usage in meta-cognition.ts
const validation = validateResponse(response, context);

// Check if response aligns with persona values
if (!alignsWithValues(response, context.persona.coreValues)) {
  validation.issues.push('Value misalignment');
}
```

---

## Mode-Specific Behavior

### Dual Consciousness Mode
```typescript
const context = await buildContextPackage(message, 'dual', {
  searchDepth: 'deep',           // 16 results
  forceSemanticSearch: true,     // Require semantic search
  includeShortTermState: true,   // Full state integration
  detectPatterns: true           // Future: pattern recognition
});
```

### Agent Mode
```typescript
const context = await buildContextPackage(message, 'agent', {
  searchDepth: 'normal',         // 8 results
  includeShortTermState: true,   // Active tasks only
  detectPatterns: false          // Skip expensive analysis
});
```

### Emulation Mode
```typescript
const context = await buildContextPackage(message, 'emulation', {
  searchDepth: 'shallow',        // 4 results
  includeShortTermState: false,  // No state updates (read-only)
  detectPatterns: false          // Skip analysis
});
```

---

## Audit Logging

Every context package generation creates an audit event:

```json
{
  "event": "context_package_built",
  "level": "info",
  "category": "action",
  "details": {
    "mode": "dual",
    "memoriesFound": 8,
    "retrievalTime": 1234,
    "indexStatus": "available",
    "fallbackUsed": false,
    "searchDepth": "normal",
    "activeTasks": 3,
    "patternsDetected": 0
  },
  "actor": "context_builder",
  "timestamp": "2025-11-04T12:00:00Z"
}
```

**Metrics to Track:**
- Retrieval time (target: <2s)
- Memory hit rate
- Fallback usage frequency
- Index availability

---

## Next Steps

### Immediate (This Week)

1. **Run Baseline Benchmarks:**
   ```bash
   # Ensure dev server is running
   cd apps/site && pnpm dev

   # Run benchmarks (in another terminal)
   ./tests/benchmark-cognitive-baseline.sh > logs/benchmarks/baseline-$(date +%Y-%m-%d).txt
   ```

2. **Refactor `persona_chat.ts`:**
   - Replace inline `getRelevantContext()` with `buildContextPackage()`
   - Test that behavior is identical (regression test)
   - Measure latency impact (should be minimal)

3. **Test Across Modes:**
   - Emulation mode: Read-only, shallow search
   - Agent mode: Normal search, active tasks
   - Dual mode: Deep search, full state

### Future Enhancements (Increment 2)

**Pattern Recognition:**
- Analyze memories for recurring themes
- Identify frequently mentioned entities
- Track behavioral patterns
- Add to `patterns` field in context package

**Smarter Fallbacks:**
- Load recent memories when index missing
- Include active tasks in fallback
- Pull from persona cache more aggressively

**Performance Optimization:**
- Cache context packages (5min TTL)
- Parallel memory search + state load
- Lazy-load persona cache

---

## Testing Strategy

### Regression Tests

Ensure new context builder produces same results as old code:

```typescript
// Test: Context builder matches old getRelevantContext()
const oldResult = await getRelevantContext(message);
const newResult = await buildContextPackage(message, 'dual');

expect(newResult.memories.length).toBe(oldResult.memories.length);
expect(newResult.persona.name).toBe(oldResult.persona.name);
```

### Performance Tests

```bash
# Before refactor
./tests/benchmark-cognitive-baseline.sh > baseline-before.txt

# After refactor
./tests/benchmark-cognitive-baseline.sh > baseline-after.txt

# Compare
diff baseline-before.txt baseline-after.txt
# Should show minimal differences (<50ms acceptable)
```

### Integration Tests

```typescript
// Test: All modes work with context builder
const modes = ['dual', 'agent', 'emulation'];

for (const mode of modes) {
  const context = await buildContextPackage('Hello', mode);
  expect(context.mode).toBe(mode);
  expect(context.retrievalTime).toBeLessThan(2000);
}
```

---

## Hooks for Future LoRA Integration

The context builder is designed to support future LoRA enhancements:

### 1. Persona LoRA Selection

```typescript
// Future: context builder could suggest which LoRA to use
interface ContextPackage {
  // ... existing fields ...
  suggestedLoRA?: string; // Path to optimal LoRA adapter
}

// Logic: Based on patterns, recent themes, user preferences
if (context.patterns.includes('technical-discussion')) {
  context.suggestedLoRA = 'persona/loras/technical.gguf';
} else if (context.patterns.includes('creative-writing')) {
  context.suggestedLoRA = 'persona/loras/creative.gguf';
}
```

### 2. Training Data Flagging

```typescript
// Future: flag valuable context for training
interface ContextPackage {
  // ... existing fields ...
  trainingCandidate?: boolean;
  trainingQuality?: number; // 0-1 score
}

// High-quality context for future LoRA training
if (context.memories.length >= 5 && !context.fallbackUsed) {
  context.trainingCandidate = true;
  context.trainingQuality = calculateQuality(context);
}
```

### 3. Multi-User LoRA Management

```typescript
// Future: per-user context packages
async function buildContextPackage(
  userMessage: string,
  mode: CognitiveModeId,
  options: ContextBuilderOptions & {
    userId?: string; // NEW: Multi-user support
  }
): Promise<ContextPackage>

// Load user-specific LoRA
if (options.userId) {
  const userLoRA = await getUserLoRA(options.userId);
  context.suggestedLoRA = userLoRA;
}
```

---

## Architecture Alignment

This implementation aligns with the pragmatic roadmap:

✅ **Avoid Duplication:** Refactored existing `getRelevantContext()` logic, not rebuilt from scratch

✅ **Incremental Validation:** Can measure before/after with benchmark script

✅ **Pre-Trained Models:** Uses existing ollama models, no custom training required yet

✅ **Future Hooks:** Ready for LoRA integration when trained adapters available

✅ **Mode-Specific:** Supports all three cognitive modes with appropriate behavior

---

## Success Criteria

### Must Have (Increment 1) ✅

- [x] Context builder generates `ContextPackage` for all modes
- [x] Refactored from existing code (no new behavior)
- [x] Audit logging for every context package
- [x] Helper functions for prompt formatting
- [x] Validation function for context quality
- [x] Benchmark script to measure performance

### Should Have (Next)

- [ ] Refactor `persona_chat.ts` to use context builder
- [ ] Zero latency regression (< 50ms acceptable)
- [ ] All three modes tested and working
- [ ] Baseline metrics captured for comparison

### Nice to Have (Future)

- [ ] Pattern recognition implemented
- [ ] Smarter fallbacks when index missing
- [ ] Context package caching
- [ ] Training candidate flagging

---

## Summary

We've completed **Increment 1** of the pragmatic roadmap:

**Built:**
- ✅ Baseline benchmark script for performance measurement
- ✅ Core context builder module with `ContextPackage` interface
- ✅ Integration with existing memory/persona/state systems
- ✅ Audit logging and validation helpers
- ✅ Hooks for future LoRA integration

**Using:**
- ✅ Pre-trained models from ollama
- ✅ Existing memory retrieval logic (refactored, not rebuilt)
- ✅ Existing state management system
- ✅ Existing security policy layer

**Ready For:**
- ⏳ Refactoring `persona_chat.ts` to use context builder
- ⏳ Performance comparison (baseline vs new)
- ⏳ Testing across all cognitive modes
- ⏳ Future LoRA adapter integration (when trained models available)

**Timeline:** 1 week (Increment 1) ✅ Complete

**Next:** Refactor `persona_chat.ts` and validate zero regression

---

**End of Implementation Document**
