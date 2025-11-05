# Phase 3 Manual Integration Test

## Testing Skills Policy Enforcement

### Prerequisites
1. Start the dev server: `cd apps/site && pnpm dev`
2. Ensure system is in dual mode initially

### Test 1: Verify Operator Works in Dual Mode

**Setup:**
```bash
# Set to dual mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'
```

**Test:** Try to write a file to memory via operator
```bash
curl -X POST http://localhost:4321/api/operator \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Create a test file at memory/episodic/test-operator-dual.json with content {\"test\": \"dual mode\"}",
    "autoApprove": true
  }'
```

**Expected Result:**
- ✓ Request succeeds
- ✓ File is created at `memory/episodic/test-operator-dual.json`
- ✓ Audit log shows successful skill execution

### Test 2: Verify Operator Blocked in Emulation Mode

**Setup:**
```bash
# Switch to emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'
```

**Test:** Try to write a file to memory via operator
```bash
curl -X POST http://localhost:4321/api/operator \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Create a test file at memory/episodic/test-operator-emulation.json with content {\"test\": \"emulation mode\"}",
    "autoApprove": true
  }'
```

**Expected Result:**
- ✓ Operator API request is blocked with 403 status
- ✓ Error message: "Operator access not allowed in emulation mode"
- ✓ File is NOT created
- ✓ Audit log shows `operator_attempt_blocked` event

### Test 3: Verify Skills Block Memory Writes in Emulation

This test verifies the skill-level enforcement (defense in depth).

**Test:** Simulate a skill execution with emulation policy
```typescript
// This would require direct code execution, not via API
const policy = getSecurityPolicy(); // In emulation mode
const result = await executeSkill(
  'fs_write',
  { path: 'memory/episodic/test.json', content: '{}', overwrite: true },
  'supervised_auto',
  true,
  policy
);
// Should fail with: "Memory writes not allowed in emulation mode"
```

**Expected Result:**
- ✓ Skill execution fails
- ✓ Error message mentions policy/mode restriction
- ✓ Audit log shows `skill_execution_blocked_by_policy` event
- ✓ File is NOT created

### Test 4: Verify Non-Memory Writes Still Work in Emulation

**Test:** Try to write to out/ directory via operator in emulation mode
```bash
# (Still in emulation mode from Test 2)
curl -X POST http://localhost:4321/api/operator \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Create a test file at out/test-operator-emulation.txt with content \"This should work\"",
    "autoApprove": true
  }'
```

**Expected Result:**
- ✓ Operator API request is still blocked (because operator itself is blocked in emulation)
- If we were to test skills directly, out/ writes should succeed

### Test 5: Check Audit Logs

**View recent security events:**
```bash
tail -50 logs/audit/$(date +%Y-%m-%d).ndjson | grep -E "operator|skill.*block|policy" | jq '.'
```

**Expected Audit Events:**
1. `cognitive_mode_change` - Mode switched to emulation
2. `operator_attempt_blocked` - Operator API blocked in emulation
3. `skill_execution_blocked_by_policy` - If skills were called directly
4. Security warnings for any policy violations

### Cleanup

**Restore to dual mode:**
```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'
```

**Remove test files:**
```bash
rm -f memory/episodic/test-operator-*.json
rm -f out/test-operator-*.txt
```

## Summary

Phase 3 implements **two layers of security**:

1. **HTTP Layer** (`/api/operator` endpoint)
   - Blocks operator access entirely in emulation mode
   - Uses `requireOperatorMode()` middleware
   - Returns 403 before any skill execution

2. **Execution Layer** (`executeSkill()` in skills.ts)
   - Checks policy before running skills
   - Blocks memory writes if `policy.canWriteMemory === false`
   - Provides defense-in-depth protection

Both layers log security events to the audit trail for complete visibility.
