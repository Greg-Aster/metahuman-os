# Phase 6: Multi-User Testing Plan

**Status:** Ready for Testing
**Last Updated:** 2025-11-06

---

## Overview

This document outlines the testing strategy for validating Phase 5 (Multi-User Agents) and preparing for migration to the multi-user profile system.

## Test Categories

### 1. Agent Compilation & Syntax ✅

**Objective:** Verify all agent files are syntactically correct and import properly.

**Files to Validate:**
- `brain/agents/organizer.ts`
- `brain/agents/reflector.ts`
- `brain/agents/dreamer.ts`
- `brain/agents/ingestor.ts`
- `brain/agents/boredom-service.ts`
- `brain/agents/sleep-service.ts`

**Method:**
```bash
# Test syntax with tsx (TypeScript executor)
tsx brain/agents/organizer.ts --help 2>&1 | head -5
tsx brain/agents/reflector.ts 2>&1 | head -5
tsx brain/agents/dreamer.ts 2>&1 | head -5
tsx brain/agents/ingestor.ts 2>&1 | head -5
```

**Expected Result:** No import errors, agents should initialize (may exit due to locks or config).

---

### 2. Multi-User Context Resolution

**Objective:** Verify that agents properly iterate through users and resolve paths correctly.

**Test Scenario:**
1. Create two test user profiles
2. Add unprocessed memories to each user's episodic directory
3. Run organizer agent
4. Verify both users' memories are processed

**Setup:**
```bash
# Create test users (via API or users.json)
# User 1: alice
# User 2: bob

# Create test memories
mkdir -p profiles/alice/memory/episodic/2025
mkdir -p profiles/bob/memory/episodic/2025

# Add unprocessed memories
cat > profiles/alice/memory/episodic/2025/evt-20251106120000-test.json <<'EOF'
{
  "id": "evt-20251106120000-test",
  "timestamp": "2025-11-06T12:00:00.000Z",
  "content": "Alice's test memory for multi-user processing",
  "metadata": {
    "processed": false
  }
}
EOF

cat > profiles/bob/memory/episodic/2025/evt-20251106120001-test.json <<'EOF'
{
  "id": "evt-20251106120001-test",
  "timestamp": "2025-11-06T12:00:01.000Z",
  "content": "Bob's test memory for multi-user processing",
  "metadata": {
    "processed": false
  }
}
EOF
```

**Execution:**
```bash
# Run organizer agent (requires Ollama running)
tsx brain/agents/organizer.ts
```

**Expected Output:**
```
[Organizer] Found 2 users to process
[Organizer] Processing user: alice
[Organizer]   Found 1 memories to process
[Organizer]   Completed alice ✅
[Organizer] Processing user: bob
[Organizer]   Found 1 memories to process
[Organizer]   Completed bob ✅
[Organizer] Cycle finished. Processed 2 memories across 2 users. ✅
```

**Validation:**
```bash
# Check that both memories were processed
jq '.metadata.processed' profiles/alice/memory/episodic/2025/evt-20251106120000-test.json
# Should output: true

jq '.metadata.processed' profiles/bob/memory/episodic/2025/evt-20251106120001-test.json
# Should output: true
```

---

### 3. Context Isolation & No Data Leakage

**Objective:** Verify that user contexts don't leak between iterations.

**Test Scenario:**
1. Create two users with different profile content
2. Run reflector agent
3. Verify each user's reflection only references their own memories

**Setup:**
```bash
# Add distinct memories to each user
# Alice: memories about "project Alpha"
# Bob: memories about "project Beta"

cat > profiles/alice/memory/episodic/2025/evt-20251106130000-alice-project.json <<'EOF'
{
  "id": "evt-20251106130000-alice-project",
  "timestamp": "2025-11-06T13:00:00.000Z",
  "content": "Working on project Alpha today, made great progress on the authentication system",
  "tags": ["work", "project-alpha"],
  "metadata": { "processed": true }
}
EOF

cat > profiles/bob/memory/episodic/2025/evt-20251106130001-bob-project.json <<'EOF'
{
  "id": "evt-20251106130001-bob-project",
  "timestamp": "2025-11-06T13:00:01.000Z",
  "content": "Project Beta is coming along nicely, the database schema is finalized",
  "tags": ["work", "project-beta"],
  "metadata": { "processed": true }
}
EOF
```

**Execution:**
```bash
# Run reflector agent
tsx brain/agents/reflector.ts
```

**Validation:**
```bash
# Check Alice's reflection
grep -l "Alpha" profiles/alice/memory/episodic/2025/*.json | tail -1 | xargs cat
# Should contain: "Alpha", should NOT contain: "Beta"

# Check Bob's reflection
grep -l "Beta" profiles/bob/memory/episodic/2025/*.json | tail -1 | xargs cat
# Should contain: "Beta", should NOT contain: "Alpha"
```

---

### 4. Error Handling & Fault Tolerance

**Objective:** Verify that failures in one user don't affect other users.

**Test Scenario:**
1. Create three users: alice, bob, charlie
2. Corrupt charlie's episodic directory (invalid JSON)
3. Run organizer agent
4. Verify alice and bob are still processed successfully

**Setup:**
```bash
# Create invalid JSON in charlie's directory
mkdir -p profiles/charlie/memory/episodic/2025
echo "INVALID JSON{{{" > profiles/charlie/memory/episodic/2025/evt-20251106140000-invalid.json

# Add valid memories for alice and bob
cat > profiles/alice/memory/episodic/2025/evt-20251106140001-valid.json <<'EOF'
{
  "id": "evt-20251106140001-valid",
  "timestamp": "2025-11-06T14:00:01.000Z",
  "content": "Alice's memory after error scenario",
  "metadata": { "processed": false }
}
EOF

cat > profiles/bob/memory/episodic/2025/evt-20251106140002-valid.json <<'EOF'
{
  "id": "evt-20251106140002-valid",
  "timestamp": "2025-11-06T14:00:02.000Z",
  "content": "Bob's memory after error scenario",
  "metadata": { "processed": false }
}
EOF
```

**Execution:**
```bash
tsx brain/agents/organizer.ts 2>&1 | tee /tmp/organizer-error-test.log
```

**Validation:**
```bash
# Should see error for charlie but alice and bob still processed
grep "Failed to process user charlie" /tmp/organizer-error-test.log
grep "Completed alice ✅" /tmp/organizer-error-test.log
grep "Completed bob ✅" /tmp/organizer-error-test.log

# Check alice and bob memories were processed
jq '.metadata.processed' profiles/alice/memory/episodic/2025/evt-20251106140001-valid.json
# Should output: true

jq '.metadata.processed' profiles/bob/memory/episodic/2025/evt-20251106140002-valid.json
# Should output: true
```

---

### 5. Audit Trail Verification

**Objective:** Verify audit logs correctly track multi-user operations.

**Test Scenario:**
1. Run organizer agent with multiple users
2. Check audit logs for proper tracking

**Execution:**
```bash
# Run organizer
tsx brain/agents/organizer.ts

# Check today's audit log
today=$(date +%Y-%m-%d)
cat logs/audit/$today.ndjson | tail -20
```

**Validation:**
```bash
# Should see system-level events
grep '"event":"agent_cycle_started"' logs/audit/$today.ndjson | jq '.details'
# Should contain: { "agent": "organizer", "mode": "multi-user" }

grep '"event":"agent_cycle_completed"' logs/audit/$today.ndjson | jq '.details'
# Should contain: { "agent": "organizer", "mode": "multi-user", "totalProcessed": N, "userCount": N }

# Should see per-user operations (with userId in context)
grep '"skill":"organizer:analyze"' logs/audit/$today.ndjson | jq '.userId'
# Should output user IDs for each operation
```

---

### 6. Dreamer Agent Multi-User Test

**Objective:** Verify dreamer generates dreams for multiple users.

**Test Scenario:**
1. Create two users with sufficient memories (7+ days of data)
2. Run dreamer agent
3. Verify dreams generated for both users

**Setup:**
```bash
# Create memories spanning 7 days for alice
for i in {0..6}; do
  date=$(date -d "$i days ago" +%Y-%m-%d)
  year=$(date -d "$i days ago" +%Y)
  mkdir -p profiles/alice/memory/episodic/$year

  cat > profiles/alice/memory/episodic/$year/evt-${date//-/}120000-dream-test.json <<EOF
{
  "id": "evt-${date//-/}120000-dream-test",
  "timestamp": "${date}T12:00:00.000Z",
  "content": "Alice's memory from $date - day $i of test data",
  "tags": ["test", "multi-user"],
  "metadata": { "processed": true }
}
EOF
done

# Same for bob
for i in {0..6}; do
  date=$(date -d "$i days ago" +%Y-%m-%d)
  year=$(date -d "$i days ago" +%Y)
  mkdir -p profiles/bob/memory/episodic/$year

  cat > profiles/bob/memory/episodic/$year/evt-${date//-/}130000-dream-test.json <<EOF
{
  "id": "evt-${date//-/}130000-dream-test",
  "timestamp": "${date}T13:00:00.000Z",
  "content": "Bob's memory from $date - day $i of test data",
  "tags": ["test", "multi-user"],
  "metadata": { "processed": true }
}
EOF
done
```

**Execution:**
```bash
# Run dreamer (requires Ollama running)
tsx brain/agents/dreamer.ts 2>&1 | tee /tmp/dreamer-test.log
```

**Expected Output:**
```
[dreamer] Found 2 users to process
[dreamer] Processing user: alice
[dreamer]   Dream 1/N generated for alice
[dreamer]   Completed alice ✅
[dreamer] Processing user: bob
[dreamer]   Dream 1/N generated for bob
[dreamer]   Completed bob ✅
[dreamer] Cycle finished. Generated N dreams across 2 users. ✅
```

**Validation:**
```bash
# Check dreams were created
find profiles/alice/memory/episodic -name "*.json" -exec jq -r 'select(.metadata.type == "dream") | .id' {} \; | head -1
# Should output a dream ID

find profiles/bob/memory/episodic -name "*.json" -exec jq -r 'select(.metadata.type == "dream") | .id' {} \; | head -1
# Should output a dream ID

# Check overnight learnings
ls profiles/alice/memory/procedural/overnight/
ls profiles/bob/memory/procedural/overnight/
# Should show overnight-learnings-*.md files
```

---

### 7. Ingestor Agent Multi-User Test

**Objective:** Verify ingestor processes inbox files for multiple users.

**Test Scenario:**
1. Add files to alice and bob's inbox
2. Run ingestor agent
3. Verify both inboxes processed

**Setup:**
```bash
# Create inbox files
mkdir -p profiles/alice/memory/inbox
mkdir -p profiles/bob/memory/inbox

echo "Alice's inbox document about team meeting" > profiles/alice/memory/inbox/alice-meeting-notes.txt
echo "Bob's inbox document about project planning" > profiles/bob/memory/inbox/bob-planning-doc.txt
```

**Execution:**
```bash
tsx brain/agents/ingestor.ts 2>&1 | tee /tmp/ingestor-test.log
```

**Expected Output:**
```
[ingestor] Found 2 users to process
[ingestor] Processing user: alice
[ingestor]   Found 1 file(s) to ingest
[ingestor]   ✓ Ingested: alice-meeting-notes.txt
[ingestor]   Completed alice ✅
[ingestor] Processing user: bob
[ingestor]   Found 1 file(s) to ingest
[ingestor]   ✓ Ingested: bob-planning-doc.txt
[ingestor]   Completed bob ✅
[ingestor] Cycle finished. Processed 2 files across 2 users. ✅
```

**Validation:**
```bash
# Check files moved to archive
today=$(date +%Y-%m-%d)
ls profiles/alice/memory/inbox/_archive/$today/
# Should show: alice-meeting-notes.txt

ls profiles/bob/memory/inbox/_archive/$today/
# Should show: bob-planning-doc.txt

# Check episodic memories created
grep -r "team meeting" profiles/alice/memory/episodic/
grep -r "project planning" profiles/bob/memory/episodic/
```

---

## Testing Prerequisites

### Required Services
- ✅ Ollama running (`ollama serve`)
- ✅ Model pulled (`ollama pull phi3:mini` or configured model)

### Required Setup
- ✅ At least 2 test user profiles created
- ✅ `persona/users.json` contains test users
- ✅ No stale lock files in `logs/run/locks/`

### Clean State
```bash
# Clear any stale locks
rm -f logs/run/locks/agent-*

# Check Ollama status
curl -s http://localhost:11434/api/version
```

---

## Test Execution Checklist

### Pre-Test Setup
- [ ] Backup current data
- [ ] Create test user profiles (alice, bob)
- [ ] Verify Ollama is running
- [ ] Clear stale agent locks

### Agent Tests
- [ ] Test 1: Agent Compilation & Syntax
- [ ] Test 2: Multi-User Context Resolution (organizer)
- [ ] Test 3: Context Isolation & No Data Leakage (reflector)
- [ ] Test 4: Error Handling & Fault Tolerance
- [ ] Test 5: Audit Trail Verification
- [ ] Test 6: Dreamer Agent Multi-User Test
- [ ] Test 7: Ingestor Agent Multi-User Test

### Post-Test Validation
- [ ] Review audit logs for completeness
- [ ] Verify no data leakage between users
- [ ] Check all agents completed successfully
- [ ] Document any issues or failures

---

## Known Limitations

1. **Sequential Processing** - Agents process users one at a time (by design)
2. **Shared Resources** - LLM API (Ollama) is shared across all users
3. **Lock Contention** - Only one instance of each agent can run at a time
4. **Memory Requirements** - More users = more memory/processing time

---

## Success Criteria

**Phase 6 Testing Complete When:**

✅ All 7 test scenarios pass
✅ No data leakage between users
✅ Error handling works (one user's failure doesn't affect others)
✅ Audit logs correctly track multi-user operations
✅ All 6 agents successfully process multiple users
✅ Documentation updated with test results

---

## Next Steps After Testing

1. **Phase 7**: Run migration script (dry-run first)
2. **Phase 8**: Update UI for multi-user display
3. **Phase 9**: Add CLI --user flag support
4. **Phase 10**: Performance optimization and monitoring

---

## Quick Test Commands

```bash
# Quick validation - run all agents with 2 test users
./tests/run-agent-multi-user-tests.sh

# Or manually:
tsx brain/agents/organizer.ts
tsx brain/agents/reflector.ts
tsx brain/agents/dreamer.ts
tsx brain/agents/ingestor.ts

# Check results
find profiles/*/memory/episodic -name "*.json" | wc -l
grep "multi-user" logs/audit/$(date +%Y-%m-%d).ndjson | wc -l
```
