# Agent Startup Issue - Path Context Requirements

**Date:** 2025-11-06
**Status:** 🔴 Blocking `pnpm dev`
**Severity:** High - Development workflow broken

---

## Problem Statement

The development server (`pnpm dev`) fails to start with:

```
Error: No user context available. Path access requires authentication. Attempted to access: paths.personaCore
ELIFECYCLE  Command failed with exit code 1.
```

## Root Cause Analysis

### What Changed
Recent security hardening (see `SECURITY_FIXES_2025-11-06.md`) made all user-specific paths require authenticated context:

```typescript
// packages/core/src/paths.ts (lines 124-143)
export const paths = new Proxy({...}, {
  get(target, prop: string) {
    const context = getUserContext();

    // System paths allowed
    if (prop in systemPaths) {
      return systemPaths[prop];
    }

    // SECURITY: Block anonymous users from user data paths
    if (context && context.username === 'anonymous') {
      throw new Error(`Access denied: Anonymous users cannot access user data paths`);
    }

    // Authenticated users get their profile paths
    if (context) {
      return context.profilePaths[prop];
    }

    // NO CONTEXT AT ALL - throw error
    throw new Error(`No user context available. Path access requires authentication.`);
  }
});
```

### Why It Breaks Agent Startup

1. **`pnpm dev`** runs `bin/run-with-agents` script
2. **`run-with-agents`** executes `./bin/mh start --restart` to launch background agents
3. **Agents run as standalone Node.js processes** (not web requests), so they have **no user context**
4. **Agents try to access user paths during module initialization**, triggering the error

### Confirmed Culprits

**Primary:** `brain/agents/morning-loader.ts` (line 9)
```typescript
const personaPath = paths.personaCore;  // ❌ Evaluated at module load, no context
```

**Likely others:**
- `brain/agents/reflector.ts`
- `brain/agents/organizer.ts`
- Any agent that accesses `paths.*` at module level

## What Works vs What Fails

✅ **`pnpm astro dev`** (direct) - Web UI works perfectly, authentication system functioning
❌ **`pnpm dev`** (with agents) - Crashes during agent initialization before Astro starts

## Solutions (In Order of Preference)

### Solution 1: Bootstrap Agents with Owner Context (Recommended)

**Location:** Modify agent launcher or each agent's entry point

**Implementation:**
```typescript
// In bin/mh (start command) or in each agent's main execution
import { withUserContext } from '@metahuman/core/context';
import { getUsers } from '@metahuman/core/users';

// Get the first owner user to run agents under
const users = getUsers();
const owner = users.find(u => u.role === 'owner');

if (!owner) {
  console.error('[agent] No owner user found. Run ./bin/mh user create first.');
  process.exit(1);
}

// Run agent with owner's context
await withUserContext(
  {
    userId: owner.id,
    username: owner.username,
    role: 'owner'
  },
  async () => {
    // Agent code runs here with full access to owner's paths
    const personaPath = paths.personaCore; // ✅ Now resolves correctly
    // ... rest of agent logic
  }
);
```

**Benefits:**
- Keeps security system intact
- Agents operate on real profile data
- Minimal changes to existing agent code
- Clear ownership model

### Solution 2: Lazy Path Resolution in Agents

**Location:** Modify each agent file

**Implementation:**
```typescript
// ❌ OLD (breaks)
const personaPath = paths.personaCore;

// ✅ NEW (lazy evaluation)
function getPersonaPath() {
  return paths.personaCore;
}

// Or use explicit profile paths
import { getProfilePaths } from '@metahuman/core/paths';

function getPersonaPath(username: string) {
  return getProfilePaths(username).personaCore;
}
```

**Benefits:**
- Explicit about which user's data to access
- Works with multi-user scenarios
- Agents can potentially process multiple users

**Drawbacks:**
- Requires modifying every agent
- More boilerplate code

### Solution 3: Development Mode Bypass (Quick Fix)

**Location:** `bin/run-with-agents`

**Implementation:**
```bash
#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "$#" -eq 0 ]; then
  echo "Usage: run-with-agents <command> [args...]" >&2
  exit 1
fi

cleanup() {
  "$REPO_ROOT/bin/mh" agent stop --all >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

# Skip agent startup in dev mode (temporary workaround)
if [ "${METAHUMAN_SKIP_AGENTS:-0}" != "1" ]; then
  "$REPO_ROOT/bin/mh" start --restart
  "$REPO_ROOT/bin/start-cloudflare" 2>/dev/null || true
fi

cd "$REPO_ROOT/apps/site"

"$@"
```

**Usage:**
```bash
METAHUMAN_SKIP_AGENTS=1 pnpm dev
```

**Benefits:**
- Immediate unblock for development
- No code changes needed
- Easy to toggle

**Drawbacks:**
- Doesn't fix the underlying issue
- Agents won't run during development
- Not suitable for production

---

## Files Requiring Changes

### High Priority (Blocking)
1. **`bin/mh`** (start command) - Add context bootstrap
2. **`brain/agents/morning-loader.ts`** - Line 9: `paths.personaCore` access
3. **`bin/run-with-agents`** - Add dev mode bypass option

### To Review
4. **`brain/agents/reflector.ts`** - Check for path access
5. **`brain/agents/organizer.ts`** - Check for path access
6. **`brain/agents/dreamer.ts`** - Check for path access
7. **`brain/agents/boredom-service.ts`** - Check for path access
8. **`brain/agents/sleep-service.ts`** - Check for path access
9. **`brain/agents/ingestor.ts`** - Check for path access

### Pattern to Search For
```bash
# Find all top-level const/let using paths.*
grep -rn "^const.*= .*paths\." brain/agents/
grep -rn "^let.*= .*paths\." brain/agents/
```

---

## Open Architecture Questions

### Multi-User Agent Behavior

**Question:** Should system agents run under:
- **Option A:** Single owner context (simpler, current assumption)
- **Option B:** Iterate over all users (owner + guests)
- **Option C:** One agent instance per user (isolation)

**Current Recommendation:** Start with **Option A** (single owner context) for v1, then add multi-user iteration in v2 when guest functionality is more developed.

**Rationale:**
- Most agents currently assume single-user operation
- Guest profiles may not want autonomous agents processing their data
- Owner can opt-in guests to agent processing later

### Agent vs Web Context

**Question:** Should agents use the same `withUserContext` mechanism as web requests?

**Answer:** Yes, but with different defaults:
- **Web requests:** Default to anonymous, require login
- **CLI/Agents:** Default to owner (if exists), fail if no owner

---

## Testing Plan

### Phase 1: Verify Fix
```bash
# 1. Apply Solution 1 (owner context bootstrap)
# 2. Test agent startup
./bin/mh start --restart

# 3. Test full dev workflow
pnpm dev

# 4. Verify agents are running
./bin/mh agent ps
```

### Phase 2: Verify Web UI Still Works
```bash
# 1. Navigate to http://localhost:4321/
# 2. Verify AuthGate displays
# 3. Try "Continue as Guest" - should be blocked from user data
# 4. Create new user account
# 5. Verify login works
# 6. Verify user data is accessible after login
```

### Phase 3: Multi-User Testing (Future)
```bash
# 1. Create owner + guest accounts
# 2. Verify agents only process owner's data
# 3. Add guest opt-in mechanism
# 4. Verify agents can process multiple users
```

---

## Related Documentation

- **`SECURITY_FIXES_2025-11-06.md`** - Security changes that introduced this issue
- **`USER_REGISTRATION_WORKFLOW.md`** - Complete registration feature docs
- **`docs/MULTI_USER_PLAN.md`** - Multi-user architecture plan

---

## Previous Fixes (Already Complete)

We already fixed 5+ core modules with the same pattern:

✅ **`packages/core/src/cognitive-mode.ts`** - Converted `MODE_CONFIG_PATH` to `getModeConfigPath()`
✅ **`packages/core/src/state.ts`** - Converted `PERSONA_CACHE_PATH` to `getPersonaCachePath()`
✅ **`packages/core/src/users.ts`** - Converted to use `paths.usersDb` (system path)
✅ **`packages/core/src/sessions.ts`** - Converted to use `paths.sessionsFile` (system path)
✅ **`packages/core/src/agent-scheduler.ts`** - Converted `configPath` to getter method
✅ **`packages/core/package.json`** - Added `"./context"` export

**These fixes resolved module initialization errors for web requests but did not address standalone agent processes.**

---

## Recommended Next Steps

1. **Immediate:** Implement Solution 3 (dev mode bypass) to unblock development
   ```bash
   # Add to .env or shell config
   export METAHUMAN_SKIP_AGENTS=1
   ```

2. **Short-term:** Implement Solution 1 (owner context bootstrap) in `bin/mh start` command
   - Look for where agents are spawned
   - Wrap execution with `withUserContext`
   - Use first owner user as context

3. **Medium-term:** Audit all agents for module-level path access and convert to lazy evaluation

4. **Long-term:** Design multi-user agent architecture (owner + guest processing)

---

## Notes for Next Agent

- **Web UI is fully functional** when accessed via `pnpm astro dev`
- **Security system is working correctly** - anonymous blocking is intentional
- **Only agent startup is broken** - this is a clean isolation of the issue
- **Owner context is the right approach** - agents should operate on user data explicitly
- **The path proxy is doing its job** - catching unauthorized access as designed

Good luck! 🚀


## QUICK FIX - Use Astro Directly (No Agents)

Until the CLI context issue is resolved, you can run the web UI without agents:

```bash
cd apps/site && pnpm astro dev
```

This bypasses agent startup and the web UI works perfectly.

