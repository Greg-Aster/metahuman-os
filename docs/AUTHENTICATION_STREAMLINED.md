# Streamlined Authentication System

**Date**: 2025-11-13
**Status**: Implemented
**Related**: BUGFIX_2025-11-06_API_PATH_ACCESS.md, SECURITY_FIXES_2025-11-06_GUEST_PATHS.md

## Problem Summary

The original authentication system had significant pain points:

1. **"Anonymous user" errors everywhere**: The middleware forced every `/api/*` request through `withUserContext`, injecting `{ userId: 'anonymous', username: 'anonymous', role: 'anonymous' }` when no session cookie existed
2. **Path access explosions**: `paths.*` proxy threw exceptions for anonymous users without `activeProfile`, causing stack traces to leak into logs and UI
3. **Copy-paste try-catch hell**: Every API endpoint needed manual try-catch blocks (see BUGFIX doc) to handle anonymous path access
4. **Confusing for developers**: No actual "anonymous" user profile exists in the system, yet errors referenced it constantly
5. **Difficult to debug**: Stack traces from path proxy made it hard to identify which endpoint was failing

## Solution Architecture

### 1. Central Path Resolution Helpers

Added two new helper functions in [packages/core/src/paths.ts](packages/core/src/paths.ts):

#### `tryResolveProfilePath(key)`

Safe, non-throwing path resolver that returns a discriminated union:

```typescript
type PathResolutionResult =
  | { ok: true; path: string }
  | { ok: false; error: 'anonymous' | 'no_context' | 'invalid_key' }
```

**Usage Pattern for Public Reads** (return defaults for anonymous users):
```typescript
const result = tryResolveProfilePath('personaCore');
if (!result.ok) {
  return new Response(
    JSON.stringify({ identity: { name: 'MetaHuman' } }),
    { status: 200 }
  );
}
const data = fs.readFileSync(result.path, 'utf-8');
```

**Usage Pattern for Protected Writes** (return 401 for anonymous users):
```typescript
const result = tryResolveProfilePath('episodic');
if (!result.ok) {
  return new Response(
    JSON.stringify({ error: 'Authentication required' }),
    { status: 401 }
  );
}
fs.writeFileSync(path.join(result.path, 'event.json'), data);
```

#### `requireProfilePath(key)`

Throws descriptive errors for operations that MUST have user context:

```typescript
// For CLI commands that require authentication
const episodicPath = requireProfilePath('episodic');
const events = fs.readdirSync(episodicPath);
```

**Error messages**:
- `'anonymous'`: "Access denied: Anonymous users cannot access user data paths..."
- `'no_context'`: "No user context available to resolve path..."
- `'invalid_key'`: "Invalid path key: paths.X does not exist..."

### 2. API Endpoint Classification

Endpoints fall into three categories:

#### **Category A: Public Reads** (degrade gracefully for anonymous users)

Return sensible defaults instead of errors:

- `/api/boot` - Returns default persona, system status
- `/api/persona-core` (GET) - Returns default persona structure
- `/api/persona-icon` - Returns default avatar
- `/api/persona-facet` (GET) - Returns default facets

**Pattern**:
```typescript
const result = tryResolveProfilePath('personaCore');
if (!result.ok) {
  return new Response(JSON.stringify({ default: 'data' }), { status: 200 });
}
// ...proceed with authenticated logic
```

#### **Category B: Protected Operations** (return 401/403 for anonymous users)

Require authentication to access:

- `/api/persona-core` (POST) - Modify persona
- `/api/capture` - Create memories
- `/api/memories` - Read memory list
- `/api/memory-content` (PUT) - Edit memory files
- `/api/tasks` (POST, PATCH) - Create/update tasks
- `/api/audio/upload` - Upload audio files
- `/api/adapters/*` - Manage LoRA adapters

**Pattern**:
```typescript
const result = tryResolveProfilePath('episodic');
if (!result.ok) {
  return new Response(
    JSON.stringify({ error: 'Authentication required' }),
    { status: 401 }
  );
}
// ...proceed with operation
```

#### **Category C: System Operations** (use `systemPaths` directly)

Never touch user-specific paths:

- `/api/agent` - Agent control
- `/api/audit` - System audit logs
- `/api/models` - Model registry
- `/api/auth/*` - Authentication endpoints
- `/api/profiles/*` - Profile management

**Pattern**:
```typescript
import { systemPaths } from '@metahuman/core';

const agentPath = path.join(systemPaths.brain, 'agents', `${name}.ts`);
```

### 3. Converted Endpoints

The following high-traffic endpoints have been migrated to use the new helpers:

- ✅ `/api/persona-core` - Both GET and POST handlers
- ✅ `/api/memories` - GET handler with graceful fallback
- ✅ `/api/boot` - Uses `systemPaths` for agent management

### 4. Dev Session Helper Script

Created [scripts/dev-session.ts](scripts/dev-session.ts) to eliminate authentication pain during development:

```bash
# Create authenticated session for user
pnpm tsx scripts/dev-session.ts --username=greggles

# Output:
# ✅ Dev session created successfully!
# Session ID: 38d26955b5588a341b78bfee344f637341758298af02f37a72e49630682fd6b4
# 📋 Copy cookie to browser DevTools...
```

**Benefits**:
- No more anonymous user errors during local dev
- Session persists for 30 days
- Works with existing middleware (no code changes needed)
- Outputs clear instructions for browser cookie setup

## Benefits

### For Developers

1. **No more anonymous errors**: Clear 401 responses instead of cryptic path access exceptions
2. **Less boilerplate**: No manual try-catch blocks for path access
3. **Better error messages**: Discriminated union makes error handling explicit
4. **Easier debugging**: Dev session script eliminates auth friction
5. **Type safety**: TypeScript ensures you handle all error cases

### For Users

1. **Better UX**: Anonymous users see defaults, not errors
2. **Clear auth prompts**: 401 responses trigger login gates in UI
3. **No leaked stack traces**: Clean JSON error responses

### For System

1. **Consistent patterns**: All endpoints follow same classification
2. **Auditability**: All path access decisions are explicit in code
3. **Security**: Anonymous users can't accidentally access protected data
4. **Maintainability**: Central helpers mean fewer places to change

## Migration Guide

### For New API Endpoints

1. **Determine category** (public read, protected, or system)
2. **Use appropriate pattern**:

```typescript
// Public read
import { tryResolveProfilePath } from '@metahuman/core';

export const GET: APIRoute = async () => {
  const result = tryResolveProfilePath('personaCore');
  if (!result.ok) {
    return new Response(JSON.stringify({ default: 'data' }), { status: 200 });
  }
  const data = fs.readFileSync(result.path, 'utf-8');
  // ...
};

// Protected write
export const POST: APIRoute = async () => {
  const result = tryResolveProfilePath('episodic');
  if (!result.ok) {
    return new Response(
      JSON.stringify({ error: 'Authentication required' }),
      { status: 401 }
    );
  }
  fs.writeFileSync(path.join(result.path, 'event.json'), data);
  // ...
};

// System operation
import { systemPaths } from '@metahuman/core';

export const GET: APIRoute = async () => {
  const agentsDir = systemPaths.agents;
  // ...
};
```

### For Existing Endpoints

1. **Find path access**: `grep -r "paths\." apps/site/src/pages/api`
2. **Classify endpoint**: Public read, protected, or system?
3. **Replace `paths.*` with helper**:
   - Public reads → `tryResolveProfilePath()` with default fallback
   - Protected → `tryResolveProfilePath()` with 401 response
   - System → `systemPaths.*` directly
4. **Remove manual try-catch blocks** (old pattern from BUGFIX doc)
5. **Test with anonymous user** (clear cookies, reload)

### For Development

1. **Run dev-session script**:
   ```bash
   pnpm tsx scripts/dev-session.ts --username=greggles
   ```

2. **Set cookie in browser**:
   - Open DevTools (F12)
   - Application → Cookies → http://localhost:4321
   - Add cookie: `mh_session` = `<session-id-from-script>`
   - Reload page

3. **Verify authentication**:
   - Check `/api/boot` response has `isAuthenticated: true`
   - Check `/api/auth/me` returns your user info
   - Check UI shows authenticated state

## Remaining Work

### API Endpoints to Migrate

These endpoints still use direct `paths.*` access and may need migration:

```
apps/site/src/pages/api/adapters/index.ts
apps/site/src/pages/api/audio/upload.ts
apps/site/src/pages/api/chat/history.ts
apps/site/src/pages/api/export/conversations.ts
apps/site/src/pages/api/llm-activity.ts
apps/site/src/pages/api/memory-content.ts (partially done)
apps/site/src/pages/api/memories/delete.ts
apps/site/src/pages/api/memories/validate.ts
apps/site/src/pages/api/persona-icon.ts
apps/site/src/pages/api/persona-facet.ts (already has try-catch)
apps/site/src/pages/api/voice-samples/[sampleId].ts
```

Use this command to find them:
```bash
grep -l "paths\." apps/site/src/pages/api/**/*.ts
```

### UI Components to Update

Frontend components should handle 401/403 responses gracefully:

1. **Show login gate**: Replace error alerts with "Please log in" prompts
2. **Retry after auth**: Store failed request, retry after successful login
3. **Hide auth-only features**: Disable buttons/features for anonymous users
4. **Clear messaging**: "This feature requires authentication" instead of "Access denied"

Example:
```typescript
const response = await fetch('/api/capture', { method: 'POST', body });
if (response.status === 401) {
  showLoginPrompt(); // Show modal/redirect to login
  return;
}
```

## Testing Checklist

- [ ] Anonymous user can load home page without errors
- [ ] Anonymous user sees default persona in UI
- [ ] Anonymous user gets clean 401 when trying protected operations
- [ ] Authenticated user can access all features
- [ ] Dev session script creates valid sessions
- [ ] Sessions persist across page reloads
- [ ] UI shows appropriate prompts for 401 responses
- [ ] No stack traces leak to client
- [ ] Audit logs record path access decisions

## Related Documentation

- [BUGFIX_2025-11-06_API_PATH_ACCESS.md](BUGFIX_2025-11-06_API_PATH_ACCESS.md) - Original try-catch workaround pattern
- [SECURITY_FIXES_2025-11-06_GUEST_PATHS.md](SECURITY_FIXES_2025-11-06_GUEST_PATHS.md) - Guest profile path access fix
- [CLAUDE.md](../CLAUDE.md) - Project overview and architecture

## Summary

This streamlined authentication system eliminates the "anonymous user" pain points by:

1. **Centralizing path resolution logic** in reusable helper functions
2. **Classifying API endpoints** by access requirements
3. **Providing clear patterns** for each endpoint category
4. **Offering dev tools** to skip authentication friction during development
5. **Returning appropriate responses** (defaults vs. 401s) based on endpoint type

The system maintains backward compatibility while reducing boilerplate and improving error clarity. Developers no longer need to scatter try-catch blocks across every API endpoint, and users see appropriate responses instead of cryptic error messages.
