# Phase 1: Foundation - COMPLETE ✅

**Completion Date:** 2025-11-06

## Summary

Successfully implemented the foundational infrastructure for the multi-user profile system. All core components are in place and backward compatible with existing single-user installations.

## Files Created

### 1. Context Management
**File:** `packages/core/src/context.ts`

**Purpose:** Thread-safe user context management using AsyncLocalStorage

**Key Functions:**
- `withUserContext()` - **RECOMMENDED** - Automatic context isolation and cleanup
- `setUserContext()` / `clearUserContext()` - Deprecated but available for backward compatibility
- `getUserContext()` - Retrieve current user context
- `hasUserContext()` - Check if context is active

**Why Important:** Enables multiple users to operate concurrently without context leakage between async operations.

### 2. Path Resolution System
**File:** `packages/core/src/paths.ts` (Updated)

**Additions:**
- `getProfilePaths(username)` - Returns paths for specific user profile
- `systemPaths` - System-level paths that never change (brain/, packages/, apps/, bin/, logs/run/)
- `paths` - Proxy that automatically resolves to user-specific or root paths based on context

**Why Important:** Existing code using `paths.episodic` continues to work unchanged, but now automatically resolves to the correct user's profile when context is set.

### 3. Configuration Helper
**File:** `packages/core/src/config.ts`

**Purpose:** Load and save user-specific configuration files

**Key Functions:**
- `loadUserConfig(filename, defaultValue)` - Load config from user's etc/ directory
- `saveUserConfig(filename, data)` - Save config to user's etc/ directory
- `userConfigExists(filename)` - Check if config file exists
- `listUserConfigs()` - List all config files for current user

**Why Important:** Each user can have different base models, training settings, sleep schedules, etc.

### 4. API Middleware
**File:** `apps/site/src/middleware/userContext.ts`

**Purpose:** Automatically wrap API route handlers with user context

**Usage:**
```typescript
import { withUserContext } from '../../middleware/userContext';

const handler: APIRoute = async (context) => {
  // paths.episodic automatically resolves to user's profile
  const memories = await loadMemories();
  return new Response(JSON.stringify(memories));
};

export const GET = withUserContext(handler);
```

**Why Important:** One-line middleware application ensures all API operations use correct user context.

### 5. Profile Directory Structure
**Created:** `profiles/.keep`

**Purpose:** Placeholder for user profile directories

**Structure:**
```
profiles/
└── {username}/
    ├── memory/
    ├── persona/
    ├── out/
    ├── logs/
    └── etc/
```

### 6. Migration Script
**File:** `scripts/migrate-to-profiles.ts` (Executable)

**Purpose:** Migrate existing single-user data to first profile

**Features:**
- Creates backup before migration
- Preserves critical root files (persona/users.json, logs/run/)
- Moves config files before persona directory (prevents issues)
- Supports `--dry-run` flag to preview changes
- Comprehensive error handling and logging

**Usage:**
```bash
# Preview changes
pnpm tsx scripts/migrate-to-profiles.ts --username greggles --dry-run

# Run migration
pnpm tsx scripts/migrate-to-profiles.ts --username greggles
```

**IMPORTANT:** Do not run yet! Wait for Phase 2 exports.

## Architecture Highlights

### Context-Aware Path Resolution

**Without Context (Backward Compatible):**
```typescript
import { paths } from '@metahuman/core/paths';
console.log(paths.episodic);
// → /home/greggles/metahuman/memory/episodic
```

**With Context (Multi-User):**
```typescript
import { paths, withUserContext } from '@metahuman/core';

await withUserContext(
  { userId: '123', username: 'alice', role: 'owner' },
  () => {
    console.log(paths.episodic);
    // → /home/greggles/metahuman/profiles/alice/memory/episodic
  }
);
```

### System vs User Paths

**System Paths (Always Root):**
- `systemPaths.brain` - Agent code
- `systemPaths.packages` - Core libraries
- `systemPaths.apps` - Web UI code
- `systemPaths.bin` - CLI scripts
- `systemPaths.run` - System PIDs, locks, sessions
- `systemPaths.usersDb` - Authentication database (persona/users.json)

**User Paths (Context-Dependent):**
- `paths.episodic` - User's memories
- `paths.persona` - User's identity files
- `paths.out` - User's LoRA adapters and outputs
- `paths.etc` - User's configuration files
- `paths.logs` - User's audit trail

## Security Features

### Administrator Privileges (Already Implemented in Previous Session)

**Configuration:** `.env` file
```bash
ADMIN_USERS=greggles,alice
```

**Capabilities:**
- ✅ Edit system code (brain/, packages/, apps/, bin/)
- ✅ Access all user profiles
- ✅ Modify root-level configuration
- ✅ Execute dangerous operations

**Regular User Restrictions:**
- ❌ Cannot edit system code
- ❌ Cannot access other users' profiles
- ✅ Can only edit files within `profiles/{username}/`

**API Enforcement:**
```typescript
const policy = getSecurityPolicy(context);
policy.requireFileAccess(filePath); // Throws SecurityError if unauthorized
```

## Testing Performed

1. ✅ TypeScript compilation of new files (minor pre-existing errors in codebase, not from our changes)
2. ✅ Import syntax matches codebase patterns (fixed `import * as` for fs/path)
3. ✅ Migration script syntax validated
4. ✅ Directory structure created successfully

## Backward Compatibility

**Key Principle:** Existing code continues to work without modifications

- ✅ `paths.episodic` still works for single-user installations
- ✅ No context = falls back to root paths
- ✅ `setUserContext()` / `clearUserContext()` still available (deprecated)
- ✅ Migration is opt-in via script execution

## Known Limitations

1. **Not Yet Exported:** Context/config helpers need to be exported from `@metahuman/core/index.ts` (Phase 2)
2. **Agents Not Updated:** Still process single user (will be updated in Phase 5)
3. **API Routes Not Updated:** Need to apply `withUserContext` middleware (Phase 4)
4. **CLI Not Updated:** No `--user` flag yet (Phase 6)

## Next Steps: Phase 2

**Goal:** Export new modules from @metahuman/core package

**Tasks:**
1. Update `packages/core/src/index.ts` to export context, config helpers
2. Verify imports work correctly from other packages
3. Test that existing code still compiles
4. Document public API in package README

**Why Important:** Makes the new infrastructure available to agents, API routes, and CLI commands.

---

## Developer Notes

### Using withUserContext (RECOMMENDED)

```typescript
import { withUserContext } from '@metahuman/core/context';
import { listUsers } from '@metahuman/core/users';

// In agents
async function runCycle() {
  const users = listUsers();

  for (const user of users) {
    await withUserContext(
      { userId: user.id, username: user.username, role: user.role },
      async () => {
        // All path operations use user's profile
        const memories = findUnprocessedMemories();
        await processMemories(memories);
      }
    );
    // Context automatically cleaned up - no leakage to next user
  }
}
```

### Using Middleware (API Routes)

```typescript
import { withUserContext } from '../../middleware/userContext';

const handler: APIRoute = async (context) => {
  // User context automatically set from session cookie
  // paths.* resolve to authenticated user's profile
  return new Response(JSON.stringify({ status: 'ok' }));
};

export const GET = withUserContext(handler);
```

### Loading User Config

```typescript
import { loadUserConfig } from '@metahuman/core/config';

// Context must be set first!
const modelConfig = loadUserConfig('models.json', {
  baseModel: 'qwen3-coder:30b',
  activeAdapter: null
});

// Each user can have different base models!
```

---

**Status:** ✅ Phase 1 Complete - Ready for Phase 2
