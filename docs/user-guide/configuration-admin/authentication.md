## Authentication, Profiles & Guest Access

MetaHuman OS now ships with a fully integrated authentication layer. Every request resolves inside a user context that carries role, profile paths, and session metadata. This section explains how to register owners, invite guests, manage visibility, and migrate from older single-user deployments.

---

### 1. Roles & Session Defaults

| Role        | How it is created                         | Session Length | Capabilities                                                               |
|-------------|-------------------------------------------|----------------|-----------------------------------------------------------------------------|
| **Owner**   | First account created via UI (or script)  | 24 hours       | Full read/write access to their profile; can adjust settings, trust levels, and profile visibility. |
| **Guest**   | Owner-created account (future UI) or existing credentials | 1 hour | Always forced into emulation mode. Read-only access to the selected public profile. |
| **Anonymous** | **Continue as Guest** (no credentials) | 30 minutes     | Must choose from public profiles; cannot write or access private data. API calls touching user data return `401/403`. |

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
4. To switch users, log out first. Re-authenticate with different credentials or pick **Continue as Guest**.

---

### 4. Guest Sessions & Public Profiles

Choosing **Continue as Guest** starts a short-lived anonymous session:

1. The guest is prompted to pick from **public** personas. Private profiles are hidden.
2. Once a profile is selected, the guest enters the dashboard in read-only emulation mode. Memory writes, task updates, and configuration changes are blocked by the security policy.
3. Guests can explore chat, memories, and voice outputs for that persona, but audio recordings and training samples remain private to the owner.

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

The CLI automatically operates under the first owner profile unless `--user <username>` is supplied. For administrative tasks that still require scripting (e.g., resetting passwords) you can interact with the user API directly:

```ts
import { createUser, deleteUser, listUsers } from '@metahuman/core/users';
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
| **"Authentication required" when hitting APIs** | Ensure you are logged in. Anonymous sessions cannot access profile endpoints. Use the dev-session helper for local development. |
| **"Access denied: Anonymous users cannot access user data paths"** | This is the old error message. The new streamlined system returns clean 401 responses instead. Update your API endpoints to use `tryResolveProfilePath()` helper. See [AUTHENTICATION_STREAMLINED.md](../AUTHENTICATION_STREAMLINED.md). |
| **Guest can't see a persona** | Confirm the owner marked the profile as `Public`. Visibility changes take effect immediately. |
| **Session expires unexpectedly** | Check system clock, review `logs/run/sessions.json`, and confirm `pnpm dev` output for validation errors. |
| **Forgot owner password** | Stop the server, run a short script using `deleteUser(userId)` then re-run `createUser()` with new credentials, or temporarily remove the entry from `persona/users.json` and restart. |
| **Legacy data still in root directories** | Re-run `pnpm tsx scripts/migrate-to-profiles.ts --username <owner>` and verify symlinks/old folders were moved. |

---

### 10. API Endpoint Authentication Patterns

For developers building API endpoints, MetaHuman OS provides streamlined path resolution helpers that eliminate "anonymous user" errors:

#### Path Resolution Helpers

Instead of directly accessing `paths.*` (which throws for anonymous users), use:

```typescript
import { tryResolveProfilePath, requireProfilePath, systemPaths } from '@metahuman/core';

// For public reads (return defaults for anonymous users)
const result = tryResolveProfilePath('personaCore');
if (!result.ok) {
  return new Response(JSON.stringify({ default: 'data' }), { status: 200 });
}
const data = fs.readFileSync(result.path, 'utf-8');

// For protected operations (return 401 for anonymous users)
const result = tryResolveProfilePath('episodic');
if (!result.ok) {
  return new Response(
    JSON.stringify({ error: 'Authentication required' }),
    { status: 401 }
  );
}
fs.writeFileSync(path.join(result.path, 'event.json'), data);

// For system operations (not user-specific)
const agentPath = path.join(systemPaths.brain, 'agents', `${name}.ts`);
```

#### API Endpoint Categories

1. **Public Reads**: Degrade gracefully for anonymous users
   - Examples: `/api/boot`, `/api/persona-core` (GET)
   - Return sensible defaults instead of errors

2. **Protected Operations**: Require authentication
   - Examples: `/api/capture`, `/api/memories`, `/api/tasks`
   - Return 401 with clear error message

3. **System Operations**: Use `systemPaths` directly
   - Examples: `/api/agent`, `/api/models`, `/api/auth/*`
   - Never touch user-specific paths

See [AUTHENTICATION_STREAMLINED.md](../AUTHENTICATION_STREAMLINED.md) for complete implementation guide.

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
