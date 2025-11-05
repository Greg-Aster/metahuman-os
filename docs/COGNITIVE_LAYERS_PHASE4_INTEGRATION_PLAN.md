# Cognitive Layers Phase 4 - Integration Plan

**Date:** 2025-11-05
**Phase:** 4 (Production Integration)
**Status:** 📋 Planning Complete
**Risk Level:** Low-Medium (with phased rollout)

---

## Executive Summary

Phase 4 integrates the fully-built 3-layer cognitive architecture into the production chat endpoint (`persona_chat.ts`). The audit reveals that **Layer 1 is already integrated**, Layer 2 needs wrapping, and Layer 3 needs activation. This document outlines a safe, phased integration strategy.

---

## Audit Findings

### Current State

**✅ Layer 1 (Subconscious) - ALREADY INTEGRATED**
- `persona_chat.ts` line 156 calls `buildContextPackage()` directly
- This IS the Layer 1 functionality, just not wrapped in the layer class
- **Action:** Minimal changes needed

**⚠️ Layer 2 (Personality Core) - IMPLEMENTED INLINE**
- Response generation is done directly via `callLLM()` (lines 976-1113)
- Chain-of-thought stripping is custom logic (lines 102-138)
- **Action:** Wrap existing logic in PersonalityCoreLayer

**❌ Layer 3 (Meta-Cognition) - NOT INTEGRATED**
- All validation/refinement infrastructure exists but unused
- Safety, alignment, consistency validators ready
- **Action:** Activate in production with feature flags

### Integration Points Identified

**File:** `apps/site/src/pages/api/persona_chat.ts` (1197 lines)

**Key Sections:**
- **Lines 142-200:** `getRelevantContext()` - calls buildContextPackage()
- **Lines 268-399:** `shouldUseOperator()` - routing decision
- **Lines 976-1113:** Main response generation - **PRIMARY INTEGRATION POINT**
- **Lines 102-138:** `stripChainOfThought()` - move to Layer 2

**Dependencies:**
- Chat UI expects SSE stream with `answer`, `reasoning`, `error` events
- Memory capture via `captureEvent()` when mode allows
- Audit logging to `logs/audit/`
- Operator synthesis for operator results

**No Overlapping Functionality Found:**
- No existing safety validators (Layer 3 is new)
- No existing value alignment checks (Layer 3 is new)
- No existing consistency validation (Layer 3 is new)
- stripChainOfThought() is simple post-processing (will merge into Layer 2)

---

## Integration Strategy: 4-Phase Rollout

### Phase 4.1: Layer 2 Wrapper (Week 1, Days 1-2) - LOW RISK

**Goal:** Wrap existing response generation in PersonalityCoreLayer without changing behavior

**Changes:**
1. Import cognitive pipeline components
2. Wrap existing `callLLM()` call in PersonalityCoreLayer
3. Move `stripChainOfThought()` into PersonalityCoreLayer config
4. Keep identical response format

**Code Location:** `persona_chat.ts` lines 976-1113

**Before:**
```typescript
const llmResponse = await callLLM({
  role: 'persona',
  messages: histories[m],
  cognitiveMode,
  options: { temperature, max_tokens }
});

const assistantResponse = llmResponse.content;
const cleanedAssistant = stripChainOfThought(assistantResponse);
```

**After:**
```typescript
import { PersonalityCoreLayer } from '@metahuman/core';

const layer2 = new PersonalityCoreLayer();
const result = await layer2.process(
  {
    contextPackage, // Already have this from getRelevantContext()
    chatHistory: histories[m]
  },
  {
    cognitiveMode,
    metadata: {
      layerConfig: {
        modelRole: 'persona',
        stripChainOfThought: true,
        useLoRA: true
      }
    }
  }
);

const cleanedAssistant = result.response;
```

**Testing:**
- ✅ Compare responses before/after (should be identical)
- ✅ Verify LoRA adapter loading works
- ✅ Check voice metrics are captured
- ✅ Ensure SSE streaming still works

**Success Criteria:**
- No user-visible changes
- Response quality unchanged
- Performance impact < 100ms

**Rollback Plan:** Git revert, instant rollback

---

### Phase 4.2: Enable Safety Validation (Week 1, Days 3-4) - MEDIUM RISK

**Goal:** Add Layer 3 with safety-only validation in dual mode

**Changes:**
1. Add MetaCognitionLayer to pipeline
2. Configure validation level: `safety-only` for dual mode
3. Add audit logging for validation results
4. Do NOT enable refinement yet (just detect issues)

**Code Location:** Same section, add Layer 3

**Implementation:**
```typescript
import { CognitivePipeline, MetaCognitionLayer } from '@metahuman/core';

// Build 2-layer pipeline (or 3-layer with safety-only)
const pipeline = new CognitivePipeline();
// Layer 1 can stay as direct call for now
const layer2 = new PersonalityCoreLayer();
const layer3 = new MetaCognitionLayer();

pipeline.addLayer(layer2);
pipeline.addLayer(layer3);

const result = await pipeline.execute(
  {
    response: assistantResponse, // From Layer 2
    contextPackage
  },
  cognitiveMode
);

// Log validation results
if (result.layers[1]?.output) {
  const validation = result.layers[1].output;
  await audit({
    category: 'action',
    level: validation.passedValidation ? 'info' : 'warn',
    action: 'response_validated',
    details: {
      safe: validation.safety?.safe,
      safetyScore: validation.safety?.score,
      issues: validation.safety?.issues.length
    }
  });
}
```

**Configuration:**
```json
// etc/cognitive-layers.json
{
  "dual": {
    "layers": [
      {
        "name": "meta-cognition",
        "enabled": true,
        "config": {
          "validationLevel": "safety-only",  // Start with just safety
          "refineResponses": false,          // Don't auto-fix yet
          "allowUnsafe": false,              // Block unsafe responses
          "safetyThreshold": 0.9
        }
      }
    ]
  },
  "agent": {
    "layers": [
      {
        "name": "meta-cognition",
        "enabled": false  // Disable for agent mode initially
      }
    ]
  }
}
```

**Testing:**
- ✅ Test with safe responses (should pass)
- ✅ Test with API keys, passwords (should fail)
- ✅ Test with file paths, internal IPs (should warn)
- ✅ Verify audit logs contain validation results
- ✅ Check performance impact (should be <50ms for safety-only)

**Success Criteria:**
- Safety issues detected and logged
- No false positives on normal conversation
- Performance impact < 50ms
- Zero unsafe responses reach users

**Rollback Plan:** Set `enabled: false` in config, restart

---

### Phase 4.3: Enable Response Refinement (Week 1, Days 5-6) - MEDIUM RISK

**Goal:** Automatically sanitize responses that fail safety checks

**Changes:**
1. Enable `refineResponses: true` in config
2. Add user notification when response is refined
3. Monitor refinement rate and quality

**Configuration:**
```json
{
  "dual": {
    "layers": [
      {
        "name": "meta-cognition",
        "config": {
          "validationLevel": "safety-only",
          "refineResponses": true,  // ← Enable auto-fix
          "allowUnsafe": false
        }
      }
    ]
  }
}
```

**User Notification (Optional):**
```typescript
if (validation.refinement?.changed) {
  // Add subtle note to response
  await audit({
    category: 'action',
    level: 'info',
    action: 'response_refined',
    details: {
      changes: validation.refinement.changes,
      preservedMeaning: true
    }
  });
}
```

**Testing:**
- ✅ Test responses with sensitive data (should be redacted)
- ✅ Verify sanitization doesn't break response coherence
- ✅ Check refinement is logged to audit trail
- ✅ Monitor user satisfaction (no complaints about weird responses)

**Success Criteria:**
- Sensitive data is automatically redacted
- Refined responses are coherent
- Refinement rate < 5% of total responses
- No user complaints about quality

**Rollback Plan:** Set `refineResponses: false`, restart

---

### Phase 4.4: Full Validation (Week 2) - HIGHER RISK

**Goal:** Enable value alignment and consistency checks

**Changes:**
1. Change validation level to `full`
2. Enable all validators (safety + alignment + consistency)
3. Enable refinement for alignment/consistency issues
4. Monitor validation failures and refinement quality

**Configuration:**
```json
{
  "dual": {
    "layers": [
      {
        "name": "meta-cognition",
        "config": {
          "validationLevel": "full",  // ← All validators
          "refineResponses": true,
          "alignmentThreshold": 0.7,
          "consistencyThreshold": 0.7,
          "safetyThreshold": 0.9
        }
      }
    ]
  }
}
```

**Testing:**
- ✅ Test value-misaligned responses (should refine)
- ✅ Test inconsistent tone/style (should refine)
- ✅ Verify persona identity is preserved
- ✅ Check performance (full validation adds ~20s)
- ✅ Monitor false positive rate

**Success Criteria:**
- Responses align with persona values (>70% score)
- Consistent tone and style (>70% score)
- Performance acceptable (~65s total for dual mode)
- User feedback is positive

**Rollback Plan:** Change to `safety-only`, restart

---

### Phase 4.5: Complete Pipeline (Week 2-3) - HIGHER RISK

**Goal:** Use full 3-layer pipeline for all cognitive modes

**Changes:**
1. Replace direct `buildContextPackage()` with SubconsciousLayer
2. Enable pipeline for agent mode (safety-only)
3. Enable pipeline for emulation mode (no validation)
4. Add per-layer metrics to audit logs

**Implementation:**
```typescript
// Full pipeline approach
const pipeline = new CognitivePipeline();
pipeline.addLayer(new SubconsciousLayer());
pipeline.addLayer(new PersonalityCoreLayer());
pipeline.addLayer(new MetaCognitionLayer());

const result = await pipeline.execute(
  { userMessage: message },
  cognitiveMode
);

const assistantResponse = result.output.response;

// Stream to client
encoder.write({ type: 'answer', data: { response: assistantResponse } });
```

**Configuration for All Modes:**
```json
{
  "dual": {
    "layers": [
      { "name": "subconscious", "enabled": true },
      { "name": "personality-core", "enabled": true },
      { "name": "meta-cognition", "enabled": true, "config": { "validationLevel": "full" } }
    ]
  },
  "agent": {
    "layers": [
      { "name": "subconscious", "enabled": true },
      { "name": "personality-core", "enabled": true },
      { "name": "meta-cognition", "enabled": true, "config": { "validationLevel": "safety-only" } }
    ]
  },
  "emulation": {
    "layers": [
      { "name": "subconscious", "enabled": true },
      { "name": "personality-core", "enabled": true },
      { "name": "meta-cognition", "enabled": true, "config": { "validationLevel": "none" } }
    ]
  }
}
```

**Testing:**
- ✅ Test all 3 cognitive modes
- ✅ Verify mode-specific validation levels
- ✅ Check per-layer audit metrics
- ✅ Test mode switching mid-session
- ✅ Verify operator integration still works

**Success Criteria:**
- All modes use pipeline
- Mode-specific behavior works correctly
- Audit logs contain per-layer metrics
- Performance targets met (dual: <70s, agent: <15s, emulation: <12s)

**Rollback Plan:** Full revert to pre-pipeline code

---

## Operator Integration (Optional, Week 3)

**Goal:** Validate operator results before synthesis

**Changes:**
1. Add validation layer to `synthesizeOperatorAnswer()`
2. Check operator results for safety before showing user
3. Optionally use PersonalityCoreLayer for synthesis

**Implementation:**
```typescript
async function synthesizeOperatorAnswer(
  model: string,
  userMessage: string,
  operatorReport: string,
  cognitiveMode: string
): Promise<string> {
  // Generate synthesis as before
  const synthesis = await callLLM({ role: 'summarizer', messages, cognitiveMode });

  // Validate synthesis before returning
  const safety = await checkSafety(synthesis.content);

  if (!safety.safe && safety.sanitized) {
    // Use sanitized version
    await audit({
      category: 'security',
      level: 'warn',
      action: 'operator_synthesis_sanitized',
      details: { issues: safety.issues.length }
    });
    return safety.sanitized;
  }

  return synthesis.content;
}
```

**Testing:**
- ✅ Test operator results with file paths
- ✅ Test operator results with credentials
- ✅ Verify sanitization doesn't break synthesis

---

## Configuration Management

### Feature Flags

**File:** `etc/cognitive-layers.json`

**Per-Mode Flags:**
```json
{
  "dual": {
    "featureFlags": {
      "usePipeline": true,           // Use pipeline vs inline (Phase 4.1)
      "enableValidation": true,      // Enable Layer 3 (Phase 4.2)
      "enableRefinement": false,     // Auto-fix issues (Phase 4.3)
      "fullValidation": false,       // All validators (Phase 4.4)
      "logLayerMetrics": true        // Per-layer audit logs
    },
    "layers": [...]
  }
}
```

**Rollout Schedule:**
- **Week 1, Day 1:** `usePipeline: false` (baseline)
- **Week 1, Day 2:** `usePipeline: true` (Layer 2 wrapper)
- **Week 1, Day 3:** `enableValidation: true` (safety-only)
- **Week 1, Day 5:** `enableRefinement: true` (auto-sanitize)
- **Week 2, Day 1:** `fullValidation: true` (all validators)
- **Week 2, Day 3:** Full pipeline (all layers)

### Monitoring Metrics

**Add to Audit Logs:**
```typescript
// Per-layer execution
{
  event: 'cognitive_layer_executed',
  layer: 'personality-core',
  success: true,
  processingTime: 29452,
  cognitiveMode: 'dual'
}

// Validation results
{
  event: 'meta_cognition_complete',
  passedValidation: true,
  safetyScore: 1.0,
  alignmentScore: 0.85,
  consistencyScore: 0.92,
  refined: false
}

// Refinement applied
{
  event: 'response_refined',
  changes: ['Applied safety sanitization'],
  preservedMeaning: true,
  originalLength: 168,
  refinedLength: 152
}
```

**Dashboard Metrics:**
- Pipeline execution time (per layer)
- Validation pass/fail rate
- Refinement rate
- Safety issue frequency
- Value misalignment frequency
- Consistency issue frequency

---

## Backward Compatibility

### Must Preserve

**1. Response Format:**
```typescript
// SSE events stay the same
encoder.write({ type: 'answer', data: { response, saved } });
encoder.write({ type: 'reasoning', data: { stage, round, content } });
encoder.write({ type: 'error', data: { message } });
```

**2. Memory Capture:**
```typescript
// captureEvent() stays the same
if (allowMemoryWrites) {
  await captureEvent(message, 'conversation');
}
```

**3. Audit Logging:**
```typescript
// Add new events, keep existing ones
await audit({ category: 'chat', event: 'message_sent', ... }); // existing
await audit({ category: 'action', event: 'meta_cognition_complete', ... }); // new
```

**4. Authentication:**
- No changes to session validation
- No changes to permission checks
- Cognitive mode permissions stay the same

### Safe to Add

**1. Validation Metadata (Optional):**
```typescript
encoder.write({
  type: 'answer',
  data: {
    response,
    saved,
    validation: { // ← New, optional field
      safe: true,
      aligned: true,
      consistent: true,
      refined: false
    }
  }
});
```

**2. Layer Metrics:**
```typescript
// Add to audit logs
{
  event: 'chat_complete',
  layers: [
    { name: 'subconscious', time: 1389ms },
    { name: 'personality-core', time: 29452ms },
    { name: 'meta-cognition', time: 21539ms }
  ],
  totalTime: 52380ms
}
```

---

## Testing Strategy

### Unit Tests (Existing)

- ✅ Phase 1 integration test (already passing)
- ✅ Phase 2 integration test (already passing)
- ✅ Phase 3 integration test (already passing)

### Integration Tests (New)

**Test File:** `apps/site/src/__tests__/persona-chat-pipeline.test.ts`

**Tests:**
1. ✅ Pipeline responds to simple questions
2. ✅ Pipeline responds to operator-routed requests
3. ✅ Safety validation blocks unsafe responses
4. ✅ Refinement fixes sensitive data leaks
5. ✅ All cognitive modes work (dual, agent, emulation)
6. ✅ SSE streaming works with pipeline
7. ✅ Memory capture works with pipeline
8. ✅ Mode switching works mid-session

### Manual Testing

**Test Cases:**
1. **Normal conversation:** "What are you working on?"
2. **Sensitive data:** "My API key is sk-1234567890abcdef"
3. **Value-misaligned:** Ask to do something against values
4. **Inconsistent tone:** Response should match persona style
5. **Operator routing:** "Create a file called test.txt"
6. **Mode switching:** Change from dual to agent mid-chat

### Performance Testing

**Targets:**
- **Dual Mode:** < 70s total (full validation)
- **Agent Mode:** < 15s total (safety-only)
- **Emulation Mode:** < 12s total (no validation)

**Measurements:**
- Baseline (pre-pipeline)
- Phase 4.1 (Layer 2 wrapper)
- Phase 4.2 (+ safety validation)
- Phase 4.3 (+ refinement)
- Phase 4.4 (+ full validation)

### User Acceptance

**Criteria:**
- No user reports of quality degradation
- No user confusion from refinement
- Positive feedback on response consistency
- No increase in "the response was unhelpful" flags

---

## Risk Mitigation

### Rollback Strategy

**Level 1: Configuration Rollback (Instant)**
```bash
# Disable Layer 3
vi etc/cognitive-layers.json
# Set enabled: false for meta-cognition layer
# Restart not needed (hot-reload)
```

**Level 2: Feature Flag Rollback (30 seconds)**
```bash
# Disable pipeline
vi etc/cognitive-layers.json
# Set usePipeline: false
pkill -f "astro dev" && pnpm dev
```

**Level 3: Code Rollback (5 minutes)**
```bash
git revert <commit-hash>
git push
# Redeploy
```

### Monitoring Alerts

**Set Alerts For:**
- Pipeline execution time > 2x baseline
- Validation failure rate > 10%
- Refinement rate > 20%
- Safety issues detected > 5/hour
- User error reports increase > 50%

### Gradual Rollout

**Week 1:**
- Monday: Internal testing only
- Tuesday: 10% of dual mode users
- Wednesday: 50% of dual mode users
- Thursday: 100% of dual mode users
- Friday: Add agent mode (10%)

**Week 2:**
- Monday: Agent mode (100%)
- Tuesday: Full validation (10% of dual)
- Wednesday: Full validation (50% of dual)
- Thursday: Full validation (100% of dual)
- Friday: Complete pipeline (all modes, 10%)

**Week 3:**
- Monday: Complete pipeline (50%)
- Tuesday: Complete pipeline (100%)
- Wednesday: Monitor and tune
- Thursday: Operator integration (10%)
- Friday: Operator integration (100%)

---

## Success Criteria

### Phase 4.1 (Layer 2 Wrapper)
- [ ] Zero user-visible changes
- [ ] Response quality unchanged
- [ ] Performance impact < 100ms
- [ ] LoRA adapter loading works
- [ ] Voice metrics captured

### Phase 4.2 (Safety Validation)
- [ ] Safety issues detected and logged
- [ ] No false positives on normal chat
- [ ] Performance impact < 50ms
- [ ] Zero unsafe responses reach users

### Phase 4.3 (Refinement)
- [ ] Sensitive data automatically redacted
- [ ] Refined responses coherent
- [ ] Refinement rate < 5%
- [ ] No user complaints

### Phase 4.4 (Full Validation)
- [ ] Value alignment > 70%
- [ ] Consistency > 70%
- [ ] Performance acceptable (~65s dual mode)
- [ ] User feedback positive

### Phase 4.5 (Complete Pipeline)
- [ ] All modes use pipeline
- [ ] Mode-specific behavior correct
- [ ] Per-layer metrics logged
- [ ] Performance targets met

---

## Timeline

**Week 1: Core Integration**
- Day 1-2: Layer 2 wrapper
- Day 3-4: Safety validation
- Day 5-6: Refinement

**Week 2: Full Validation**
- Day 1-2: Value alignment + consistency
- Day 3-4: Complete pipeline
- Day 5: Monitoring and tuning

**Week 3: Optimization**
- Day 1-2: Operator integration
- Day 3-4: Performance tuning
- Day 5: Documentation

---

## Conclusion

Phase 4 integration is **ready to proceed** with:
- ✅ Clean integration points identified
- ✅ No overlapping functionality
- ✅ Safe phased rollout plan
- ✅ Comprehensive testing strategy
- ✅ Clear rollback procedures
- ✅ Monitoring and alerting defined

**Recommendation:** Proceed with Phase 4.1 (Layer 2 wrapper) this week. Low risk, high value. 🚀

---

**End of Phase 4 Integration Plan**
