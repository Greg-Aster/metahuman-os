# Phase 3 Migration Instructions

**Goal**: Migrate remaining read-only and read-heavy endpoints from implicit AsyncLocalStorage context to explicit authentication pattern.

**Status**: Batch 1 complete (6 files). Batches 2-3 remaining (~20 files).

---

## Quick Reference

### Migration Pattern

**Before**:
```typescript
import { withUserContext } from '../../middleware/userContext';
import { getUserContext } from '@metahuman/core/context';
import { paths } from '@metahuman/core/paths';

const handler: APIRoute = async () => {
  const ctx = getUserContext();
  if (!ctx || ctx.role === 'anonymous') {
    return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 });
  }
  const data = doSomething(paths.episodic);
};

export const GET = withUserContext(handler);
```

**After (Read-only, allow anonymous)**:
```typescript
import { getUserOrAnonymous, getProfilePaths, systemPaths } from '@metahuman/core';

const handler: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);

  if (user.role === 'anonymous') {
    // Return default/empty data
    return new Response(JSON.stringify({ memories: [] }), { status: 200 });
  }

  // Authenticated users get full data
  const paths = getProfilePaths(user.username);
  const data = doSomething(paths.episodic);

  return new Response(JSON.stringify(data), { status: 200 });
};

export const GET = handler;
```

**After (Require authentication)**:
```typescript
import { getAuthenticatedUser, getProfilePaths, systemPaths } from '@metahuman/core';

const handler: APIRoute = async ({ cookies }) => {
  // Throws 401 if not authenticated
  const user = getAuthenticatedUser(cookies);

  const paths = getProfilePaths(user.username);
  const data = doSomething(paths.episodic);

  return new Response(JSON.stringify(data), { status: 200 });
};

export const GET = handler;
```

---

## Batch 2: Memory/Persona Read Endpoints (~10 files)

### Files to Migrate

Find files that use `withUserContext` and primarily read memory/persona data:

```bash
# Find candidates
cd /home/greggles/metahuman
grep -l "withUserContext" apps/site/src/pages/api/*.ts | \
  xargs grep -l "episodic\|memories\|persona\|facet" | \
  head -10
```

**Likely candidates**:
- `/api/memories.ts` - List episodic memories
- `/api/memories_all.ts` - Fetch all memories
- `/api/persona-core.ts` - Read persona core
- `/api/persona-facet.ts` - Read persona facets
- `/api/persona-facets-manage.ts` - Manage persona facets
- `/api/chat/history.ts` - Chat history
- `/api/conversation/summary.ts` - Conversation summaries
- `/api/reflections/*.ts` - Reflection endpoints
- Other memory-related read endpoints

### Migration Steps

For **each file**:

1. **Read the file first**:
   ```typescript
   // Always read before editing!
   Read("/path/to/file.ts")
   ```

2. **Update imports**:
   ```typescript
   // Remove these:
   - import { withUserContext } from '../../middleware/userContext';
   - import { getUserContext } from '@metahuman/core/context';
   - import { paths } from '@metahuman/core/paths';

   // Add these:
   + import { getUserOrAnonymous, getProfilePaths, systemPaths } from '@metahuman/core';
   // OR (if auth required):
   + import { getAuthenticatedUser, getProfilePaths, systemPaths } from '@metahuman/core';
   ```

3. **Update handler signature**:
   ```typescript
   // Before:
   const handler: APIRoute = async () => {

   // After:
   const handler: APIRoute = async ({ cookies }) => {
   ```

4. **Replace getUserContext()**:
   ```typescript
   // Before:
   const ctx = getUserContext();
   if (!ctx || ctx.role === 'anonymous') {
     return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 });
   }

   // After (allow anonymous):
   const user = getUserOrAnonymous(cookies);
   if (user.role === 'anonymous') {
     return new Response(JSON.stringify({ memories: [] }), { status: 200 });
   }

   // OR (require auth):
   const user = getAuthenticatedUser(cookies);
   ```

5. **Update path resolution**:
   ```typescript
   // Before:
   const data = doSomething(paths.episodic);

   // After (user-specific):
   const profilePaths = getProfilePaths(user.username);
   const data = doSomething(profilePaths.episodic);

   // OR (system paths):
   const data = doSomething(systemPaths.etc);
   ```

6. **Update export**:
   ```typescript
   // Before:
   export const GET = withUserContext(handler);

   // After:
   // MIGRATED: 2025-11-20 - Explicit authentication pattern
   // [Description of auth behavior]
   export const GET = handler;
   ```

7. **Check syntax**:
   ```bash
   cd apps/site && pnpm astro check --minimumSeverity warning 2>&1 | grep "api/filename.ts"
   ```

### Decision Tree: Allow Anonymous vs Require Auth

**Allow anonymous** (`getUserOrAnonymous`) if:
- ✅ Endpoint returns public/demo data for anonymous users
- ✅ Read-only operation
- ✅ Safe to return empty/default data

**Require auth** (`getAuthenticatedUser`) if:
- ✅ Endpoint accesses user-specific sensitive data
- ✅ Write operation
- ✅ No reasonable default for anonymous users

---

## Batch 3: Configuration Read Endpoints (~10 files)

### Files to Migrate

Configuration endpoints that read system/user settings:

**Likely candidates**:
- `/api/cognitive-mode.ts` - Cognitive mode settings
- `/api/agent-config.ts` - Agent configuration
- `/api/boredom.ts` - Boredom settings
- `/api/curiosity-config.ts` - Curiosity configuration
- `/api/chat-settings.ts` - Chat settings
- `/api/cognitive-layers-config.ts` - Cognitive layers
- `/api/runtime/mode.ts` - Runtime mode
- `/api/security/policy.ts` - Security policy
- `/api/trust.ts` - Trust settings
- Other config-related endpoints

### Migration Pattern

Most config endpoints should **allow anonymous** (return defaults):

```typescript
const handler: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);

  // Load config from system paths (not user-specific)
  const config = loadConfig(systemPaths.etc);

  // Return config (same for all users, safe for anonymous)
  return new Response(JSON.stringify(config), { status: 200 });
};
```

**Exception**: Config write endpoints should **require auth**:

```typescript
const postHandler: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);

  const body = await request.json();
  saveConfig(systemPaths.etc, body);

  audit({
    category: 'data_change',
    level: 'info',
    action: 'config_updated',
    actor: user.username,
    context: { /* ... */ }
  });

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
```

---

## Testing Checklist

For **each migrated endpoint**:

### Anonymous User Tests
```bash
# Clear session cookie first
# Test in browser DevTools or curl

# For endpoints that allow anonymous:
curl http://localhost:4321/api/endpoint
# ✅ Should return 200 with default/empty data

# For endpoints that require auth:
curl http://localhost:4321/api/endpoint
# ✅ Should return 401 Unauthorized
```

### Authenticated User Tests
```bash
# Set session cookie (get from browser DevTools after login)
curl -H "Cookie: mh_session=..." http://localhost:4321/api/endpoint
# ✅ Should return 200 with user-specific data
```

### Syntax Validation
```bash
cd apps/site
pnpm astro check --minimumSeverity warning 2>&1 | grep "api/"
# ✅ Should show no errors for migrated files
```

---

## Progress Tracking

### Todo List Management

Update the todo list as you complete each file:

```typescript
TodoWrite({
  todos: [
    { content: "Batch 2: Migrate /api/memories.ts", status: "completed", activeForm: "Migrated memories.ts" },
    { content: "Batch 2: Migrate /api/persona-core.ts", status: "in_progress", activeForm: "Migrating persona-core.ts" },
    { content: "Batch 2: Migrate /api/chat/history.ts", status: "pending", activeForm: "Migrating chat/history.ts" },
    // ... etc
  ]
})
```

### Batch Completion Document

When Batch 2 is complete, create:

```bash
# Create docs/BATCH-2-COMPLETE.md
# Follow the format of docs/BATCH-1-COMPLETE.md
# Include:
# - List of migrated files
# - Testing performed
# - Any issues encountered
# - Pattern variations discovered
```

When Batch 3 is complete, create:

```bash
# Create docs/BATCH-3-COMPLETE.md
# Then create docs/PHASE-3-COMPLETE.md summarizing all batches
```

---

## Common Patterns & Solutions

### Pattern 1: Multiple HTTP Methods

```typescript
// Before:
const getHandler: APIRoute = async () => { /* ... */ };
const postHandler: APIRoute = async ({ request }) => { /* ... */ };

export const GET = withUserContext(getHandler);
export const POST = withUserContext(postHandler);

// After:
const getHandler: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);
  // ... allow anonymous to read
};

const postHandler: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);
  // ... require auth to write
};

export const GET = getHandler;
export const POST = postHandler;
```

### Pattern 2: Conditional Anonymous Access

```typescript
const handler: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);

  if (user.role === 'anonymous') {
    // Return public/demo data
    return new Response(JSON.stringify({
      memories: [],
      total: 0,
      message: 'Log in to see your memories'
    }), { status: 200 });
  }

  // Full data for authenticated users
  const paths = getProfilePaths(user.username);
  const memories = loadMemories(paths.episodic);

  return new Response(JSON.stringify({
    memories,
    total: memories.length
  }), { status: 200 });
};
```

### Pattern 3: System Paths vs User Paths

```typescript
// System paths (shared config, not user-specific)
const config = JSON.parse(
  fs.readFileSync(path.join(systemPaths.etc, 'config.json'), 'utf-8')
);

// User paths (user-specific data)
const profilePaths = getProfilePaths(user.username);
const memories = fs.readdirSync(profilePaths.episodic);
```

### Pattern 4: Audit Logs

```typescript
// Before:
audit({
  actor: ctx.username,
  // ...
});

// After:
audit({
  actor: user.username,
  // ...
});
```

---

## Troubleshooting

### Error: "File has not been read yet"

**Solution**: Always read the file before editing:
```typescript
Read("/path/to/file.ts")
// Wait for result
Edit("/path/to/file.ts", { /* ... */ })
```

### Error: "getProfilePaths is not defined"

**Solution**: Import from `@metahuman/core`:
```typescript
import { getProfilePaths } from '@metahuman/core';
```

### Error: "paths is not defined"

**Solution**: Don't use the context-aware `paths` proxy. Use explicit resolution:
```typescript
// Don't:
import { paths } from '@metahuman/core/paths';

// Do:
import { systemPaths, getProfilePaths } from '@metahuman/core';
```

### Error: "Property 'username' does not exist on type 'never'"

**Solution**: Make sure you're using the right auth function:
```typescript
// If allowing anonymous:
const user = getUserOrAnonymous(cookies);

// If requiring auth:
const user = getAuthenticatedUser(cookies);
```

---

## Example Migration Session

Here's a complete example of migrating `/api/memories.ts`:

```typescript
// 1. Read the file
Read("/home/greggles/metahuman/apps/site/src/pages/api/memories.ts")

// 2. Update imports
Edit("/home/greggles/metahuman/apps/site/src/pages/api/memories.ts", {
  old_string: `import { withUserContext } from '../../middleware/userContext';
import { getUserContext } from '@metahuman/core/context';
import { paths } from '@metahuman/core/paths';`,
  new_string: `import { getUserOrAnonymous, getProfilePaths } from '@metahuman/core';`
})

// 3. Update handler
Edit("/home/greggles/metahuman/apps/site/src/pages/api/memories.ts", {
  old_string: `const handler: APIRoute = async ({ url }) => {
  const ctx = getUserContext();
  if (!ctx || ctx.role === 'anonymous') {
    return new Response(
      JSON.stringify({ error: 'Authentication required' }),
      { status: 401 }
    );
  }`,
  new_string: `const handler: APIRoute = async ({ cookies, url }) => {
  const user = getUserOrAnonymous(cookies);

  if (user.role === 'anonymous') {
    return new Response(
      JSON.stringify({ memories: [], total: 0 }),
      { status: 200 }
    );
  }`
})

// 4. Update path resolution
Edit("/home/greggles/metahuman/apps/site/src/pages/api/memories.ts", {
  old_string: `const memories = listMemories(paths.episodic);`,
  new_string: `const profilePaths = getProfilePaths(user.username);
  const memories = listMemories(profilePaths.episodic);`
})

// 5. Update export
Edit("/home/greggles/metahuman/apps/site/src/pages/api/memories.ts", {
  old_string: `export const GET = withUserContext(handler);`,
  new_string: `// MIGRATED: 2025-11-20 - Explicit authentication pattern
// Anonymous users allowed (empty list)
// Authenticated users see their memories
export const GET = handler;`
})

// 6. Update todo
TodoWrite({
  todos: [
    { content: "Batch 2: Migrate /api/memories.ts", status: "completed", activeForm: "Migrated memories.ts" },
    // ... next item as in_progress
  ]
})
```

---

## Success Criteria

Phase 3 is complete when:

- ✅ All ~20 remaining endpoints migrated (Batches 2-3)
- ✅ No `withUserContext` wrappers on any migrated files
- ✅ Explicit auth checks in all handlers
- ✅ Audit logs use actual usernames (where applicable)
- ✅ Appropriate access control (anonymous allowed where safe)
- ✅ No syntax errors
- ✅ All tests pass
- ✅ Documentation created:
  - `docs/BATCH-2-COMPLETE.md`
  - `docs/BATCH-3-COMPLETE.md`
  - `docs/PHASE-3-COMPLETE.md`

---

## Next Phase Preview

After Phase 3, proceed to:

**Phase 4**: Mixed read/write endpoints (~25 files)
- More complex files with multiple HTTP methods
- Persona generator endpoints
- Function management endpoints
- Profile management endpoints
- Onboarding endpoints

**Phase 5**: Cleanup
1. Delete `apps/site/src/middleware/userContext.ts`
2. Simplify global middleware
3. Mark `withUserContext` as deprecated
4. Update CLAUDE.md
5. Final validation

---

## Files for Reference

- **Phase 2 Summary**: [docs/PHASE-2-COMPLETE.md](PHASE-2-COMPLETE.md)
- **Batch 1 Summary**: [docs/BATCH-1-COMPLETE.md](BATCH-1-COMPLETE.md)
- **Security Analysis**: [docs/SECURITY-ARCHITECTURE-ANALYSIS.md](SECURITY-ARCHITECTURE-ANALYSIS.md)
- **Migration Status**: [docs/AUTH-MIGRATION-STATUS.md](AUTH-MIGRATION-STATUS.md)

---

**Good luck with the migration! Follow these patterns consistently and you'll complete Phase 3 successfully.**
