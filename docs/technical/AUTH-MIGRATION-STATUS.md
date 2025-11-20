# Authentication Migration Status

**Date Started**: 2025-11-20
**Status**: Phase 1 Complete, Phase 2 In Progress

## Completed Work

### Phase 1: Foundation ✅

1. **Fixed Circular Dependency** ✅
   - Created `packages/core/src/path-builder.ts` with no dependencies
   - Updated `context.ts` to import from `path-builder.ts`
   - Updated `paths.ts` to re-export and add Proxy layer
   - No more "getProfilePaths is not defined" errors

2. **Removed Dev Auto-Login Security Risk** ✅
   - Deleted dangerous auto-login code from `apps/site/src/middleware.ts` (lines 72-96)
   - Added comment directing devs to use `scripts/dev-session.ts` instead
   - Prevents accidental owner privilege escalation in production

3. **Added Error-Handling Middleware** ✅
   - Wrapped middleware in try/catch
   - Converts "UNAUTHORIZED:" errors to 401 responses
   - Converts "FORBIDDEN:" errors to 403 responses
   - Clean error messages for API consumers

## Remaining Work

### Phase 2: Migrate High-Risk Endpoints (Priority)

**Total**: 74 endpoints
**Migrated**: 0
**Remaining**: 74

#### Critical Write Endpoints (Do These First)

1. **`/api/persona-core-manage.ts`** - Writes identity kernel
   - Current: Uses `withUserContext` + `tryResolveProfilePath`
   - Target: Use `getAuthenticatedUser` + `getProfilePaths`

2. **`/api/capture.ts`** - Writes memories
   - Current: Uses `withUserContext(requireWriteMode(handler))`
   - Target: Use `getAuthenticatedUser` in handler

3. **`/api/tasks.ts`** - Manages tasks
   - Current: Uses `withUserContext`
   - Target: Use `getAuthenticatedUser` for writes, `getUserOrAnonymous` for reads

4. **`/api/memory-content.ts`** - Edits memories
   - Current: Uses `withUserContext`
   - Target: Use `getAuthenticatedUser`

5. **`/api/agent.ts`** - Starts agents
   - Current: Uses `withUserContext`
   - Target: Use `getAuthenticatedUser`

#### Read-Only Endpoints (Lower Priority, ~30 files)

Examples:
- `/api/boot.ts`
- `/api/persona-core.ts`
- `/api/memories.ts`
- `/api/status.ts`
- etc.

Target pattern:
```typescript
export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);

  if (user.role === 'anonymous') {
    // Return public data or defaults
  }

  const paths = getProfilePaths(user.username);
  // ... read user-specific data
};
```

#### Mixed Read/Write Endpoints (~25 files)

Examples:
- `/api/chat-settings.ts` (GET + PUT)
- `/api/voice-settings.ts` (GET + POST)
- `/api/cognitive-mode.ts` (GET + POST)
- etc.

Pattern:
```typescript
const getHandler: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);
  // Degrade gracefully for anonymous
};

const postHandler: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies); // Throws 401
  // ... write logic
};

export const GET = getHandler;
export const POST = requireWriteMode(postHandler);
```

### Phase 3: Remove Old System

After all endpoints are migrated:

1. **Delete local wrapper** ✅
   - `apps/site/src/middleware/userContext.ts` (no longer needed)

2. **Simplify global middleware**
   - `apps/site/src/middleware.ts` can be simplified to just error handling
   - Remove AsyncLocalStorage context setting (not used by new pattern)

3. **Deprecate context.ts exports**
   - Mark `withUserContext` and `getUserContext` as deprecated
   - Update `index.ts` to warn about deprecation

4. **Update CLAUDE.md**
   - Document new auth pattern
   - Add examples for common endpoint patterns
   - Remove references to old middleware system

## Migration Pattern Reference

### For Write Operations

```typescript
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';

const postHandler: APIRoute = async ({ cookies, request }) => {
  // 1. Explicit auth check (throws 401 if not authenticated)
  const user = getAuthenticatedUser(cookies);

  // 2. Get paths explicitly
  const paths = getProfilePaths(user.username);

  // 3. Business logic
  const data = await request.json();
  fs.writeFileSync(path.join(paths.episodic, 'event.json'), JSON.stringify(data));

  // 4. Audit with username
  audit({ actor: user.username, ... });

  return new Response(JSON.stringify({ success: true }), { status: 201 });
};

// Keep security policy guards!
export const POST = requireWriteMode(postHandler);
```

### For Read Operations (Graceful Degradation)

```typescript
import { getUserOrAnonymous, getProfilePaths } from '@metahuman/core';

const getHandler: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);

  if (user.role === 'anonymous') {
    // Return defaults for anonymous
    return new Response(JSON.stringify({ data: 'default' }), { status: 200 });
  }

  // Authenticated user - return their data
  const paths = getProfilePaths(user.username);
  const data = fs.readFileSync(paths.personaCore, 'utf-8');

  return new Response(data, { status: 200 });
};

export const GET = getHandler;
```

### For Public Endpoints (No Auth Required)

```typescript
import { systemPaths } from '@metahuman/core';

export const GET: APIRoute = async () => {
  // Use systemPaths for global data
  const models = fs.readFileSync(path.join(systemPaths.etc, 'models.json'), 'utf-8');
  return new Response(models, { status: 200 });
};
```

## Key Changes Summary

### Before (Old Pattern)
```typescript
import { withUserContext } from '../../middleware/userContext';

const handler: APIRoute = async () => {
  const ctx = getUserContext(); // Magic! Where'd it come from?
  const paths = ctx?.profilePaths;
  // ...
};

export const POST = withUserContext(requireWriteMode(handler));
```

### After (New Pattern)
```typescript
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';

const handler: APIRoute = async ({ cookies }) => {
  const user = getAuthenticatedUser(cookies); // Explicit!
  const paths = getProfilePaths(user.username);
  // ...
};

export const POST = requireWriteMode(handler);
```

## Testing Checklist

After each endpoint migration:

- [ ] Can anonymous users still access public data?
- [ ] Do authenticated users get their profile data?
- [ ] Do write operations reject anonymous users with 401?
- [ ] Do security policy guards (requireWriteMode, requireOwner) still work?
- [ ] Are audit logs using correct username as actor?
- [ ] No more "getUserContext" calls in the handler?
- [ ] No more "withUserContext" wrappers on exports?

## Timeline Estimate

- **Phase 2 (High-risk endpoints)**: 1-2 days (5 critical files, careful testing)
- **Phase 3 (Read-only batch)**: 2-3 days (~30 files, lower risk)
- **Phase 4 (Mixed endpoints)**: 2-3 days (~25 files, varied complexity)
- **Phase 5 (Cleanup)**: 1 day (remove old system, update docs)

**Total**: 6-9 days for complete migration

## Quick Reference Commands

```bash
# Find all files using old pattern
grep -r "withUserContext" apps/site/src/pages/api/

# Find all files using getUserContext
grep -r "getUserContext()" apps/site/src/pages/api/

# Count remaining migrations
grep -r "withUserContext" apps/site/src/pages/api/ | wc -l

# Test a specific endpoint
curl http://localhost:4321/api/endpoint -H "Cookie: mh_session=YOUR_SESSION"
```

## Next Steps

1. Start with `/api/persona-core-manage.ts` (highest risk)
2. Test thoroughly before moving to next file
3. Repeat for remaining 4 critical endpoints
4. Batch migrate read-only endpoints
5. Final cleanup and documentation update
