# Phase 4.3: Response Refinement (Non-blocking)

**Status:** 🚧 IN PROGRESS
**Risk Level:** LOW (non-blocking, optional refinement)
**Timeline:** 1-2 hours

## Overview

Phase 4.3 adds **non-blocking response refinement** that automatically sanitizes detected safety issues. This phase builds on Phase 4.2 by not just detecting issues, but also fixing them automatically.

**Key Principle:** Refinement is **still non-blocking** in Phase 4.3 - we log both original and refined responses but send the ORIGINAL to users. This allows us to:
1. Test refinement accuracy
2. Compare original vs refined responses
3. Gather data for future enforcement decisions
4. Build confidence before enabling blocking mode

## Goals

1. ✅ Auto-sanitize detected safety issues
2. ✅ Log both original and refined responses
3. ✅ NO user-facing changes yet (non-blocking)
4. ✅ Feature flag controlled (can disable)
5. ✅ Compare refinement effectiveness

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
┌─────────────────────────────────┐
│ PHASE 4.3: Refinement           │ ← New addition
│ - Sanitize sensitive data       │
│ - Remove file paths             │
│ - Log original + refined        │
│ - Send ORIGINAL (non-blocking)  │
└─────────────────────────────────┘
    ↓
Response sent to user (original, unchanged)
```

## Implementation Plan

### Step 1: Create Refinement Wrapper

**File:** `packages/core/src/cognitive-layers/utils/refinement-wrapper.ts` (NEW)

**Purpose:** Convenience wrapper for non-blocking refinement with comparison

```typescript
export interface RefinementCheckResult {
  original: string;
  refined: string;
  changed: boolean;
  changes: Array<{
    type: string;
    description: string;
    before: string;
    after: string;
  }>;
  safetyIssuesFixed: number;
  refinementTime: number;
}

export async function refineResponseSafely(
  response: string,
  safetyResult: SafetyCheckResult,
  options?: RefinementOptions
): Promise<RefinementCheckResult> {
  // If no issues, return unchanged
  if (safetyResult.safe || safetyResult.issues.length === 0) {
    return {
      original: response,
      refined: response,
      changed: false,
      changes: [],
      safetyIssuesFixed: 0,
      refinementTime: 0
    };
  }

  // Sanitize based on detected issues
  let refined = response;
  const changes = [];

  for (const issue of safetyResult.issues) {
    if (issue.type === 'sensitive_data') {
      // Replace API keys, passwords, etc.
      refined = sanitizeSensitiveData(refined, issue);
      changes.push({
        type: issue.type,
        description: issue.description,
        before: extractContext(response, issue),
        after: '[REDACTED]'
      });
    } else if (issue.type === 'security_violation') {
      // Remove file paths, IPs
      refined = sanitizeSecurityViolations(refined, issue);
      changes.push({
        type: issue.type,
        description: issue.description,
        before: extractContext(response, issue),
        after: '[PATH REMOVED]'
      });
    }
  }

  // Audit refinement
  await audit({
    category: 'action',
    level: 'info',
    action: 'response_refined',
    details: {
      changed: refined !== response,
      changesCount: changes.length,
      issuesFixed: changes.length,
      blocking: false // Phase 4.3 is non-blocking
    }
  });

  return {
    original: response,
    refined,
    changed: refined !== response,
    changes,
    safetyIssuesFixed: changes.length,
    refinementTime: Date.now() - startTime
  };
}
```

### Step 2: Integrate into persona_chat.ts

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Location:** After safety check (Phase 4.2), before history storage

**Changes:**

```typescript
// === PHASE 4.2: Safety validation (non-blocking) ===
let safetyResult: SafetyCheckResult | undefined;
if (USE_COGNITIVE_PIPELINE && ENABLE_SAFETY_CHECKS && assistantResponse) {
  try {
    safetyResult = await checkResponseSafety(assistantResponse, {
      threshold: 0.7,
      cognitiveMode,
      logToConsole: true,
      auditIssues: true
    });

    if (!safetyResult.safe) {
      console.warn(`[SAFETY] Response has ${safetyResult.issues.length} safety issue(s)`);
    } else {
      console.log(`[SAFETY] Response passed safety checks`);
    }
  } catch (error) {
    console.error('[SAFETY] Check failed (non-blocking):', error);
  }
}

// === PHASE 4.3: Response refinement (non-blocking) ===
if (USE_COGNITIVE_PIPELINE && ENABLE_RESPONSE_REFINEMENT && safetyResult && !safetyResult.safe) {
  try {
    const refinementResult = await refineResponseSafely(assistantResponse, safetyResult, {
      logToConsole: true,
      auditChanges: true
    });

    if (refinementResult.changed) {
      console.log(`[REFINEMENT] Response refined (${refinementResult.changes.length} changes)`);
      console.log(`  Original length: ${refinementResult.original.length} chars`);
      console.log(`  Refined length: ${refinementResult.refined.length} chars`);
      console.log(`  Changes:`);
      for (const change of refinementResult.changes) {
        console.log(`    - ${change.type}: ${change.description}`);
      }

      // NOTE: Still sending ORIGINAL response (non-blocking mode)
      // Future Phase 4.4 will enable sending refined response
      console.log(`  [INFO] Sending ORIGINAL response (Phase 4.3 is non-blocking)`);
    }
  } catch (error) {
    console.error('[REFINEMENT] Failed (non-blocking):', error);
  }
}

// Store history (still using ORIGINAL response)
```

### Step 3: Add Configuration

**File:** `.env.example`

```bash
# ENABLE_RESPONSE_REFINEMENT (Phase 4.3)
# When enabled, auto-sanitizes detected safety issues (non-blocking test mode)
# Use case: Test automatic sanitization of sensitive data and security issues
# Effect: Both original and refined logged, ORIGINAL still sent to user
# Note: Only active when USE_COGNITIVE_PIPELINE=true
# Default: true (enabled when pipeline is enabled)
#ENABLE_RESPONSE_REFINEMENT=true
```

### Step 4: Create Integration Test

**File:** `packages/core/src/cognitive-layers/__tests__/phase4.3-integration.test.ts`

**Tests:**
1. Safe response (no refinement needed)
2. Response with API key (sensitive data sanitization)
3. Response with file path (security violation sanitization)
4. Multiple issues in one response
5. Verify original preserved (non-blocking)
6. Compare before/after quality

### Step 5: Documentation

**File:** `docs/COGNITIVE_LAYERS_PHASE4.3_COMPLETE.md`

## Refinement Types

### 1. Sensitive Data Sanitization

**API Keys:**
```
Before: "Your API key is sk-1234567890abcdef"
After:  "Your API key is [API_KEY_REDACTED]"
```

**Passwords:**
```
Before: "The password is hunter2"
After:  "The password is [PASSWORD_REDACTED]"
```

**SSH Keys:**
```
Before: "Here's the key: -----BEGIN RSA PRIVATE KEY-----..."
After:  "Here's the key: [SSH_KEY_REDACTED]"
```

### 2. Security Violation Sanitization

**File Paths:**
```
Before: "Check the file at /home/user/.ssh/id_rsa"
After:  "Check the file at [FILE_PATH_REDACTED]"
```

**Internal IPs:**
```
Before: "Connect to 192.168.1.100"
After:  "Connect to [IP_ADDRESS_REDACTED]"
```

### 3. Preservation Rules

**What's Preserved:**
- Sentence structure
- Meaning and intent
- Technical explanations (if not sensitive)
- Example code (if safe)

**What's Removed:**
- Actual secrets/keys
- Real file paths
- Internal IP addresses
- Personal identifiers

## Audit Log Examples

### Refinement Applied
```json
{
  "timestamp": "2025-11-05T13:00:00Z",
  "category": "action",
  "level": "info",
  "action": "response_refined",
  "details": {
    "changed": true,
    "changesCount": 2,
    "issuesFixed": 2,
    "changeTypes": ["sensitive_data", "security_violation"],
    "originalLength": 150,
    "refinedLength": 142,
    "blocking": false,
    "refinementTime": 3
  }
}
```

### No Refinement Needed
```json
{
  "timestamp": "2025-11-05T13:01:00Z",
  "category": "action",
  "level": "info",
  "action": "response_refined",
  "details": {
    "changed": false,
    "changesCount": 0,
    "issuesFixed": 0,
    "blocking": false
  }
}
```

## Monitoring

After deploying Phase 4.3, monitor:

1. **Refinement Rate**
   - Percentage of responses refined
   - Average changes per refinement

2. **Quality Impact**
   - Manual review of refined responses
   - User feedback (if visible in UI)
   - Accuracy of sanitization

3. **Performance**
   - Refinement time (<10ms target)
   - Total overhead with safety + refinement

4. **False Positives**
   - Over-sanitization (too aggressive)
   - Under-sanitization (missed issues)

## Success Criteria

Phase 4.3 is successful when:

- [x] Refinement runs on unsafe responses
- [x] Sensitive data properly sanitized
- [x] Original response preserved (non-blocking)
- [x] Changes logged to audit
- [x] <10ms refinement overhead
- [x] Integration tests pass

## Rollback Plan

If issues occur:

1. **Disable refinement only:**
   ```bash
   ENABLE_RESPONSE_REFINEMENT=false
   ```

2. **Disable safety checks:**
   ```bash
   ENABLE_SAFETY_CHECKS=false
   ```

3. **Disable entire pipeline:**
   ```bash
   USE_COGNITIVE_PIPELINE=false
   ```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Over-sanitization | Medium | Low | Non-blocking, can review logs |
| Under-sanitization | Low | Low | Still detecting and logging |
| Performance impact | Low | Low | Target <10ms, non-blocking |
| Breaking responses | None | None | Original always sent |

**Overall Risk: LOW**

## Next Phase: 4.4

After validating Phase 4.3:

**Phase 4.4: Enable Refinement (Blocking)**
- Start sending REFINED responses to users
- Monitor user feedback
- Adjust sanitization rules based on feedback
- Prepare for full Layer 3 integration

## Timeline

- **Step 1:** Refinement wrapper (30 min)
- **Step 2:** Integration (20 min)
- **Step 3:** Configuration (5 min)
- **Step 4:** Tests (30 min)
- **Step 5:** Documentation (30 min)

**Total: ~2 hours**
