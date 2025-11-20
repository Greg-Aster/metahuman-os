# Authentication Migration Testing Guide

**Status**: Post-Migration Verification
**Date**: 2025-11-20
**Migration**: Explicit Cookie-Based Authentication

## Quick Audit Log Verification ✅

Recent audit log entries show the migration is working:

```bash
$ grep -E '"actor":"(web_ui|greggles|human|user)"' logs/audit/2025-11-20.ndjson | tail -10
```

**Results**:
- ✅ Seeing "greggles" as actor (real username) instead of generic "web_ui"
- ⚠️ Some entries still use "user" or "human" (legacy placeholders in specific endpoints)
- ✅ Agent entries correctly show "organizer", "scheduler-service", etc.

## Test Plan: End-to-End Authentication Flow

### 1. Anonymous User Tests

**Test 1.1: Public Read Endpoints**
```bash
# Clear cookies and access public endpoint
curl -c /tmp/cookies.txt http://localhost:4321/api/boot

# Expected: 200 OK with default/empty data
# Verify: No authentication error
```

**Test 1.2: Protected Endpoints (Should Fail)**
```bash
# Try to capture memory without authentication
curl -X POST http://localhost:4321/api/capture \
  -H "Content-Type: application/json" \
  -d '{"text": "Test memory"}'

# Expected: 401 Unauthorized
# Response: {"error": "Authentication required"}
```

**Test 1.3: Write Endpoints (Should Fail)**
```bash
# Try to modify persona without authentication
curl -X POST http://localhost:4321/api/persona-core-manage \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'

# Expected: 401 Unauthorized
```

### 2. Authenticated User Tests

**Test 2.1: Login and Get Session**
```bash
# Create dev session (development only)
pnpm tsx scripts/dev-session.ts --username=greggles

# Copy session ID and set in browser:
# DevTools → Application → Cookies → http://localhost:4321
# Add: mh_session = <session-id>
```

**Test 2.2: Protected Read Endpoints**
```bash
# Access personal memories (requires auth)
curl -b /tmp/cookies.txt http://localhost:4321/api/memories

# Expected: 200 OK with user-specific data
# Verify: Returns actual memories, not empty defaults
```

**Test 2.3: Write Endpoints**
```bash
# Capture new memory
curl -X POST http://localhost:4321/api/capture \
  -b /tmp/cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"text": "Test authentication flow", "type": "observation"}'

# Expected: 200 OK
# Verify audit log: Should show "greggles" as actor, not "web_ui"
```

**Test 2.4: Verify Audit Logging**
```bash
# Check most recent capture event
tail -1 logs/audit/$(date +%Y-%m-%d).ndjson | jq '.actor'

# Expected: "greggles" (or actual username)
# NOT: "web_ui", "human", or "user"
```

### 3. Security Guard Tests

**Test 3.1: Emulation Mode (requireWriteMode)**
```bash
# Switch to emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -b /tmp/cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"mode": "emulation"}'

# Try to write in emulation mode (should fail)
curl -X POST http://localhost:4321/api/capture \
  -b /tmp/cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"text": "This should be blocked"}'

# Expected: 403 Forbidden
# Message: "Write operations blocked in emulation mode"
```

**Test 3.2: Owner-Only Operations (requireOwner)**
```bash
# Try to change trust level (owner-only)
curl -X POST http://localhost:4321/api/trust \
  -b /tmp/cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"level": "bounded_auto"}'

# Expected: 200 OK if user.role === 'owner'
# Expected: 403 Forbidden if user.role !== 'owner'
```

**Test 3.3: Operator Mode (requireOperatorMode)**
```bash
# Try to use ReAct operator
curl -X POST http://localhost:4321/api/operator/react \
  -b /tmp/cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"goal": "List my tasks"}'

# Expected: 200 OK in dual/agent mode (owner only)
# Expected: 403 Forbidden in emulation mode or for non-owners
```

### 4. Web UI Integration Tests

**Manual UI Tests**:

1. **Login Flow**:
   - Open http://localhost:4321
   - No session → Should see anonymous/guest view
   - Log in → Should see personal data

2. **Chat Interface**:
   - Send message → Check audit log for username
   - Capture memory → Verify actor is username
   - Switch cognitive mode → Verify permission checks

3. **Settings/Config**:
   - Access settings → Should work for owner
   - Try changing trust level → Owner-only check
   - Switch to emulation → Write operations blocked

4. **Memory Browser**:
   - View memories → User-specific data shown
   - Edit memory → Audit log shows username
   - Anonymous user → Returns defaults/empty

### 5. Audit Log Verification

**Check for Real Usernames**:
```bash
# Find recent API actions
grep -E '"category":"(action|data_change)"' logs/audit/$(date +%Y-%m-%d).ndjson | \
  jq -r '"\(.timestamp) | \(.event) | \(.actor)"' | \
  tail -20

# Expected: Real usernames (greggles, etc.)
# Avoid: Generic "web_ui", "human", "user"
```

**Identify Remaining Generic Actors**:
```bash
# Find endpoints still using generic actors
grep -E '"actor":"(web_ui|human|user)"' logs/audit/$(date +%Y-%m-%d).ndjson | \
  jq -r '.event' | sort | uniq -c | sort -rn

# Review: Which events still use generic actors?
# Fix: Update those endpoints to use actual username
```

## Known Issues & Limitations

### ✅ Fully Migrated
- All export wrappers removed
- Security guards preserved
- Explicit authentication in ~74 endpoints

### ⚠️ Partial Migration
**2 files still use `withUserContext` internally** (not export wrappers):
1. `apps/site/src/pages/api/conversation/summarize.ts`
   - Uses `withUserContext(activeUserId, async () => {...})` to run summarizer agent
   - Migration would require passing user context through agent call chain

2. `apps/site/src/pages/api/persona_chat.ts`
   - Uses `withUserContext({ userId, username, role }, () => handleChatRequest(...))`
   - Wraps multi-step chat handler that accesses paths internally

**Impact**: Minimal - these are internal utility usages, not the problematic export wrapper pattern.

### Generic Actor Placeholders

Some endpoints may still use generic actors:
- `"actor": "user"` - conversation-buffer.ts (line 232)
- `"actor": "human"` - Some function management endpoints

**Fix**: Update these to use `user.username` from authentication.

## Regression Testing Checklist

- [ ] Anonymous users can access public data
- [ ] Anonymous users blocked from protected endpoints (401)
- [ ] Authenticated users can access personal data
- [ ] Authenticated users can write data
- [ ] Audit logs show real usernames
- [ ] Emulation mode blocks writes (requireWriteMode)
- [ ] Non-owners blocked from owner operations (requireOwner)
- [ ] Operator blocked in emulation mode (requireOperatorMode)
- [ ] No circular dependency errors on startup
- [ ] Web UI login/logout works correctly

## Performance Impact

**Before Migration**:
- AsyncLocalStorage overhead on every request
- Circular dependency resolution complexity

**After Migration**:
- Direct cookie access (faster)
- No AsyncLocalStorage overhead
- Cleaner dependency graph

**Expected**: Slight performance improvement, especially under high load.

## Rollback Plan (If Needed)

1. Revert CLAUDE.md authentication section
2. Revert deprecated marker on middleware/userContext.ts
3. Git revert individual endpoint migrations
4. Restore `withUserContext` export wrappers

**Note**: Full rollback would require reverting ~74 files. Git history contains all original versions.

## Next Steps

1. **Run Manual Tests**: Follow test plan above
2. **Monitor Production**: Watch for auth-related errors
3. **Fix Generic Actors**: Update remaining "user"/"human" actors to actual usernames
4. **Optional**: Migrate internal withUserContext usage in conversation/summarize.ts and persona_chat.ts
5. **Document Findings**: Update this guide with test results

## Success Criteria

✅ All tests pass
✅ Audit logs show real usernames
✅ No authentication errors in normal usage
✅ Security guards work as expected
✅ No circular dependency warnings
