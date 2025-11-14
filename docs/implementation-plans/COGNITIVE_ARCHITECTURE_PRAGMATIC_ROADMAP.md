# Cognitive Architecture: Pragmatic Implementation Roadmap

**Date:** 2025-11-04
**Version:** 1.0
**Status:** Implementation Guide
**Philosophy:** Incremental validation with baseline metrics before committing to full stack

---

## Overview

This document provides a **pragmatic, measurement-driven approach** to implementing the three-layer cognitive architecture. Instead of building all layers upfront, we validate each increment against baseline metrics and real-world usage.

**Key Principle:** Measure first, build incrementally, avoid duplication, prove value at each step.

---

## Baseline Metrics (Measure Before Building)

### Current Performance Benchmarks

Before implementing any new layers, capture baseline metrics:

```bash
# Test script: tests/benchmark-cognitive-baseline.sh
#!/bin/bash

echo "=== Cognitive Architecture Baseline Metrics ==="
echo "Date: $(date)"
echo ""

# Test 1: Emulation mode (simplest)
echo "Test 1: Emulation mode response time"
time curl -s "http://localhost:4321/api/persona_chat?message=Hello&mode=conversation" > /dev/null
echo ""

# Test 2: Agent mode (heuristic routing)
echo "Test 2: Agent mode response time"
time curl -s "http://localhost:4321/api/persona_chat?message=Create+a+task+to+review+code&mode=conversation" > /dev/null
echo ""

# Test 3: Dual mode (operator pipeline)
echo "Test 3: Dual mode with operator"
time curl -s "http://localhost:4321/api/persona_chat?message=Analyze+the+codebase&mode=conversation&forceOperator=true" > /dev/null
echo ""

# Memory retrieval benchmark
echo "Test 4: Semantic search latency"
time ./bin/mh remember "coffee with Sarah" > /dev/null
echo ""

# Audit logs: Extract actual timing from recent conversations
echo "Test 5: Recent conversation timings from audit logs"
cat logs/audit/$(date +%Y-%m-%d).ndjson | jq 'select(.event=="chat_assistant") | {latency: .details.latencyMs, mode: .details.cognitiveMode, operator: .details.usedOperator}'
```

**Capture These Metrics:**
- [ ] Emulation mode: End-to-end latency (target baseline: 5-8s)
- [ ] Agent mode (chat): Latency without operator (target: 5-8s)
- [ ] Agent mode (operator): Latency with operator (target: 15-20s)
- [ ] Dual mode: Full operator pipeline (target: 15-25s)
- [ ] Semantic search: Query time for 8 results (target: 1-2s)
- [ ] Context retrieval: Total time in `getRelevantContext()` (target: 2-3s)

**Save Results:**
```bash
./tests/benchmark-cognitive-baseline.sh > logs/benchmarks/baseline-$(date +%Y-%m-%d).txt
```

---

## Phase 0: Identify Duplication & Reuse Opportunities

### Existing Systems to Leverage (Not Rebuild)

#### 1. Memory Retrieval (Already Exists)
**Current:** `persona_chat.ts` lines 224-280 (`getRelevantContext()`)
- Semantic search via `queryIndex()`
- Fallback to persona summary when index missing
- Recent reflections loading

**Don't Build:** Separate subconscious retrieval system
**Instead:** Extract current logic into helper function, enhance incrementally

#### 2. Security Policy (Already Exists)
**Current:** `packages/core/src/security-policy.ts` + unified policy layer
- Mode-specific permissions (`canWriteMemory`, `canUseOperator`)
- Role-based access control (owner/guest/anonymous)
- Read-only enforcement in emulation mode

**Don't Build:** New validation system from scratch
**Instead:** Extend security policy with additional checks (value alignment, consistency)

#### 3. Operator Critique (Already Exists)
**Current:** Operator pipeline has narrator that summarizes results
- Already does basic quality checks
- Provides feedback on task execution

**Don't Build:** Separate meta-cognition critique
**Instead:** Extract and enhance narrator feedback into reusable validator

#### 4. Short-Term State (Already Exists)
**Current:** `packages/core/src/state.ts`
- Short-term working memory
- Persona cache with themes/facts/quirks
- Digest agent for theme extraction

**Don't Build:** New state management
**Instead:** Integrate existing state into context package

#### 5. Model Router (Already Exists)
**Current:** `packages/core/src/model-router.ts` + registry
- Role-based model selection
- LoRA adapter support
- Cognitive mode awareness

**Don't Build:** New orchestration layer
**Instead:** Add layer-specific routing hints to existing router

---

## Incremental Implementation Plan

### Increment 1: Context Package Helper (Week 1)

**Goal:** Extract existing `getRelevantContext()` into reusable helper with clear interface

**Why First:**
- Lowest risk (pure refactor, no new behavior)
- Proves we can measure relevance improvements
- Foundation for future enhancements

**Tasks:**
1. Create `packages/core/src/context-builder.ts`:
   ```typescript
   export interface ContextPackage {
     memories: RelevantMemory[];
     persona: PersonaSummary;
     state: ShortTermState;
     themes: Theme[];
     mode: CognitiveModeId;
     retrievalTime: number;
   }

   export async function buildContextPackage(
     userMessage: string,
     mode: CognitiveModeId,
     options?: { searchDepth?: number; includeState?: boolean }
   ): Promise<ContextPackage>
   ```

2. Refactor `persona_chat.ts` to use helper:
   ```typescript
   // Before: Inline memory retrieval (lines 224-280)
   const hits = await queryIndex(userMessage, { topK: 8 });
   // ... 50+ lines of processing ...

   // After: Use helper
   const context = await buildContextPackage(userMessage, cognitiveMode);
   ```

3. Add telemetry to helper:
   ```typescript
   auditAction('context_package_built', {
     memoriesFound: context.memories.length,
     retrievalTime: context.retrievalTime,
     mode: context.mode,
     fallbackUsed: !indexExists
   });
   ```

4. **Validation Criteria:**
   - [ ] Same results as before (regression test)
   - [ ] Retrieval time measured and logged
   - [ ] All three modes work identically
   - [ ] Zero latency increase (< 50ms overhead acceptable)

**Success Metric:** Can answer "how long does context retrieval take?" with data

---

### Increment 2: Enhanced Context Relevance (Week 2-3)

**Goal:** Improve context package with pattern recognition and smarter fallbacks

**Why Second:**
- Now we have baseline metrics to compare against
- Builds on proven context package interface
- Can A/B test enhanced vs baseline

**Tasks:**
1. Add pattern recognition to context builder:
   ```typescript
   interface ContextPackage {
     // ... existing fields ...
     patterns: DetectedPattern[];  // NEW: Recurring themes from digest agent
     suggestedFocus: string;       // NEW: What user likely cares about
   }
   ```

2. Integrate persona cache (already exists in `state.ts`):
   ```typescript
   const personaContext = getPersonaContext(); // Already implemented
   const patterns = identifyPatterns(context.memories, personaContext.recentThemes);
   ```

3. Add smart fallback when semantic index missing:
   ```typescript
   if (!indexExists) {
     // Current: Just return persona summary
     // Enhanced: Also check recent memories, active tasks
     const recentMemories = await loadRecentMemories(14); // Last 2 weeks
     const activeTasks = await listActiveTasks();
     return { memories: recentMemories, tasks: activeTasks, ... };
   }
   ```

4. **A/B Testing:**
   - Run 20 test conversations with baseline context builder
   - Run same 20 with enhanced context builder
   - Compare: relevance (subjective), latency (objective)

5. **Validation Criteria:**
   - [ ] Pattern detection adds < 500ms latency
   - [ ] Fallback provides better context than current (user validation)
   - [ ] Dual mode still hits < 20s target
   - [ ] Emulation mode stays under 8s

**Success Metric:** User reports "system understands me better" + latency within budget

---

### Increment 3: LoRA Swap Optimization (Week 4)

**Goal:** Reduce LoRA adapter switching overhead (currently ~1000ms)

**Why Third:**
- Emulation mode depends on frozen LoRA performance
- Must prove LoRA swapping is viable before building personality layer
- Can measure GPU memory impact

**Tasks:**
1. Benchmark current LoRA swap time:
   ```bash
   # Measure ollama model switch time
   time ollama run qwen3-coder:30b "test" > /dev/null
   time ollama run greg-local-2025-11-02 "test" > /dev/null
   # Difference = swap overhead
   ```

2. Test LoRA pre-merging for emulation mode:
   ```bash
   # Create pre-merged model for emulation (one-time cost)
   # Should eliminate swap latency at runtime
   ```

3. Implement model keep-alive strategy:
   ```typescript
   // In model-router.ts
   const KEEP_ALIVE = {
     orchestrator: 'always',      // 2.2GB, always loaded
     persona: '30m',              // Unload after 30min idle
     'persona.with-lora': 'never' // Only for emulation, load on demand
   };
   ```

4. Measure GPU memory usage:
   ```bash
   # Monitor nvidia-smi during conversations
   watch -n 1 'nvidia-smi --query-gpu=memory.used --format=csv,noheader'
   ```

5. **Validation Criteria:**
   - [ ] LoRA swap < 1s (pre-merge or keep-alive)
   - [ ] GPU memory stays under 40GB for dual mode
   - [ ] Emulation mode can use pre-merged LoRA
   - [ ] No impact on conversation quality

**Success Metric:** LoRA swap fast enough to be invisible to user experience

---

### Increment 4: Lightweight Validation (Week 5-6)

**Goal:** Add basic safety/consistency checks without full meta-cognition layer

**Why Fourth:**
- Only add validation if LoRA swaps are proven fast enough
- Start with lightweight checks (fast, high-value)
- Can defer expensive validation to background if needed

**Tasks:**
1. Extract existing operator narrator critique:
   ```typescript
   // brain/agents/operator.ts already has critique logic
   // Refactor into reusable function
   export function critiqueResponse(
     response: string,
     context: ContextPackage
   ): { safe: boolean; issues: string[] }
   ```

2. Add consistency check to security policy:
   ```typescript
   // In packages/core/src/security-policy.ts
   interface SecurityPolicy {
     // ... existing fields ...
     validateResponse(response: string): ValidationResult;
   }
   ```

3. Implement fast validation checks:
   ```typescript
   function validateResponse(response: string, mode: CognitiveModeId): ValidationResult {
     const issues: string[] = [];

     // Check 1: PII leak detection (fast regex)
     if (/\b\d{3}-\d{2}-\d{4}\b/.test(response)) {
       issues.push('Potential SSN detected');
     }

     // Check 2: Boundary enforcement (check against decision rules)
     const boundaries = loadDecisionRules().boundaries;
     // ... check response respects boundaries ...

     // Check 3: Voice consistency (compare to catchphrases)
     const personaCache = loadPersonaCache();
     // ... basic similarity check ...

     return { safe: issues.length === 0, issues };
   }
   ```

4. Add validation telemetry:
   ```typescript
   auditAction('response_validated', {
     mode,
     issues: validation.issues,
     validationTime: elapsed,
     blocked: !validation.safe
   });
   ```

5. **Validation Criteria:**
   - [ ] Validation adds < 200ms (fast checks only)
   - [ ] Catches obvious issues (PII, boundaries)
   - [ ] False positive rate < 5% (user testing)
   - [ ] Can be disabled in agent mode (selective)

**Success Metric:** Catches safety issues without noticeable latency impact

---

### Increment 5: Background Meta-Cognition (Week 7-8)

**Goal:** Deep validation runs asynchronously, doesn't block response

**Why Fifth:**
- Only if lightweight validation proves useful
- Expensive LLM-based validation can't meet 20s target
- Background validation can inform next response or training

**Tasks:**
1. Create async validation queue:
   ```typescript
   // In packages/core/src/meta-cognition.ts
   export async function queueDeepValidation(
     response: string,
     context: ContextPackage,
     conversationId: string
   ): Promise<void> {
     // Non-blocking: enqueue validation task
     validationQueue.push({ response, context, conversationId });
   }
   ```

2. Implement validation worker:
   ```typescript
   // brain/agents/validator.ts
   async function processValidationQueue() {
     while (true) {
       const task = await validationQueue.pop();

       // Deep validation using curator model
       const validation = await callLLM({
         role: 'curator',
         messages: buildValidationPrompt(task),
         cognitiveMode: 'dual'
       });

       // Save results for next conversation turn
       await saveValidationResult(task.conversationId, validation);
     }
   }
   ```

3. Use validation results in next response:
   ```typescript
   // In persona_chat.ts
   const previousValidation = await loadValidationResult(conversationId);
   if (previousValidation?.issues.length > 0) {
     // Adjust system prompt to correct previous issues
     systemPrompt += `\nPrevious response had these issues: ${previousValidation.issues.join(', ')}. Please avoid repeating them.`;
   }
   ```

4. **Validation Criteria:**
   - [ ] Validation doesn't block response delivery
   - [ ] Results available for next turn (< 30s processing)
   - [ ] Corrections applied in follow-up messages
   - [ ] Can be disabled per-mode (emulation skips)

**Success Metric:** Quality improves over multi-turn conversations without latency penalty

---

## Guardrails & Constraints

### GPU Memory Management

**Guardrail 1: Single LoRA Loaded at a Time**
```typescript
// In model-router.ts
let currentLoRA: string | null = null;

async function switchToLoRA(adapterPath: string) {
  if (currentLoRA && currentLoRA !== adapterPath) {
    await unloadLoRA(currentLoRA);  // Free GPU memory
  }
  await loadLoRA(adapterPath);
  currentLoRA = adapterPath;
}
```

**Guardrail 2: Model Offloading**
```typescript
const GPU_MEMORY_LIMIT = 40 * 1024 * 1024 * 1024; // 40GB

async function ensureMemoryAvailable(modelSize: number) {
  const used = await getGPUMemoryUsed();
  if (used + modelSize > GPU_MEMORY_LIMIT) {
    // Offload least-recently-used specialist
    await offloadOldestModel();
  }
}
```

**Guardrail 3: Specialist Lazy Loading**
```typescript
// Don't load specialists until needed
const specialists = {
  coder: { loaded: false, lastUsed: null },
  planner: { loaded: false, lastUsed: null },
  summarizer: { loaded: false, lastUsed: null }
};

// Only load when actually called
async function routeToSpecialist(type: SpecialistType) {
  if (!specialists[type].loaded) {
    await loadSpecialist(type);
  }
  specialists[type].lastUsed = Date.now();
}
```

### Validation Risk-Based Gating

**Guardrail 4: Validation Only for Risky Responses**
```typescript
function needsDeepValidation(response: string, context: ContextPackage): boolean {
  // Calculate risk score
  const riskFactors = [
    response.length > 1000,              // Long responses (more chance of issues)
    context.mode === 'dual',             // Dual mode always validates
    /password|secret|key/.test(response), // Security-sensitive content
    context.operatorUsed                 // Operator actions need validation
  ];

  const riskScore = riskFactors.filter(Boolean).length;
  return riskScore >= 2; // Only validate if 2+ risk factors
}
```

### Multi-User LoRA Management

**Guardrail 5: LoRA Per-User Limits**
```typescript
const MAX_CONCURRENT_LORAS = 2; // Only 2 user LoRAs loaded at once
const loraCache = new Map<string, { adapter: string; lastUsed: number }>();

async function getUserLoRA(userId: string): Promise<string> {
  if (loraCache.size >= MAX_CONCURRENT_LORAS) {
    // Evict least-recently-used
    const lru = [...loraCache.entries()]
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    await unloadLoRA(lru[1].adapter);
    loraCache.delete(lru[0]);
  }

  // Load and cache
  const adapter = await loadLoRA(`persona/loras/${userId}.gguf`);
  loraCache.set(userId, { adapter, lastUsed: Date.now() });
  return adapter;
}
```

### Feedback Loop Prevention

**Guardrail 6: Validation Correction Limits**
```typescript
interface ValidationFeedbackHistory {
  conversationId: string;
  corrections: number;
  lastCorrectionTime: number;
}

const MAX_CORRECTIONS_PER_CONVERSATION = 3;

function shouldApplyValidationCorrection(
  conversationId: string,
  history: ValidationFeedbackHistory[]
): boolean {
  const convoHistory = history.find(h => h.conversationId === conversationId);

  if (!convoHistory) return true; // First correction

  if (convoHistory.corrections >= MAX_CORRECTIONS_PER_CONVERSATION) {
    // Too many corrections, might be feedback loop
    console.warn('Validation feedback loop detected, disabling corrections');
    return false;
  }

  return true;
}
```

---

## Measurement Dashboard

### Metrics to Track Per Increment

**Context Package (Increment 1):**
- Retrieval time (p50, p95, p99)
- Memory hits per query
- Fallback usage rate
- Mode-specific timing breakdown

**Enhanced Context (Increment 2):**
- Pattern detection time
- Relevance score (user feedback: 1-5 stars)
- Fallback quality improvement
- Total context package size (tokens)

**LoRA Optimization (Increment 3):**
- LoRA swap time (pre-merge vs keep-alive)
- GPU memory usage (idle, active, peak)
- Model keep-alive hit rate
- Emulation mode response time

**Lightweight Validation (Increment 4):**
- Validation time per response
- Issues detected (count, types)
- False positive rate (user-reported)
- Blocked responses (count, reasons)

**Background Validation (Increment 5):**
- Queue depth (pending validations)
- Validation processing time
- Corrections applied rate
- Multi-turn quality improvement

### Visualization

```bash
# Generate metrics dashboard
./bin/mh metrics dashboard --period 7d

# Output:
# === Cognitive Architecture Metrics (Last 7 Days) ===
#
# Context Retrieval:
#   P50: 1.2s  P95: 2.8s  P99: 4.1s  ✅ Within target
#   Fallback rate: 5% (semantic index available 95% of time)
#
# LoRA Performance:
#   Swap time: 850ms  ✅ Within target
#   GPU memory: 28GB peak  ✅ Within 40GB limit
#
# Validation:
#   Lightweight: 180ms avg  ✅ Fast
#   Background queue: 2 avg depth  ✅ Healthy
#   Issues detected: 12 total (3 PII, 5 boundary, 4 consistency)
```

---

## Decision Points

### After Increment 1: Continue or Pivot?

**Measure:**
- Is retrieval time now visible and measurable? ✅ / ❌
- Does context package interface work across all modes? ✅ / ❌
- Any unexpected latency regressions? ✅ / ❌

**Decision:**
- ✅ All green → Proceed to Increment 2
- ❌ Any red → Debug before continuing

### After Increment 2: Is Enhanced Context Worth It?

**Measure:**
- User-reported relevance improvement: ___ (1-5 stars)
- Latency increase: ___ ms (acceptable if < 500ms)
- Pattern detection accuracy: ___ % (useful if > 70%)

**Decision:**
- Improvement < 0.5 stars + latency > 500ms → **Revert**, stick with baseline
- Improvement ≥ 0.5 stars + latency ≤ 500ms → **Keep**, proceed to Increment 3

### After Increment 3: Can We Support LoRA Swapping?

**Measure:**
- LoRA swap time: ___ ms (target < 1000ms)
- GPU memory pressure: ___ GB (target < 40GB)
- Emulation mode performance: ___ s (target < 8s)

**Decision:**
- Swap > 1s OR memory > 40GB → **Use pre-merged models only**, no runtime swapping
- Swap ≤ 1s AND memory ≤ 40GB → **Proceed with LoRA architecture**, continue to Increment 4

### After Increment 4: Is Validation Worth the Cost?

**Measure:**
- Issues caught: ___ (useful if > 10/week)
- False positive rate: ___ % (acceptable if < 5%)
- Latency impact: ___ ms (acceptable if < 200ms)

**Decision:**
- Low value (< 5 issues/week) → **Disable validation**, too much overhead for benefit
- High value (≥ 10 issues/week, < 5% FP) → **Keep lightweight**, consider Increment 5

### After Increment 5: Is Background Validation Worth It?

**Measure:**
- Quality improvement in follow-ups: ___ (subjective, user feedback)
- Queue depth stability: ___ avg (healthy if < 10)
- Training data quality: ___ (curator feedback)

**Decision:**
- No measurable improvement → **Disable background validation**, not worth complexity
- Clear improvement → **Keep and expand**, add more validation types

---

## What NOT to Build

### ❌ Don't Build: Separate Subconscious Retrieval System
**Why:** `getRelevantContext()` already does this
**Instead:** Extract into `buildContextPackage()`, enhance incrementally

### ❌ Don't Build: New Validation Framework from Scratch
**Why:** Security policy + operator critique already provide validation
**Instead:** Extend existing systems with lightweight checks

### ❌ Don't Build: Custom Model Orchestrator
**Why:** Model router + registry already handle multi-model coordination
**Instead:** Add layer hints to existing router

### ❌ Don't Build: Separate State Management
**Why:** `packages/core/src/state.ts` already manages short-term + persona cache
**Instead:** Integrate existing state into context package

### ❌ Don't Build: Complex Feedback Loop
**Why:** Risk of overfitting, hard to measure improvement
**Instead:** Simple correction hints, max 3 per conversation

---

## Risk Mitigation

### High Risk: GPU Memory Exhaustion

**Mitigation:**
1. Monitor GPU memory in production (`nvidia-smi` telemetry)
2. Implement automatic model offloading (guardrail #2)
3. Test with all specialists loaded simultaneously
4. Have fallback to CPU offloading if GPU exhausted

**Rollback Plan:** Use base models only, no LoRA, no specialists

### Medium Risk: Latency Budget Exceeded

**Mitigation:**
1. Measure latency at every increment
2. Stop if any increment exceeds 20s total for dual mode
3. Move expensive operations to background (validation, digest)
4. Cache aggressively (context packages, validation results)

**Rollback Plan:** Revert to baseline context builder, disable validation

### Medium Risk: False Positive Validation Blocks

**Mitigation:**
1. Start with low-confidence blocking (log only, don't block)
2. Gradually increase blocking threshold based on false positive rate
3. User override: Allow "send anyway" button in UI
4. Audit all blocked messages for review

**Rollback Plan:** Disable validation blocking, keep logging only

### Low Risk: LoRA Swap Degrades Experience

**Mitigation:**
1. Test pre-merged models for emulation mode
2. Keep-alive strategy keeps frequently-used LoRAs loaded
3. Measure swap time before committing to LoRA architecture

**Rollback Plan:** Use single model per mode, no dynamic LoRA swapping

---

## Success Criteria (Overall)

### Must Have
- [ ] All increments pass validation criteria
- [ ] Total latency within targets (8s emulation, 20s dual)
- [ ] GPU memory under 40GB for dual mode
- [ ] No regressions in conversation quality
- [ ] User reports "system understands me better" (qualitative)

### Should Have
- [ ] LoRA swap working for multi-user support
- [ ] Lightweight validation catches safety issues
- [ ] Background validation improves follow-up quality
- [ ] Metrics dashboard shows improvement over time

### Nice to Have
- [ ] Full meta-cognition layer (only if background validation proves valuable)
- [ ] Multi-user LoRA management (only if single-user LoRA works well)
- [ ] Advanced pattern recognition (only if basic patterns show value)

---

## Timeline Summary

| Week | Increment | Decision Point |
|------|-----------|----------------|
| 1 | Context Package Helper | Measure baseline, create interface |
| 2-3 | Enhanced Context Relevance | User relevance test: continue or revert? |
| 4 | LoRA Swap Optimization | GPU/latency test: dynamic LoRA or pre-merge? |
| 5-6 | Lightweight Validation | Value test: keep or disable? |
| 7-8 | Background Validation | Quality test: expand or stop? |

**Total Time:** 6-8 weeks (half the original 12-week estimate)

**Why Faster:**
- No full meta-cognition layer upfront
- Reuse existing systems (no duplication)
- Stop early if increments don't prove value
- Parallel work possible (GPU tests while doing context enhancements)

---

## Next Immediate Steps

1. **Run Baseline Benchmarks (Day 1):**
   ```bash
   ./tests/benchmark-cognitive-baseline.sh > logs/benchmarks/baseline-$(date +%Y-%m-%d).txt
   ```

2. **Review Duplication Analysis (Day 1):**
   - Read through existing `getRelevantContext()` code
   - Read through `packages/core/src/state.ts`
   - Identify exact lines to refactor vs rebuild

3. **Start Increment 1 (Day 2-5):**
   - Create `packages/core/src/context-builder.ts`
   - Extract `getRelevantContext()` logic
   - Add telemetry
   - Regression test

4. **First Decision Point (End of Week 1):**
   - Review metrics: is retrieval now measurable?
   - Proceed to Increment 2 or debug issues

---

**End of Pragmatic Roadmap**

This approach ensures we build only what proves valuable, avoid duplication, and maintain production quality throughout.
