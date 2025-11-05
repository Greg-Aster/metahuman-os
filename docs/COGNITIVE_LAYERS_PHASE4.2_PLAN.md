# Phase 4.2: Safety Validation (Non-blocking)

**Status:** 🚧 IN PROGRESS
**Risk Level:** LOW (non-blocking validation, audit only)
**Timeline:** 1-2 hours

## Overview

Phase 4.2 adds **non-blocking** safety validation to responses before they're sent to users. This phase focuses on detection and logging WITHOUT interrupting the user experience.

**Key Principle:** Safety checks are **informational only** - responses are never blocked in this phase. This allows us to:
1. Build a safety baseline (what issues occur naturally)
2. Validate the safety checker accuracy (false positives?)
3. Gather data for future enforcement decisions

## Goals

1. ✅ Add safety validation after response generation
2. ✅ Log safety issues to audit system
3. ✅ NO user-facing changes (non-blocking)
4. ✅ Feature flag controlled (can disable)
5. ✅ Monitor safety metrics over time

## Architecture

```
User Message
    ↓
Context Building (Layer 1)
    ↓
Response Generation (Layer 2)
    ↓
┌─────────────────────────────┐
│ PHASE 4.2: Safety Check     │ ← New addition
│ - checkSafety(response)     │
│ - Log issues to audit       │
│ - NO blocking               │
└─────────────────────────────┘
    ↓
Response sent to user (unchanged)
```

## Implementation Plan

### Step 1: Create Safety Wrapper Function

**File:** `packages/core/src/cognitive-layers/utils/safety-wrapper.ts` (NEW)

**Purpose:** Convenience wrapper for non-blocking safety checks

```typescript
export interface SafetyCheckResult {
  safe: boolean;
  issues: SafetyIssue[];
  score: number;
  checkTime: number;
  response: string; // Always returned (non-blocking)
}

export async function checkResponseSafety(
  response: string,
  options?: SafetyOptions
): Promise<SafetyCheckResult> {
  const startTime = Date.now();

  const result = await checkSafety(response, options);

  await audit({
    category: 'action',
    level: result.safe ? 'info' : 'warn',
    action: 'safety_check_completed',
    details: {
      safe: result.safe,
      score: result.score,
      issuesFound: result.issues.length,
      issueTypes: result.issues.map(i => i.type),
      checkTime: Date.now() - startTime,
      blocking: false // Non-blocking in Phase 4.2
    }
  });

  return {
    ...result,
    checkTime: Date.now() - startTime,
    response // Always return response (non-blocking)
  };
}
```

### Step 2: Integrate into persona_chat.ts

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Location:** After response generation, before `stripChainOfThought()`

**Changes:**

```typescript
// Around line 1110, before stripChainOfThought()

// === PHASE 4.2: Safety validation (non-blocking) ===
if (USE_COGNITIVE_PIPELINE && process.env.ENABLE_SAFETY_CHECKS !== 'false') {
  try {
    const safetyResult = await checkResponseSafety(assistantResponse, {
      threshold: 0.7,
      includeCategories: ['sensitive_data', 'harmful_content', 'security_violations']
    });

    if (!safetyResult.safe) {
      console.warn('[SAFETY] Issues detected:', safetyResult.issues.length);
      // Log details but don't block response
      for (const issue of safetyResult.issues) {
        console.warn(`  - ${issue.type}: ${issue.description} (${issue.severity})`);
      }
    }
  } catch (error) {
    console.error('[SAFETY] Check failed:', error);
    // Continue anyway (non-blocking)
  }
}
```

**Key Points:**
- Only runs when `USE_COGNITIVE_PIPELINE=true`
- Can be disabled with `ENABLE_SAFETY_CHECKS=false`
- Errors are caught and logged (never interrupt response)
- Issues logged to console and audit

### Step 3: Add Configuration

**File:** `.env.example`

```bash
# ENABLE_SAFETY_CHECKS
# When enabled, runs safety validation on all responses (non-blocking)
# Use case: Monitor for sensitive data leaks, harmful content, security issues
# Effect: Issues logged to audit, responses never blocked
# Default: true (enabled when USE_COGNITIVE_PIPELINE=true)
#ENABLE_SAFETY_CHECKS=true
```

### Step 4: Create Integration Test

**File:** `packages/core/src/cognitive-layers/__tests__/phase4.2-integration.test.ts`

**Tests:**
1. Safe response (no issues detected)
2. Response with sensitive data (API key)
3. Response with file paths
4. Verify non-blocking behavior
5. Verify audit logging

### Step 5: Documentation

**File:** `docs/COGNITIVE_LAYERS_PHASE4.2_COMPLETE.md`

- Implementation summary
- Safety check types
- Audit log examples
- Metrics to monitor
- Next steps (Phase 4.3)

## Safety Check Types

Phase 4.2 detects:

### 1. Sensitive Data
- API keys (sk-, pk-, Bearer, etc.)
- Passwords and secrets
- SSH private keys
- Credit card numbers
- Authentication tokens

### 2. Harmful Content
- Malicious commands (rm -rf, DROP TABLE)
- SQL injection patterns
- XSS attempts
- Code injection

### 3. Security Violations
- Absolute file paths (/home/, /etc/)
- Internal IP addresses
- Environment variable exposure
- System information leaks

### 4. Privacy Leaks
- Email addresses
- Phone numbers
- Social security numbers
- Personal identifiers

## Audit Log Examples

### Safe Response
```json
{
  "timestamp": "2025-11-05T10:30:00Z",
  "category": "action",
  "level": "info",
  "action": "safety_check_completed",
  "details": {
    "safe": true,
    "score": 1.0,
    "issuesFound": 0,
    "issueTypes": [],
    "checkTime": 15,
    "blocking": false
  }
}
```

### Unsafe Response (Non-blocking)
```json
{
  "timestamp": "2025-11-05T10:31:00Z",
  "category": "action",
  "level": "warn",
  "action": "safety_check_completed",
  "details": {
    "safe": false,
    "score": 0.3,
    "issuesFound": 2,
    "issueTypes": ["sensitive_data", "file_path"],
    "checkTime": 18,
    "blocking": false
  }
}
```

## Monitoring

After deploying Phase 4.2, monitor:

1. **Safety Check Frequency**
   - How many responses are checked?
   - Average check time?

2. **Issue Detection Rate**
   - Percentage of unsafe responses
   - Most common issue types
   - False positive rate

3. **Performance Impact**
   - Average check time: ~15-20ms
   - P95 check time: <50ms
   - Total overhead: <2%

4. **Issue Breakdown**
   - Sensitive data: X%
   - File paths: Y%
   - Harmful content: Z%

## Success Criteria

Phase 4.2 is successful when:

- [x] Safety checks run on all responses (when enabled)
- [x] No user-facing changes (non-blocking)
- [x] Issues logged to audit system
- [x] <50ms performance overhead
- [x] Feature flag works correctly
- [x] Integration tests pass

## Rollback Plan

If issues occur:

1. **Disable safety checks:**
   ```bash
   ENABLE_SAFETY_CHECKS=false
   ```

2. **Or disable entire pipeline:**
   ```bash
   USE_COGNITIVE_PIPELINE=false
   ```

3. **Verify:**
   - No console warnings about safety
   - No audit logs with "safety_check_completed"

## Next Phase: 4.3

After validating Phase 4.2:

**Phase 4.3: Response Refinement (Non-blocking)**
- Auto-fix detected safety issues
- Sanitize sensitive data
- Still non-blocking (log before/after)
- Prepare for full Layer 3 integration

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Performance degradation | Low | Low | Non-blocking, <20ms overhead |
| False positives | Medium | Low | Informational only, no blocking |
| Missed issues | Medium | Low | Pattern-based, will improve over time |
| Audit log spam | Low | Low | Can disable with flag |

**Overall Risk: LOW**

## Timeline

- **Step 1:** Safety wrapper (15 min)
- **Step 2:** Integration (20 min)
- **Step 3:** Configuration (5 min)
- **Step 4:** Tests (30 min)
- **Step 5:** Documentation (30 min)

**Total: ~2 hours**
