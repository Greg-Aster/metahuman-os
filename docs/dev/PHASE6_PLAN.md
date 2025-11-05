# Phase 6: Authentication & Multi-User Support - PLANNING

**Start Date:** 2025-11-05
**Estimated Time:** 8-12 hours
**Goal:** Enable multi-user access with proper authentication and role-based permissions

---

## Overview

Phase 6 adds authentication and session management to MetaHuman OS, enabling:

1. **Multiple Users** - Owner, guest, and anonymous roles with different permissions
2. **Session Management** - Secure session tokens with expiration
3. **Login/Logout** - Authentication flow with password hashing
4. **Real Permissions** - Remove temporary "everyone is owner" hack
5. **Internet Safety** - Prepare for public deployment

---

## Current State (Phase 5)

### What Works
- ✅ Security policy system with role-based permissions
- ✅ All local users treated as "owner" (temporary)
- ✅ Mode-based restrictions (dual/agent/emulation)
- ✅ HTTP middleware for operator protection
- ✅ Comprehensive test suite (37 tests passing)

### What's Missing
- ❌ No authentication system
- ❌ No session management
- ❌ No user database
- ❌ No login/logout flow
- ❌ Guest users have full access (everyone is owner)
- ❌ Not safe for internet deployment

---

## Architecture Design

### 1. User Management

**User Schema:**
```typescript
interface User {
  id: string;           // UUID
  username: string;     // Unique username
  passwordHash: string; // bcrypt hash
  role: 'owner' | 'guest';
  createdAt: string;
  lastLogin?: string;
  metadata?: {
    displayName?: string;
    email?: string;
  };
}
```

**Storage:**
- File: `persona/users.json`
- Format: Array of User objects
- Owner user created on first run

**Owner Account:**
- Created during `mh init` or first web access
- Prompted for username/password on first run
- Only owner can create/delete users
- Only owner can change modes/trust levels

### 2. Session Management

**Session Schema:**
```typescript
interface Session {
  id: string;           // UUID session token
  userId: string;       // User ID
  role: 'owner' | 'guest' | 'anonymous';
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  metadata?: {
    userAgent?: string;
    ip?: string;
  };
}
```

**Storage:**
- File: `logs/run/sessions.json`
- Format: Array of Session objects
- Cleaned up on expiration (24h for owner, 1h for guest)

**Session Cookie:**
- Name: `mh_session`
- HttpOnly: true
- SameSite: 'strict'
- Secure: true (when HTTPS)
- Path: '/'

### 3. Anonymous Access

**Anonymous Sessions:**
- No cookie/login required
- Read-only access in emulation mode
- Cannot write memories
- Cannot use operator
- Cannot change modes

**Use Cases:**
- Party demos (emulation mode)
- Public kiosk mode
- Quick preview without account

### 4. Authentication Flow

**Login Process:**
```
1. User submits username/password to /api/auth/login
2. Backend validates credentials (bcrypt compare)
3. Create session with expiration
4. Set session cookie
5. Return user info (without password hash)
6. Redirect to home page
```

**Logout Process:**
```
1. User clicks logout or calls /api/auth/logout
2. Backend deletes session from sessions.json
3. Clear session cookie
4. Redirect to login page
```

**Session Validation:**
```
1. Every request includes session cookie
2. extractSession() reads cookie value
3. Look up session in sessions.json
4. Check if expired (delete if so)
5. Update lastActivity timestamp
6. Return SessionInfo with role
```

---

## Implementation Plan

### Step 1: User Management Core
**Files to Create:**
- `packages/core/src/users.ts` - User CRUD operations
- `persona/users.json` - User storage (created on init)

**Functions:**
```typescript
// User management
export function initUsers(): void
export function createUser(username: string, password: string, role: 'owner' | 'guest'): User
export function authenticateUser(username: string, password: string): User | null
export function getUser(id: string): User | null
export function listUsers(): User[]
export function deleteUser(id: string): void
export function updateLastLogin(userId: string): void
```

### Step 2: Session Management Core
**Files to Create:**
- `packages/core/src/sessions.ts` - Session CRUD operations
- `logs/run/sessions.json` - Session storage

**Functions:**
```typescript
// Session management
export function createSession(userId: string, role: 'owner' | 'guest', metadata?: any): Session
export function getSession(sessionId: string): Session | null
export function validateSession(sessionId: string): Session | null // Checks expiration
export function deleteSession(sessionId: string): void
export function cleanupExpiredSessions(): void
export function listActiveSessions(): Session[]
```

### Step 3: Authentication Middleware
**Files to Modify:**
- `packages/core/src/security-policy.ts` - Update extractSession()

**Changes:**
```typescript
function extractSession(context?: any): SessionInfo | null {
  // Read session cookie from context
  const sessionCookie = context?.cookies?.get('mh_session');

  if (!sessionCookie) {
    // No cookie = anonymous
    return { role: 'anonymous', id: undefined };
  }

  // Validate session
  const session = validateSession(sessionCookie.value);

  if (!session) {
    // Invalid/expired session = anonymous
    return { role: 'anonymous', id: undefined };
  }

  // Return session info
  return {
    role: session.role,
    id: session.userId,
    email: undefined, // TODO: Add email to user schema
  };
}
```

### Step 4: Authentication API Endpoints
**Files to Create:**
- `apps/site/src/pages/api/auth/login.ts` - POST login
- `apps/site/src/pages/api/auth/logout.ts` - POST logout
- `apps/site/src/pages/api/auth/me.ts` - GET current user
- `apps/site/src/pages/api/auth/users.ts` - GET/POST user management (owner only)

**Endpoints:**

#### POST /api/auth/login
```typescript
Request:
{
  username: string;
  password: string;
}

Response (200 OK):
{
  success: true;
  user: {
    id: string;
    username: string;
    role: 'owner' | 'guest';
  };
}

Response (401 Unauthorized):
{
  success: false;
  error: 'Invalid credentials';
}
```

#### POST /api/auth/logout
```typescript
Response (200 OK):
{
  success: true;
}
```

#### GET /api/auth/me
```typescript
Response (200 OK):
{
  success: true;
  user: {
    id: string;
    username: string;
    role: 'owner' | 'guest';
  } | null;
}
```

#### GET /api/auth/users (owner only)
```typescript
Response (200 OK):
{
  success: true;
  users: User[];
}

Response (403 Forbidden):
{
  success: false;
  error: 'Owner role required';
}
```

#### POST /api/auth/users (owner only)
```typescript
Request:
{
  username: string;
  password: string;
  role: 'owner' | 'guest';
}

Response (200 OK):
{
  success: true;
  user: User;
}
```

### Step 5: UI Components
**Files to Create:**
- `apps/site/src/pages/login.astro` - Login page
- `apps/site/src/components/LoginForm.svelte` - Login form component
- `apps/site/src/components/UserMenu.svelte` - User dropdown menu

**Files to Modify:**
- `apps/site/src/components/ChatLayout.svelte` - Add user menu to header
- `apps/site/src/middleware/index.ts` - Redirect to login if not authenticated

**Login Page:**
- Simple username/password form
- "Login" button
- Error message display
- Redirect to home on success

**User Menu:**
- Shows current user (username, role)
- Logout button
- User management (owner only)
- Appears in header next to mode selector

### Step 6: Middleware & Guards
**Files to Create:**
- `apps/site/src/middleware/auth.ts` - Authentication middleware

**Logic:**
```typescript
// Redirect to login if accessing protected pages without session
// Allow anonymous access to:
// - /login
// - /api/auth/login
// - /api/security/policy (read-only)
// - /api/cognitive-mode GET (read mode)
// - Any page in emulation mode (read-only)

// Require authentication for:
// - /api/capture (write)
// - /api/tasks POST/PATCH (write)
// - /api/operator (write)
// - /api/cognitive-mode POST (config change)
// - /api/auth/users (user management)
```

### Step 7: First-Run Setup
**Files to Create:**
- `apps/site/src/pages/setup.astro` - First-run setup page
- `apps/site/src/components/SetupWizard.svelte` - Setup wizard

**Flow:**
1. Check if `persona/users.json` exists
2. If not, redirect to `/setup`
3. Setup wizard:
   - Welcome message
   - Create owner account (username/password)
   - Choose default cognitive mode
   - Create first user
4. Initialize `persona/users.json`
5. Redirect to login

---

## Security Considerations

### Password Storage
- Use `bcrypt` for password hashing (12 rounds)
- Never store plaintext passwords
- Never return password hashes in API responses

### Session Security
- Generate cryptographically secure session IDs (UUID v4)
- Store sessions server-side (not JWT client-side)
- Expire sessions after 24h (owner) or 1h (guest)
- Clear session on logout
- HttpOnly cookies (prevent XSS)

### Rate Limiting
- Limit login attempts (5 per minute per IP)
- Lock account after 10 failed attempts (owner protection)
- Exponential backoff on failures

### HTTPS Enforcement
- Recommend HTTPS in production
- Warn if running HTTP on non-localhost
- Secure cookies only on HTTPS

---

## Testing Strategy

### Unit Tests
- User CRUD operations
- Session CRUD operations
- Password hashing/verification
- Session validation and expiration

### Integration Tests
- Login flow (success/failure)
- Logout flow
- Session cookie handling
- Anonymous access restrictions
- Guest user restrictions
- Owner permissions

### Manual Testing
- First-run setup wizard
- Login page
- User menu
- User management (owner)
- Anonymous read-only access
- Guest write restrictions

---

## Migration Path

### Phase 5 → Phase 6 Transition

**Breaking Changes:**
- Remove temporary "everyone is owner" from `extractSession()`
- Anonymous users now have limited permissions
- Existing sessions will be invalid (force re-login)

**Upgrade Steps:**
1. Run `mh init` to create owner account (if upgrading)
2. Set username/password for owner
3. Restart dev server
4. Login at `/login`
5. Continue using system normally

**Backward Compatibility:**
- CLI commands still work (treated as owner for local use)
- Local file operations bypass HTTP layer
- Existing memories/tasks not affected

---

## Dependencies

### New NPM Packages
- `bcrypt` or `bcryptjs` - Password hashing
- `uuid` - Session ID generation (may already be installed)
- `cookie` - Cookie parsing (Astro provides this)

### Existing Packages
- Astro cookie API (`context.cookies`)
- TypeScript
- Svelte

---

## Success Criteria

Phase 6 is complete when:

- [ ] Owner account can be created on first run
- [ ] Login/logout flow works
- [ ] Sessions are validated on each request
- [ ] Anonymous users are read-only in emulation mode
- [ ] Guest users cannot change modes or use operator
- [ ] Owner can create/delete guest users
- [ ] All Phase 5 tests still pass
- [ ] New authentication tests pass
- [ ] UI shows current user and logout option
- [ ] System is safe for internet deployment (with HTTPS)

---

## Timeline Estimate

| Task | Estimated Time |
|------|---------------|
| User management core | 1-2 hours |
| Session management core | 1-2 hours |
| Authentication API endpoints | 2-3 hours |
| Update security policy | 1 hour |
| UI components (login, user menu) | 2-3 hours |
| First-run setup wizard | 1-2 hours |
| Testing and debugging | 2-3 hours |
| Documentation | 1 hour |

**Total: 8-12 hours**

---

## Next Steps

1. Create user management module (`packages/core/src/users.ts`)
2. Create session management module (`packages/core/src/sessions.ts`)
3. Update `extractSession()` in security-policy.ts
4. Create authentication API endpoints
5. Build login UI
6. Build first-run setup wizard
7. Add comprehensive tests
8. Document Phase 6 completion

Let's get started! 🚀
