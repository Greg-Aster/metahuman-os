# Security Architecture Analysis

**Date**: 2025-11-20
**Status**: 🔴 Critical Issues Identified
**Author**: System Analysis

## Executive Summary

The current authentication and authorization system has **significant architectural problems** that compromise both security and maintainability. There are two competing authentication systems, inconsistent middleware usage across 74 API endpoints, circular dependencies, and unclear separation of concerns.

**Recommendation**: Refactor to a single, modern, explicit authentication pattern.

---

## Current State Analysis

### 1. Competing Authentication Systems

**Problem**: Two different auth systems exist simultaneously:

#### System A: `auth.ts` (Simple, Explicit)
```typescript
// packages/core/src/auth.ts
export function getAuthenticatedUser(cookies: Cookies): AuthenticatedUser
export function getUserOrAnonymous(cookies: Cookies): User
export function getUserPaths(user: User)
export function hasPermission(user: User, permission): boolean
```

- **Pros**: Simple, explicit, no magic
- **Cons**: Not consistently used across codebase
- **Comment in code**: "Replaces the overcomplicated withUserContext middleware"

#### System B: `context.ts` + Middleware (Implicit, Complex)
```typescript
// packages/core/src/context.ts
export function withUserContext<T>(user, fn): Promise<T>
export function getUserContext(): UserContext | undefined

// apps/site/src/middleware.ts - Global middleware
export const onRequest = defineMiddleware(...)

// apps/site/src/middleware/userContext.ts - Local wrapper
export function withUserContext(handler: APIRoute): APIRoute
```

- **Pros**: Automatic context propagation via AsyncLocalStorage
- **Cons**: Complex, implicit, debugging nightmares, circular dependencies
- **Status**: Currently used in ~90% of API endpoints

### 2. Critical Issues

#### Issue #1: Dual System Confusion
**Evidence**: `persona_chat.ts` imports and uses BOTH systems
```typescript
import { getUserOrAnonymous, withUserContext, getUserContext } from '@metahuman/core';
```

**Impact**:
- Developers don't know which system to use
- Code review is inconsistent
- Security audits are difficult
- New developers will be confused

#### Issue #2: Circular Dependencies
**Files**: `paths.ts` ↔ `context.ts`

```typescript
// paths.ts imports from context.ts
import { getUserContext } from './context.js';

// context.ts imports from paths.ts
import { getProfilePaths, systemPaths } from './paths.js';
```

**Impact**:
- Module initialization order issues
- "getProfilePaths is not defined" errors (as seen today)
- Difficult to test in isolation
- Fragile refactoring

#### Issue #3: Inconsistent Middleware Application

**Evidence**:
- Global middleware: `apps/site/src/middleware.ts` (applies to all `/api/*` routes)
- Local wrapper: Many endpoints also wrap with `withUserContext(handler)`
- Some endpoints use neither
- Some use both (double middleware!)

**Example - Double wrapping**:
```typescript
// Global middleware already runs...
export const GET = withUserContext(getHandler); // ...then this ALSO wraps it
```

**Impact**:
- Context may be set twice
- Performance overhead
- Unclear execution order
- Potential context leakage

#### Issue #4: AsyncLocalStorage Pitfalls

**Current Pattern**:
```typescript
export function withUserContext<T>(user, fn): Promise<T> {
  const context: UserContext = { userId, username, role, ... };
  return contextStorage.run(context, async () => {
    const result = await fn();
    return result;
  });
}
```

**Problems**:
1. **Context Leakage**: If async operation outlives the `contextStorage.run()` scope, context may leak to other requests
2. **Debugging**: Call stack becomes hard to follow
3. **Error Handling**: Errors in context initialization fail silently
4. **Testing**: Requires mocking AsyncLocalStorage
5. **Performance**: AsyncLocalStorage has overhead (~10-20% in high-throughput scenarios)

#### Issue #5: Path Resolution Throws on Anonymous Users

**Current Behavior**:
```typescript
// paths.ts - Proxy getter
if (context && context.username === 'anonymous' && !context.activeProfile) {
  throw new Error(
    `Access denied: Anonymous users cannot access user data paths. ` +
    `Attempted to access: paths.${prop}. ` +
    `Please authenticate or select a public profile to access data.`
  );
}
```

**Problems**:
- Throws exceptions in normal flow (should return 401/403)
- Forces try-catch everywhere
- API handlers need to anticipate throws from path access
- Error messages reference internal concepts ("paths.episodic")

**Better Pattern**:
```typescript
const user = getAuthenticatedUser(cookies); // Throws at handler level
const paths = getProfilePaths(user.username); // Never throws
```

#### Issue #6: No Clear Authorization Model

**Current State**: Permission checks are ad-hoc
```typescript
// Some endpoints check manually:
if (user.role === 'anonymous') {
  return new Response('Unauthorized', { status: 401 });
}

// Others don't check at all
// Some check role, some check username
// No centralized policy
```

**Missing**:
- Role-based access control (RBAC)
- Resource-level permissions
- Audit trail of auth failures
- Rate limiting per user/role

---

## Security Concerns

### 1. Development Auto-Login Bypass 🔴

**Code**: `apps/site/src/middleware.ts:72-96`
```typescript
const isDevelopment = import.meta.env.DEV;
const devAutoLogin = process.env.DEV_AUTO_LOGIN !== 'false'; // Default to true in dev

if (isDevelopment && devAutoLogin) {
  const ownerUser = getUserByUsername(devUsername);
  if (ownerUser && ownerUser.role === 'owner') {
    return await runWithUserContext(
      { userId: ownerUser.id, username: ownerUser.username, role: ownerUser.role },
      () => next()
    );
  }
}
```

**Risk**: If `import.meta.env.DEV` ever becomes true in production (e.g., misconfigured build):
- **All anonymous users become owner**
- Complete authentication bypass
- Data exfiltration possible

**Recommendation**: Remove auto-login entirely, use proper dev sessions

### 2. Session Validation Timing 🟡

**Current Flow**:
1. Middleware validates session
2. Gets user from database
3. Wraps handler in context

**Problem**: Role changes take effect immediately, but:
- Long-running requests may operate with stale role
- No token invalidation on permission change
- No session versioning

**Recommendation**: Add session versioning, require re-auth on role change

### 3. No CSRF Protection 🟡

**Observation**: No CSRF tokens visible in API handlers

**Risk**: State-changing operations vulnerable to CSRF if:
- Cookies are used for auth (they are: `mh_session`)
- No SameSite=Strict enforcement
- No CSRF token validation

**Recommendation**: Add CSRF middleware or use SameSite=Strict + Origin checking

### 4. Anonymous User Confusion 🟡

**Current Design**: "anonymous" is a role, but treated inconsistently

```typescript
// Sometimes anonymous can read:
if (user.role === 'anonymous') {
  return permission === 'read'; // true
}

// Sometimes anonymous is blocked:
if (context.username === 'anonymous') {
  throw new Error('Access denied');
}

// Sometimes anonymous has paths:
const activeProfile = session.metadata?.activeProfile || undefined;
```

**Recommendation**: Clarify guest vs anonymous vs unauthenticated

---

## Maintainability Concerns

### 1. Developer Onboarding
**Current Time to Understand Auth**: ~4 hours
- Must read 5 files
- Understand AsyncLocalStorage
- Learn two competing systems
- Debug circular dependencies

**Target**: ~30 minutes with clear pattern

### 2. Testing Difficulty
**Current State**:
```typescript
// To test an API handler:
- Mock AsyncLocalStorage
- Mock session cookie
- Mock user database
- Mock path resolution
- Hope context is set correctly
```

**Better**:
```typescript
// Explicit auth makes testing trivial:
const handler = async ({ cookies }) => {
  const user = getAuthenticatedUser(cookies);
  // ... test with mock cookies
}
```

### 3. Refactoring Risk
- Changing auth.ts has no effect (not used)
- Changing context.ts breaks 70+ files
- Circular dependencies prevent clean refactors
- No clear migration path

---

## Recommended Architecture

### Design Principles

1. **Explicit over Implicit**: Auth should be visible in handler signature
2. **Fail Fast**: Auth errors at handler entry, not deep in business logic
3. **Single Responsibility**: Auth concerns separate from business logic
4. **Testable**: Easy to mock and test
5. **Auditable**: Clear log of who did what when

### Proposed Pattern

#### Core Functions (Keep from `auth.ts`)
```typescript
// packages/core/src/auth.ts
export function getAuthenticatedUser(cookies: Cookies): AuthenticatedUser
export function getUserOrAnonymous(cookies: Cookies): User
export function requireRole(user: User, allowedRoles: Role[]): void
export function requirePermission(user: User, resource: string, action: string): void
```

#### API Handler Pattern
```typescript
// apps/site/src/pages/api/example.ts
import { getAuthenticatedUser } from '@metahuman/core';
import { getProfilePaths } from '@metahuman/core';

export const POST: APIRoute = async ({ cookies, request }) => {
  // 1. Auth check (explicit, at top)
  const user = getAuthenticatedUser(cookies); // Throws 401 if not authed

  // 2. Authorization check (explicit)
  requirePermission(user, 'memories:write'); // Throws 403 if forbidden

  // 3. Get paths (explicit, never throws)
  const paths = getProfilePaths(user.username);

  // 4. Business logic
  const data = await request.json();
  const memory = captureEvent(paths.episodic, data);

  return new Response(JSON.stringify(memory), { status: 201 });
};
```

#### Public Endpoint Pattern
```typescript
export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies); // Never throws

  if (user.role === 'anonymous') {
    // Return public data
    return new Response(JSON.stringify({ public: true }));
  }

  // Return user-specific data
  const paths = getProfilePaths(user.username);
  // ...
};
```

#### Error Handling Middleware
```typescript
// apps/site/src/middleware.ts
export const onRequest = defineMiddleware(async (context, next) => {
  try {
    return await next();
  } catch (error) {
    // Convert auth errors to proper HTTP responses
    if (error.message.startsWith('UNAUTHORIZED:')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (error.message.startsWith('FORBIDDEN:')) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw error; // Let other errors bubble up
  }
});
```

### Benefits

1. **Security**: Clear auth boundaries, fail-fast, easy to audit
2. **Maintainability**: Obvious what each endpoint requires
3. **Testability**: Mock cookies, that's it
4. **Performance**: No AsyncLocalStorage overhead
5. **Debuggability**: Clear call stack, no magic
6. **Onboarding**: Pattern is self-evident from examples

---

## Migration Plan

### Phase 1: Foundation (1-2 days)
1. ✅ `auth.ts` already exists - validate it works
2. Remove circular dependency: Extract path building to `path-builder.ts`
3. Add error-handling middleware
4. Add CSRF protection (optional but recommended)

### Phase 2: Migrate High-Risk Endpoints (2-3 days)
Priority order:
1. `/api/persona-core-manage` (writes to identity kernel)
2. `/api/capture` (writes memories)
3. `/api/tasks` (manages tasks)
4. `/api/memory-content` (edits memories)
5. `/api/agent` (starts agents)

Pattern:
```typescript
// Before:
export const POST = withUserContext(handler);

// After:
export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);
  // ... rest of handler
};
```

### Phase 3: Migrate Read-Only Endpoints (2-3 days)
- `/api/boot`
- `/api/persona-core`
- `/api/memories`
- `/api/status`
- etc. (30+ endpoints)

Pattern:
```typescript
// Before:
export const GET = withUserContext(handler);

// After:
export const GET: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);
  // ... degrade gracefully for anonymous
};
```

### Phase 4: Remove Old System (1 day)
1. Delete `apps/site/src/middleware/userContext.ts` (local wrapper)
2. Remove AsyncLocalStorage from `context.ts` (or deprecate the file)
3. Remove `withUserContext` exports from `index.ts`
4. Update `middleware.ts` to only handle errors (not set context)
5. Fix any remaining imports

### Phase 5: Testing & Documentation (1-2 days)
1. Add integration tests for auth flows
2. Document auth pattern in `CLAUDE.md`
3. Add example handlers to docs
4. Security audit of all endpoints

**Total Estimated Time**: 7-11 days (with testing)

---

## Recommendations

### Immediate (This Week)
1. 🔴 **Remove dev auto-login** - Replace with dev session script
2. 🔴 **Fix circular dependency** - Extract path building
3. 🟡 **Document current auth** - At least make it clear which system to use

### Short-Term (Next Sprint)
1. Migrate 5 high-risk endpoints to explicit auth pattern
2. Add error-handling middleware
3. Write migration guide for remaining endpoints

### Long-Term (Next Quarter)
1. Complete migration of all 74 endpoints
2. Remove AsyncLocalStorage-based context system
3. Add RBAC framework
4. Add rate limiting
5. Add audit logging for auth failures

---

## Conclusion

**Current State**: 🔴 **Not Production-Ready**
- Two competing auth systems
- Circular dependencies causing runtime errors
- Inconsistent security checks
- Difficult to maintain and test
- Dev auto-login is a security risk

**Recommended State**: ✅ **Modern, Explicit, Secure**
- Single auth pattern (explicit checks in handlers)
- Clear permission model
- Easy to test and audit
- Fast and debuggable
- Follows industry best practices (Next.js, Remix, SvelteKit patterns)

**Is this the most modern practice?** No - the AsyncLocalStorage approach is outdated (popularized ~2020, now considered anti-pattern). Modern frameworks (Next.js 13+, Remix, SvelteKit) all use **explicit request context** instead of implicit AsyncLocalStorage.

**Is this maintainable?** No - the dual system and circular dependencies make it fragile and confusing.

**Action Required**: Prioritize security refactor - the current state puts user data at risk.
