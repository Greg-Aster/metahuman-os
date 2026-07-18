## Authentication, Profiles & Guest Access

MetaHuman OS now ships with a fully integrated authentication layer. Every request resolves inside a user context that carries role, profile paths, and session metadata. This section explains how to register owners, invite guests, manage visibility, and migrate from older single-user deployments.

---

### 1. Roles & Session Defaults

| Role        | How it is created                         | Session Length | Capabilities                                                               |
|-------------|-------------------------------------------|----------------|-----------------------------------------------------------------------------|
| **Owner**   | First account created via UI (or script)  | 24 hours       | Full read/write access to their profile; can adjust settings, trust levels, and profile visibility. |
| **Guest**   | Owner-created account (future UI) or existing credentials | 1 hour | Must authenticate via auth gate. Always forced into emulation mode with read-only access to the selected public profile. |

> **Important:** ALL users must be authenticated. There are no anonymous users in the system. Even guests require authentication through the auth gate with owner-created credentials or existing login credentials.

Session cookies (`mh_session`) are HTTPOnly. Closing the browser does not log out; use the profile menu → **Logout** to end a session immediately.

---

### 2. Creating the First Owner

1. Start the web UI:
   ```bash
   cd apps/site && pnpm dev
   # visit http://localhost:4321
   ```
2. The Authentication Gate appears after the splash screen. Choose **Create Account**.
3. Fill in the username, password, and optional display name. The first account automatically receives the `owner` role.
4. After registration you are redirected to the dashboard and a profile folder is created at `profiles/<owner>/`.

#### Legacy Installations

Upgrading from the single-user layout? Run the migration script before launching the UI:
```bash
pnpm tsx scripts/migrate-to-profiles.ts --username <owner>
```
This moves `memory/`, `persona/`, `logs/`, `etc/`, and voice-training data into `profiles/<owner>/…` while keeping shared voices under `out/voices/`.

---

### 3. Logging In & Switching Accounts

1. Open the header menu (persona name) and click **Login**.
2. Enter your username and password.
3. Owners see their visibility badge and trust controls in the left sidebar once authenticated.
4. To switch users, log out first and re-authenticate with different credentials.

---

### 4. Guest Sessions & Public Profiles

Guest accounts provide read-only access to public profiles. To use guest access:

1. **Authentication Required**: Guests must log in with credentials (owner-created account or existing credentials). There is no "Continue as Guest" option without authentication.
2. After authentication, guests are prompted to pick from **public** personas. Private profiles are hidden.
3. Once a profile is selected, the guest enters the dashboard in read-only emulation mode. Memory writes, task updates, and configuration changes are blocked by the security policy.
4. Guests can explore chat, memories, and voice outputs for that persona, but audio recordings and training samples remain private to the owner.

To make a persona available to guests, owners must mark it as **Public** (see below). Switching back to **Private** invalidates existing guest selections automatically—guests are asked to choose another profile.

---

### 5. Profile Visibility

Owners control whether their persona appears in the guest selector.

1. Navigate to **System → Settings → Profile Visibility**.
2. Choose:
   - `Private` – Hidden from guest selector (default).
   - `Public` – Visible to anonymous/guest sessions.
3. Visibility status is shown next to the profile badge in the sidebar. Changing the flag edits `profiles/<owner>/persona/core.json` metadata and the UI reflects it immediately.

> **Tip:** Voice training data remains private even when a profile is public. Only the chat and memory streams become browseable.

---

### 6. Configuration & Data Locations

- **Authentication Database:** `persona/users.json` (owner + guest credentials and metadata).
- **User Profiles:** `profiles/<username>/…` (memories, persona, logs, etc.).
- **Voice Settings:** `profiles/<username>/etc/voice.json`.
- **Shared Piper voices:** `out/voices/`.
- **Audit Logs:** `logs/audit/YYYY-MM-DD.ndjson` (capture acting user IDs).

---

### 7. CLI & Script Helpers

The CLI automatically operates under the first owner profile unless `--user <username>` is supplied. For administrative tasks that still require scripting (e.g., resetting passwords) you can interact with the user API directly.

**Complete User Management API** (`packages/core/src/users.ts`):

```typescript
import {
  // User CRUD
  createUser, getUser, getUserByUsername, listUsers, deleteUser,
  hasUsers, hasOwner, initUsers,

  // Authentication
  authenticateUser,

  // Password management
  changePassword, updatePassword, verifyUserPassword,

  // User updates
  updateUsername, updateUserMetadata, updateLastLogin,

  // Profile management
  updateProfileVisibility, listVisibleProfiles,
  updateProfileStorage, getProfileStorageConfig
} from '@metahuman/core/users';
```

**Common Operations**:

```typescript
// Create new user
const user = createUser('username', 'password', 'standard', {
  displayName: 'John Doe',
  email: 'john@example.com'
});

// List all users
const users = listUsers();  // Returns SafeUser[] (no passwords)

// Change visibility
updateProfileVisibility(userId, 'public');  // Make visible to guests

// Configure custom storage
updateProfileStorage(userId, {
  path: '/media/user/external-drive/metahuman/username',
  type: 'external',
  fallbackBehavior: 'error'
});
```

> **Warning:** Do **not** edit `persona/users.json` by hand. Use the API helpers or the forthcoming owner UI to modify user records safely.

---

### 8. Development Authentication Helper

For developers working on the codebase, repeatedly logging in can be tedious. Use the dev-session helper script:

```bash
# Create a long-lived session (30 days)
pnpm tsx scripts/dev-session.ts --username=greggles

# Output will show:
# ✅ Dev session created successfully!
# Session ID: 38d26955b5588a341b78bfee344f637341758298af02f37a72e49630682fd6b4
# 🍪 Copy this cookie value into your browser...
```

**To use the session:**
1. Open DevTools (F12)
2. Go to Application → Cookies → http://localhost:4321
3. Add cookie: `mh_session` = `<session-id-from-script>`
4. Reload the page

This eliminates authentication friction during development. The session persists for 30 days and is saved to `.env.development` for reference.

**Security Note:** Only use this on your local development machine. Never use dev sessions in production or share session IDs.

---

### 9. Troubleshooting

| Issue | Fix |
|-------|-----|
| **"Authentication required" when hitting APIs** | Ensure you are logged in. All users must be authenticated to access profile endpoints. Use the dev-session helper for local development. |
| **"Access denied" errors** | The system returns clean 401 responses for unauthenticated requests. Update your API endpoints to use `getAuthenticatedUser()` from `@metahuman/core`. |
| **Guest can't see a persona** | Confirm the owner marked the profile as `Public`. Visibility changes take effect immediately. |
| **Session expires unexpectedly** | Check system clock, review `logs/run/sessions.json`, and confirm `pnpm dev` output for validation errors. |
| **Forgot owner password** | Stop the server, run a short script using `deleteUser(userId)` then re-run `createUser()` with new credentials, or temporarily remove the entry from `persona/users.json` and restart. |
| **Legacy data still in root directories** | Re-run `pnpm tsx scripts/migrate-to-profiles.ts --username <owner>` and verify symlinks/old folders were moved. |

---

### 10. API Endpoint Authentication Patterns

For developers building API endpoints, MetaHuman OS provides explicit cookie-based authentication. All users must be authenticated - there are no anonymous users.

#### Authentication Functions

**Source**: `packages/core/src/auth.ts`

```typescript
import {
  getAuthenticatedUser,
  AuthRequiredError,
  getUserPaths,
  getProfilePaths,
  systemPaths
} from '@metahuman/core';

import { getSecurityPolicy } from '@metahuman/core/security-policy';
```

**Core Auth Functions**:

- **`getAuthenticatedUser(auth)`** - Get user from cookies (web) or session token (mobile). Throws `AuthRequiredError` if not authenticated.
- **`getUserPaths(user)`** - Get profile paths for authenticated user (resolves custom storage).
- **`getSecurityPolicy(context)`** - Resolve all permissions from cognitive mode and the persisted user role.

**Permission Model**:
- **guest**: read only
- **standard**: read + write
- **owner**: full system access

#### User Management API

**Source**: `packages/core/src/users.ts`

```typescript
import {
  createUser, getUser, getUserByUsername, listUsers, deleteUser,
  authenticateUser, changePassword, updatePassword,
  updateUsername, updateUserMetadata, updateProfileVisibility,
  getProfileStorageConfig, updateProfileStorage
} from '@metahuman/core/users';
```

**User Operations**:
- `createUser(username, password, role, metadata)` - Create user (enforces one owner, min 6 char password)
- `getUser(id)` - Get user by ID (returns SafeUser without password)
- `listUsers()` - List all users safely
- `deleteUser(id)` - Delete user (protects owner from deletion)
- `authenticateUser(username, password)` - Verify credentials

**Password Management**:
- `changePassword(userId, oldPassword, newPassword)` - User-initiated change
- `updatePassword(userId, newPassword)` - Owner-authorized password reset (no password verification inside this low-level function)

**Profile Management**:
- `updateProfileVisibility(userId, 'public' | 'private')` - Control guest access
- `updateProfileStorage(userId, config)` - Set custom storage location
- `getProfileStorageConfig(username)` - Get custom storage config (used by path resolution)

**Security**:
- bcrypt password hashing (12 rounds)
- Owner account protection
- All operations audit logged to `logs/audit/`

**For protected endpoints** (most endpoints):
```typescript
const handler: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies); // Throws AuthRequiredError if not authenticated
  const profilePaths = getProfilePaths(user.username);

  // Use profilePaths for user-specific data
  const data = fs.readFileSync(profilePaths.personaCore, 'utf-8');

  // Audit with actual username
  audit({ actor: user.username, event: 'action', ... });

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};

export const POST = requireWriteMode(handler); // Security guard applied
```

**For endpoints with graceful auth fallback** (return empty/defaults when not logged in):
```typescript
const handler: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const data = loadUserData(user.username);
    return new Response(JSON.stringify({ data }), { status: 200 });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      // Return empty/default response for unauthenticated users
      return new Response(
        JSON.stringify({ data: [], message: 'Login required' }),
        { status: 200 }
      );
    }
    throw error;
  }
};
```

**For system-level operations** (no user context needed):
```typescript
const handler: APIRoute = async () => {
  // Use systemPaths for system-wide data
  const config = loadActiveOperatorConfig();  // System-level, not per-user
  return new Response(JSON.stringify(config), { status: 200 });
};
```

#### API Endpoint Categories

1. **System-level reads**: No auth needed, use `systemPaths` (e.g., active-operator status/config)
2. **User-specific reads with fallback**: Catch `AuthRequiredError`, return empty/defaults
3. **Protected operations**: Use `getAuthenticatedUser()`, let error propagate as 401

#### Security Guards

Apply security guards without wrapper functions:
- `requireOwner(handler)` - Owner-only operations
- `requireWriteMode(handler)` - Blocks in emulation mode
- `requireOperatorMode(handler)` - Blocks in emulation mode and for non-owners

```typescript
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

export const POST = requireWriteMode(handler); // Applied directly
```

---

### 11. Security Checklist

- Keep only the intended personas public. Use private visibility when sharing the instance on a network.
- Regularly inspect `logs/audit/*.ndjson` to confirm guest sessions remain read-only.
- Use `HIGH_SECURITY=true` in `.env` to force emulation mode across all roles during demonstrations.
- Back up both `profiles/` and `persona/users.json` together—they form the complete data set.

---

### 12. Next Steps

- Learn about [Multi-User Profiles & Guest Mode](19-multi-user-profiles.md) for detailed information on persona facets, profile switching, and the special "Mutant Super Intelligence" feature.
- Review [Security & Trust](10-security-trust.md) for trust levels and directory boundaries.
- Update profile-specific configuration in [`profiles/<username>/etc/`](14-configuration-files.md).
- If you need to expose the UI remotely, follow the [Cloudflare Tunnel guide](17-cloudflare-tunnel-setup.md) after hardening credentials.
