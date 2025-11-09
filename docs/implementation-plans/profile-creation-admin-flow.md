# Owner Profile Creation & Promotion Plan

## Problem
The current “Create Profile” affordance only copies persona files for the shared guest account. It does **not** mint a real user account, so new profiles cannot authenticate or access operator-level features. We need an owner-only workflow that actually creates users + profile directories and lets owners promote existing profiles to full access.

## Goals
- Owner can create a new user+profile from the UI without SSHing.
- New profile receives the full `profiles/<username>/` scaffold (persona configs, etc) and a login credential.
- Owner can choose the role (`owner`, `guest`, or future `admin`) per profile.
- Existing “directory-only” profiles can be repaired/promoted so they show up in `persona/users.json`.
- Update docs to explain the new flow.

## Implementation Steps

### 1. Backend API (`/api/profiles/create`)
- Location: `apps/site/src/pages/api/profiles/create.ts`.
- Guard with `withUserContext` + `requireOwner`.
- Request body:
  ```json
  {
    "username": "alex",
    "password": "secret",
    "displayName": "Alex",
    "email": "alex@example.com",
    "role": "owner" | "guest"
  }
  ```
- Validate uniqueness, password length, username format.
- Call `createUser()` → `initializeProfile()`; rollback user if profile init fails (reuse register logic).
- Return generated userId and role.
- Audit event `profile_created`.

### 2. UI (Security tab)
- Add a “Create Profile” card in `SecuritySettings.svelte` (owner-only section).
- Form fields: username, display name, email, password (with confirmation), role select.
- POST to `/api/profiles/create`; show success/error states.
- After success, refresh profile list (so `ProfileDangerZone` + selectors see it).

### 3. Promotion API (`/api/profiles/promote`)
- Allows owner to change a user’s role (guest → owner).
- Body: `{ username, role }`.
- Guard + audit.
- Update `persona/users.json` entry and consider forcing logout of active sessions.
- UI: table row action (e.g., dropdown in `ProfileDangerZone`) labeled “Change Role”.

### 4. Session Updates
- When owner creates/promotes a profile, optionally send a password reset link or show generated password.
- Consider adding “reset password” button per profile (future work).

### 5. Repair Existing Profiles
- Reuse `scripts/repair-profiles.ts` to ensure directories/configs exist.
- Add a new script `scripts/add-user-for-profile.ts` that:
  - Takes `--username foo --role owner --password auto`
  - Creates missing user entry referencing existing `profiles/foo`.
- Document running both scripts after deploying the new feature.

### 6. Docs
- Update `docs/user-guide/19-multi-user-profiles.md` with a “Creating a Profile” section describing the new form and role selection.
- Update `docs/user-guide/05-user-interface.md` (Security tab) to mention the Create Profile card and promotion controls.
- Mention CLI scripts in `profiles/README.md` for repairing legacy entries.

### 7. Testing
1. Create a new profile via UI → verify login works and operator access honored.
2. Create guest profile → ensure it shows up in selector but stays limited.
3. Promote/demote users and confirm `/api/operator/react` respects the new role immediately.
4. Run `scripts/repair-profiles.ts` + `scripts/add-user-for-profile.ts` on sample dirs.

## Notes for Implementer
- Reuse existing validation helpers from `/api/auth/register`.
- Never allow deleting/promoting the currently logged-in owner within the same call (avoid lockout).
- Remember to hash any auto-generated passwords before returning (or display only once and never log).
