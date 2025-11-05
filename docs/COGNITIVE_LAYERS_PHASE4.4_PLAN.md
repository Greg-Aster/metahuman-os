# Phase 4.4: Enable Response Refinement (Blocking Mode)

**Status:** 🚧 IN PROGRESS
**Risk Level:** MEDIUM (user-facing changes, actual blocking)
**Timeline:** 1 hour

## Overview

Phase 4.4 is the **final step** of Phase 4 integration - we transition from monitoring to enforcement by actually sending the refined responses to users. This is a controlled rollout with easy rollback.

**Key Change:** Switch from sending ORIGINAL to sending REFINED responses when safety issues are detected and fixed.

## Goals

1. ✅ Add blocking mode feature flag
2. ✅ Send refined responses to users (when enabled)
3. ✅ Preserve original in audit logs for review
4. ✅ Easy rollback mechanism
5. ✅ Monitor user impact

## Architecture

```
User Message
    ↓
Context Building (Layer 1)
    ↓
Response Generation (Layer 2)
    ↓
Safety Check (Phase 4.2)
    ↓
Refinement (Phase 4.3)
    ↓
┌─────────────────────────────────┐
│ PHASE 4.4: Blocking Mode        │ ← New decision point
│ - If BLOCKING_MODE=true         │
│   → Send REFINED                │
│ - If BLOCKING_MODE=false        │
│   → Send ORIGINAL (Phase 4.3)   │
└─────────────────────────────────┘
    ↓
Response sent to user (refined or original)
```

## Implementation Plan

### Step 1: Add Blocking Mode Flag

**File:** `apps/site/src/pages/api/persona_chat.ts`

Add new feature flag:

```typescript
// Feature flag: Enable blocking mode (Phase 4.4)
// When true, sends REFINED responses to users (instead of original)
// IMPORTANT: Only enable after validating refinement quality in Phase 4.3
// Default: false (non-blocking mode, explicit opt-in required for safety)
const ENABLE_BLOCKING_MODE = process.env.ENABLE_BLOCKING_MODE === 'true';
```

### Step 2: Modify Response Logic

**File:** `apps/site/src/pages/api/persona_chat.ts`

Update refinement section (around line 1239-1271):

```typescript
// === PHASE 4.3: Response refinement (non-blocking) ===
if (USE_COGNITIVE_PIPELINE && ENABLE_RESPONSE_REFINEMENT && safetyResult && !safetyResult.safe) {
  try {
    const refinementResult = await refineResponseSafely(assistantResponse, safetyResult, {
      logToConsole: true,
      auditChanges: true,
      cognitiveMode
    });

    if (refinementResult.changed) {
      console.log(`[REFINEMENT] Response refined (${refinementResult.changes.length} changes):`);
      console.log(`  - Original length: ${refinementResult.original.length} chars`);
      console.log(`  - Refined length: ${refinementResult.refined.length} chars`);
      console.log(`  - Issues fixed: ${refinementResult.safetyIssuesFixed}`);

      // === PHASE 4.4: Blocking mode decision ===
      if (ENABLE_BLOCKING_MODE) {
        // Send refined response to user
        assistantResponse = refinementResult.refined;
        console.log(`  [BLOCKING MODE] Sending REFINED response to user`);
        console.log(`  [INFO] Original preserved in audit logs`);
      } else {
        // Phase 4.3 behavior: send original
        console.log(`  [NON-BLOCKING MODE] Sending ORIGINAL response`);
        console.log(`  [INFO] Refined response logged for testing`);
      }
    }
  } catch (error) {
    console.error('[REFINEMENT] Failed:', error);
    // Always send original on refinement errors (fail-safe)
  }
}
```

### Step 3: Enhanced Audit Logging

Add blocking mode status to audit logs:

```typescript
await audit({
  category: 'action',
  level: 'info',
  action: 'response_refined',
  details: {
    changed: refinementResult.changed,
    changesCount: refinementResult.changes.length,
    blockingMode: ENABLE_BLOCKING_MODE,
    responseSent: ENABLE_BLOCKING_MODE ? 'refined' : 'original',
    originalLength: refinementResult.original.length,
    refinedLength: refinementResult.refined.length
  }
});
```

### Step 4: Add Configuration

**File:** `.env.example`

```bash
# ENABLE_BLOCKING_MODE (Phase 4.4)
# When enabled, sends REFINED responses to users (blocking mode)
# IMPORTANT: Only enable after validating refinement quality in Phase 4.3 logs
# Use case: Actually sanitize responses sent to users
# Effect: Users receive sanitized responses, originals logged
# Note: Only active when USE_COGNITIVE_PIPELINE=true and refinement succeeds
# Rollback: Set to false to return to monitoring mode
# Default: false (non-blocking, explicit opt-in required)
#ENABLE_BLOCKING_MODE=true
```

### Step 5: Create Integration Test

**File:** `packages/core/src/cognitive-layers/__tests__/phase4.4-integration.test.ts`

**Tests:**
1. Blocking mode disabled (Phase 4.3 behavior)
2. Blocking mode enabled (refined sent)
3. Verify original preserved in logs
4. Rollback test (disable flag)
5. Error handling (fallback to original)

### Step 6: Documentation

**File:** `docs/COGNITIVE_LAYERS_PHASE4.4_COMPLETE.md`

## Rollout Strategy

### Phase 1: Internal Testing (Days 1-2)
```bash
# Enable on dev environment only
ENABLE_BLOCKING_MODE=true
```
- Monitor console logs for refinement quality
- Check user experience with sanitized responses
- Verify no important context lost

### Phase 2: Limited Production (Days 3-5)
```bash
# Enable on production during low-traffic hours
ENABLE_BLOCKING_MODE=true
```
- Monitor during specific hours only
- Gather user feedback
- Review audit logs daily

### Phase 3: Full Production (Week 2+)
```bash
# Enable permanently after validation
ENABLE_BLOCKING_MODE=true
```
- Full deployment
- Continuous monitoring
- Refinement tuning as needed

## Success Criteria

Phase 4.4 is successful when:

- [x] Blocking mode flag implemented
- [x] Refined responses sent to users (when enabled)
- [x] Original responses preserved in audit
- [x] Easy rollback (toggle flag)
- [x] No quality degradation reported
- [x] Integration tests pass

## Monitoring

After enabling blocking mode:

1. **User Impact**
   - Feedback on response quality
   - Reports of missing context
   - Satisfaction metrics

2. **Refinement Effectiveness**
   - Percentage of responses refined
   - Changes per refinement
   - False positive rate

3. **Safety Improvements**
   - Sensitive data leaks prevented
   - Security violations blocked
   - Incident reduction

4. **Performance**
   - No significant latency increase
   - Refinement overhead acceptable

## Rollback Plan

If issues occur:

### Immediate Rollback (< 5 minutes)
```bash
# Disable blocking mode
ENABLE_BLOCKING_MODE=false

# Restart server
pnpm --filter @metahuman/site dev
```

### Verify Rollback
- Console shows: `[NON-BLOCKING MODE] Sending ORIGINAL response`
- Users receive unmodified responses
- Refinement still logged for review

### Gradual Rollback Options

**Option 1:** Disable refinement entirely
```bash
ENABLE_RESPONSE_REFINEMENT=false
```

**Option 2:** Disable safety checks
```bash
ENABLE_SAFETY_CHECKS=false
```

**Option 3:** Disable entire pipeline
```bash
USE_COGNITIVE_PIPELINE=false
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Over-sanitization | Medium | Medium | Monitor logs, tune patterns |
| Context loss | Low | Medium | Preserve originals, easy rollback |
| User complaints | Low | Medium | Quick rollback, gather feedback |
| False positives | Medium | Low | Continuous refinement tuning |
| Performance impact | Low | Low | Already measured (<10ms) |

**Overall Risk: MEDIUM**

Key mitigations:
- Default disabled (explicit opt-in)
- Easy rollback mechanism
- Original always preserved in logs
- Gradual rollout strategy

## After Phase 4.4

Once Phase 4.4 is stable:

**Next: Phase 4.5 (Optional Enhancements)**
- LLM-based refinement for complex issues
- Adaptive thresholds based on feedback
- User preferences for sanitization level
- A/B testing framework

**Then: Phase 5 (Full Layer 3 Integration)**
- Complete 3-layer pipeline
- Value alignment validation
- Consistency checking
- Unified validation framework

## Timeline

- **Step 1:** Add blocking flag (5 min)
- **Step 2:** Modify response logic (15 min)
- **Step 3:** Enhanced audit (10 min)
- **Step 4:** Configuration (5 min)
- **Step 5:** Integration test (20 min)
- **Step 6:** Documentation (15 min)

**Total: ~1 hour**

## Important Notes

1. **Default is non-blocking:** Flag defaults to `false` for safety
2. **Explicit opt-in:** Must be intentionally enabled
3. **Easy rollback:** Single flag toggle
4. **Preserves originals:** Always logged for review
5. **Fail-safe:** Errors fallback to original response
6. **Gradual rollout:** Test internally before production
7. **Monitor closely:** First 48 hours critical
