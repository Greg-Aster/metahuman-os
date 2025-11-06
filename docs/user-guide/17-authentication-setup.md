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

### 8. Troubleshooting

| Issue | Fix |
|-------|-----|
| **“Authentication required” when hitting APIs** | Ensure you are logged in. Anonymous sessions cannot access profile endpoints. |
| **Guest can’t see a persona** | Confirm the owner marked the profile as `Public`. Visibility changes take effect immediately. |
| **Session expires unexpectedly** | Check system clock, review `logs/run/sessions.json`, and confirm `pnpm dev` output for validation errors. |
| **Forgot owner password** | Stop the server, run a short script using `deleteUser(userId)` then re-run `createUser()` with new credentials, or temporarily remove the entry from `persona/users.json` and restart. |
| **Legacy data still in root directories** | Re-run `pnpm tsx scripts/migrate-to-profiles.ts --username <owner>` and verify symlinks/old folders were moved. |

---

### 9. Security Checklist

- Keep only the intended personas public. Use private visibility when sharing the instance on a network.
- Regularly inspect `logs/audit/*.ndjson` to confirm guest sessions remain read-only.
- Use `HIGH_SECURITY=true` in `.env` to force emulation mode across all roles during demonstrations.
- Back up both `profiles/` and `persona/users.json` together—they form the complete data set.

---

### 10. Next Steps

- Review [Security & Trust](10-security-trust.md) for trust levels and directory boundaries.
- Update profile-specific configuration in [`profiles/<username>/etc/`](14-configuration-files.md).
- If you need to expose the UI remotely, follow the [Cloudflare Tunnel guide](17-cloudflare-tunnel-setup.md) after hardening credentials.
