# Babysitter Phase 2 - Auto-Healing Implementation

**Date**: 2026-01-12
**Status**: Phase 2 Complete ✅
**Execution Time**: ~1 hour after Phase 1

---

## What We Built

**Self-healing capability** that automatically fixes recurring errors without user intervention.

### Auto-Healing Flow

```
Pattern Detected (3+ occurrences) →
Check Risk Level (low/medium only) →
Generate Fix (via Big Brother/Claude) →
Run Tests (if configured) →
Auto-Approve Fix →
Apply Fix →
Monitor Results →
Update Stats
```

---

## Components Added

### 1. AutoHealer Class

**Location**: `brain/agents/babysitter.ts` (lines 537-725)

**Features**:
- ✅ Policy-based auto-fixing (low + medium risk)
- ✅ Cooldown period (1 hour between attempts)
- ✅ Max retries (3 attempts per pattern)
- ✅ Blacklist support (database changes, production deployments)
- ✅ Test-first approach (runs tests before applying)
- ✅ Automatic approval bypass
- ✅ Rollback on failure

**Methods**:
- `attemptAutoHeal(pattern, errorId)` - Main auto-healing logic
- `runTests(testCommands)` - Executes test commands
- `logAttempt(signature, success)` - Tracks attempts and retries

### 2. Integration with System Coder

**Modified**: `BabysitterAgent.handleError()` and `detectPattern()`

**Changes**:
- Error capture now returns `errorId`
- Pattern detection triggers auto-healing when recurring
- Tracks fixes applied vs. escalated
- Updates state counters for monitoring

### 3. Enhanced State Tracking

**New State Fields** (already in BabysitterState):
- `errorsAutoFixed` - Count of successfully auto-fixed errors
- `errorsEscalated` - Count of errors escalated to user

**New Internal Maps**:
- `errorIdsByPattern` - Maps pattern signatures to most recent error IDs
- `autoFixable` flag on DetectedPattern - Prevents duplicate healing attempts

---

## Auto-Healing Policy

### Risk Levels Handled

```json
{
  "autoHealing": {
    "maxRisk": "medium",
    "testFirst": true,
    "maxRetries": 3,
    "cooldownPeriod": 3600000
  }
}
```

**Risk Matrix**:

| Risk Level | Auto-Heal? | Requires Approval? | Example |
|------------|-----------|-------------------|---------|
| **none** | ✅ Yes | No | Formatting, whitespace |
| **low** | ✅ Yes | No | Simple bug fixes, typos |
| **medium** | ✅ Yes | No | Logic fixes, small refactors |
| **high** | ❌ No | Yes | Database queries, API changes |
| **critical** | ❌ No | Yes | Security, data loss potential |

### Blacklist

Pre-configured to reject these patterns (even if low/medium risk):
- `database-schema-change`
- `production-deployment`
- `git-push`
- `npm-publish`

**Why**: These operations require human oversight regardless of perceived risk.

### Cooldown & Retries

- **Cooldown**: 1 hour between attempts for the same pattern
- **Max Retries**: 3 attempts before giving up
- **Reset**: Successful fix resets retry counter

---

## Complete Auto-Healing Example

### Scenario: Recurring TTS Queue Error

**Step 1: Pattern Detected**
```
[babysitter] ⚠️ RECURRING PATTERN: "[TTS Queue] Error: SyntaxError: Unexpected end of JSON input" (84x in 3min)
```

**Step 2: Auto-Healing Triggered**
```
[babysitter] 🔧 Attempting auto-heal for: "[TTS Queue] Error: SyntaxError: Unexpected end of JSON input"
[babysitter] Generating fix for error err-2026-01-12T20-28-26-abc123...
```

**Step 3: Fix Generated**
```
[babysitter] Fix generated: fix-2026-01-12T20-29-01-def456 (risk: low, confidence: 0.85)
```

**Step 4: Risk Check**
```
[babysitter] Risk level: low (within threshold: medium)
```

**Step 5: Blacklist Check**
```
[babysitter] No blacklist matches found
```

**Step 6: Test Execution** (if configured)
```
[babysitter] Running tests: pnpm test:tts
[babysitter] ✓ Tests passed
```

**Step 7: Auto-Approval**
```
[babysitter] Auto-approving fix fix-2026-01-12T20-29-01-def456...
[babysitter] Approved by: babysitter-auto-heal
```

**Step 8: Application**
```
[babysitter] Applying fix fix-2026-01-12T20-29-01-def456...
[babysitter] ✅ AUTO-HEALED: "[TTS Queue] Error: SyntaxError: Unexpected end of JSON input" with fix fix-2026-01-12T20-29-01-def456
```

**Step 9: State Update**
```
state.errorsAutoFixed++;  // Now: 1
```

---

## Escalation Flow (High Risk)

### Scenario: Database Schema Change

**Step 1: Pattern Detected**
```
[babysitter] ⚠️ RECURRING PATTERN: "Error: Cannot add column without default" (5x in 10min)
```

**Step 2: Fix Generated**
```
[babysitter] Fix generated: fix-xyz (risk: high, confidence: 0.90)
```

**Step 3: Risk Check Fails**
```
[babysitter] ⚠️ Risk too high (high), escalating to user
```

**Step 4: Escalation**
```
[babysitter] ⚠️ Auto-heal failed: Risk high exceeds max medium - requires manual approval
[babysitter] 📋 Fix fix-xyz available for manual review
```

**Step 5: State Update**
```
state.errorsEscalated++;  // Now: 1
```

**User Action**: Review fix in System Coder UI → Approve/Reject manually

---

## Integration Points

### With System Coder

```typescript
// 1. Generate fix
const result = await generateFixForError(username, errorId);

// 2. Auto-approve (bypassing manual step)
updateFixStatus(username, fix.id, 'approved', {
  approvedBy: 'babysitter-auto-heal',
});

// 3. Apply fix
const applyResult = applyFix(username, fix.id);

// 4. Revert if needed
if (postApplyTestsFail) {
  revertFix(username, fix.id);
}
```

### With Big Brother

- Fix generation routes through Big Brother (`generateFixForError` calls Claude CLI)
- Real-time terminal visibility on port 3099
- Full context and file analysis via Claude

### With Lizard Brain (Future)

- Failed auto-heals will trigger `checkFailedAgents` in Lizard Brain
- Recurring escalations can trigger human notification desires
- Successful auto-heals feed into system health metrics

---

## Configuration

### Auto-Healing Settings

```json
// etc/babysitter.json
{
  "autoHealing": {
    "enabled": true,
    "maxRisk": "medium",
    "testFirst": true,
    "maxRetries": 3,
    "cooldownPeriod": 3600000,
    "blacklist": [
      "database-schema-change",
      "production-deployment",
      "git-push",
      "npm-publish"
    ]
  }
}
```

### Tuning Parameters

| Parameter | Default | Recommended Range | Purpose |
|-----------|---------|-------------------|---------|
| `maxRisk` | `medium` | `low`-`medium` | Risk threshold for auto-apply |
| `testFirst` | `true` | `true` | Run tests before applying |
| `maxRetries` | `3` | `2`-`5` | Attempts before giving up |
| `cooldownPeriod` | `3600000` (1h) | `1800000`-`7200000` | Time between retry attempts |

---

## Safety Mechanisms

### 1. Backup System
- All changes create `.backup-<fixId>` files
- Revert uses backups to restore original state
- Backups deleted after successful application

### 2. Test-First Approach
- If `testFirst: true`, tests MUST pass before applying
- Failed tests = fix not applied, pattern stays unfixed
- User can override by manually approving fix in System Coder

### 3. Risk Assessment
- Claude assigns risk level during fix generation
- Babysitter enforces `maxRisk` threshold
- High/critical always escalated to user

### 4. Blacklist
- Pattern matching on fix title and explanation
- Case-insensitive substring search
- Immediate escalation if match found

### 5. Cooldown & Retry Limits
- Prevents infinite fix loops
- Allows time for user intervention
- Max retries prevents resource exhaustion

### 6. Audit Logging
- All auto-heal attempts logged to audit trail
- Tracks: errorId, fixId, risk, outcome
- Actor: `babysitter-auto-heal`

---

## Monitoring & Visibility

### State Counters

```typescript
interface BabysitterState {
  errorsDetected: number;      // Total errors detected
  errorsAutoFixed: number;     // Successfully auto-healed
  errorsEscalated: number;     // Escalated to user (high risk)
  patternsDetected: number;    // Recurring patterns found
}
```

### Get Current State

```bash
# Via API (when implemented)
curl http://localhost:4321/api/babysitter/status

# Or check logs
grep "AUTO-HEALED" logs/run/big-brother-output.log
```

### Audit Trail

```bash
# Check audit logs for auto-heal events
grep "babysitter-auto-heal" logs/audit/$(date +%Y-%m-%d).ndjson | jq '.'
```

---

## Testing the Auto-Healer

### Simulated Test (when dev server running)

1. **Trigger recurring error** (manually or wait for real errors)
2. **Wait for pattern detection** (3+ occurrences in 1 hour)
3. **Watch babysitter logs**:
   ```bash
   tail -f logs/run/big-brother-output.log | grep babysitter
   ```
4. **Check System Coder fixes**:
   ```bash
   ls /media/greggles/STACK/metahuman-profiles/greggles/state/system-coder/fixes/
   ```
5. **Verify auto-approval**:
   ```bash
   cat /media/greggles/STACK/metahuman-profiles/greggles/state/system-coder/fixes/fix-*.json | jq '.approvedBy'
   # Should show: "babysitter-auto-heal"
   ```

---

## Next Steps: Phase 3

### Health Reporting (High Priority)

**Goal**: Periodic summaries of system health and auto-heal activity

**Features**:
- Hourly: Light summary (errors detected, fixed, escalated)
- Daily: Full report with top issues and trends
- Weekly: Deep analysis with recommendations

**Storage**: `logs/run/babysitter-reports/`

**Format**:
```json
{
  "timestamp": "2026-01-12T21:00:00Z",
  "period": "hourly",
  "summary": {
    "errorsDetected": 247,
    "errorsAutoFixed": 12,
    "errorsEscalated": 3,
    "patternsIdentified": 5,
    "autoHealSuccessRate": 0.80
  },
  "topIssues": [
    {
      "pattern": "[TTS Queue] Error: SyntaxError...",
      "count": 84,
      "status": "auto_fixed",
      "fixId": "fix-xyz"
    }
  ],
  "systemHealth": {
    "nodeServer": "ok",
    "agents": { "organizer": "ok", "reflector": "ok" },
    "bigBrother": "ok"
  }
}
```

### UI Dashboard (Medium Priority)

**Goal**: Real-time visibility into Babysitter activity

**Components**:
- Real-time log stream viewer
- Pattern detection dashboard
- Auto-heal history timeline
- Health metrics graphs
- Manual fix review queue

**Location**: New tab in RightSidebar → "Babysitter"

---

## Summary

### Phase 2 Achievements

✅ **AutoHealer class** - Complete self-healing implementation
✅ **Policy-based fixing** - Low + medium risk auto-apply
✅ **Test-first approach** - Runs tests before applying
✅ **Blacklist support** - Prevents dangerous auto-fixes
✅ **Cooldown & retries** - Prevents infinite loops
✅ **System Coder integration** - Seamless fix generation and application
✅ **Audit logging** - Full traceability
✅ **State tracking** - Counters for monitoring

### Impact

**Before Phase 2**:
- Errors detected but required manual fix generation
- No automatic remediation
- User must review and approve every fix

**After Phase 2**:
- Recurring errors automatically fixed
- Low/medium risk issues self-heal without user intervention
- High/critical risk escalated with fix pre-generated for review
- System health improves automatically over time

### Real-World Example

**TTS Queue Error** (from Phase 1 test):
- 84 occurrences in 3 minutes
- **Without Auto-Heal**: Requires manual investigation and fix
- **With Auto-Heal**:
  1. Pattern detected at 3rd occurrence
  2. Fix generated via Claude CLI
  3. Risk: low (auto-fixable)
  4. Tests passed (if configured)
  5. Fix auto-applied
  6. Error stops recurring
  7. **Total time**: ~2-5 minutes (vs. hours of manual work)

---

## Configuration Recommendations

### Conservative (Recommended for Start)

```json
{
  "maxRisk": "low",
  "testFirst": true,
  "maxRetries": 2
}
```

**Why**: Start cautious, build confidence

### Balanced (After 1 Week)

```json
{
  "maxRisk": "medium",
  "testFirst": true,
  "maxRetries": 3
}
```

**Why**: Proven safe, handle more issues automatically

### Aggressive (After 1 Month)

```json
{
  "maxRisk": "medium",
  "testFirst": false,
  "maxRetries": 5
}
```

**Why**: High confidence, maximum automation (still safe with blacklist)

---

## Phase 2 Complete! 🎉

The Babysitter now has **full self-healing capabilities**:
- Detects problems ✅
- Generates fixes ✅
- Tests fixes ✅
- Applies fixes ✅
- Tracks results ✅

**Ready for Phase 3**: Health Reporting & UI Dashboard
