# Profile Permission Tiers Implementation Plan

## Goal
Define clear access tiers for future profiles:

1. **Admin (owner)** – full read/write across the repo, including global configs and any profile.
2. **Standard User** – full read/write inside `profiles/<username>/…`, read-only access to shared documentation (`docs/`), no access to other profiles or system config.
3. **Guest** – read-only access to `docs/` and any explicitly shared assets; cannot modify data (including their own profile directory).

## Approach Overview
- Leverage the existing security policy (`packages/core/src/security-policy.ts`) and context-aware paths (`paths.*`) to enforce per-role restrictions.
- Expand the policy to check both role and target path before allowing read/write operations (e.g., filesystem skills, API routes).
- Update middleware and skill execution to respect the new policy decisions.
- Ensure profile creation flow assigns appropriate roles and scaffolds directories with correct permissions.

## Implementation Steps

### 1. Role Definitions & Policy Updates
- Extend `SecurityPolicy` to include explicit capabilities:
  ```ts
  interface SecurityPolicy {
    canReadDocs: boolean;
    canWriteDocs: boolean;
    canReadProfile: (username: string) => boolean;
    canWriteProfile: (username: string) => boolean;
    canAccessSystemConfigs: boolean;
    // existing fields...
  }
  ```
- In `computeSecurityPolicy()`:
  - **Admin**: all booleans true; `canWriteProfile` returns true for any username.
  - **Standard user**: `canReadDocs = true`, `canWriteDocs = false`; `canReadProfile`/`canWriteProfile` return true only for the current user’s profile; `canAccessSystemConfigs = false`.
  - **Guest**: `canReadDocs = true`, `canWriteDocs = false`; `canReadProfile` returns false (unless we give them a sandbox profile) and `canWriteProfile = false`.
- Add helper functions (e.g., `policy.requireProfileWrite(username)`).

### 2. Filesystem Access Hooks
- Wrap filesystem skill inputs (`fs_read`, `fs_write`, `fs_list`, etc.) with policy checks:
  - Determine target path via `resolvePathWithFuzzyFallback`.
  - Before executing, call policy helpers to ensure the user can read/write that path:
    - If path is under `docs/`, check `canReadDocs` / `canWriteDocs`.
    - If path is under `profiles/<username>`, ensure the username matches and the policy allows it.
    - If path is elsewhere (e.g., `etc/`, repo root), block unless `canAccessSystemConfigs`.
- Return descriptive error messages when blocked.

### 3. API Layer Enforcement
- For API routes that read/write files (e.g., `/api/memory/*`, `/api/persona/*`, `/api/docs/*`), add middleware or inline checks using the policy helpers.
- Example: when saving persona core, verify `policy.canWriteProfile(currentUser.username)` before touching `paths.persona`.
- For documentation endpoints (if any), enforce `canReadDocs`.

### 4. Skill Registry Defaults
- When executing skills via operator or CLI, ensure `executeSkill()` receives the current policy (or fetches it internally) so it can enforce these restrictions uniformly.
- Add unit tests / integration tests for a guest attempting `fs_write` in docs or another profile (should fail).

### 5. Profile Creation & Role Assignment
- Update the profile creation flow (per `profile-creation-admin-flow.md`) so:
  - Admin-created profiles can be assigned `owner` or `standard` role.
  - Guest profile creation (if allowed) sets role to `guest` automatically.
- Ensure `initializeProfile()` still sets up the directories, but the role defines what the user can do afterward.

### 6. Documentation & Communication
- Document the new permission tiers in:
  - `docs/user-guide/19-multi-user-profiles.md` (add “Permissions” section).
  - `docs/user-guide/05-user-interface.md` (Security tab description).
- Mention that docs are read-only for all non-admin roles, and standard users can fully manage their own profile data.

### 7. Testing Checklist
1. Log in as admin → verify full access (modify docs, any profile).
2. Log in as standard user:
   - Can edit files under `profiles/<username>`.
   - Cannot edit `docs/` (should receive “Docs are read-only”).
   - Cannot access other profiles (attempt to read `profiles/other/*`).
3. Log in as guest:
   - Can read docs via UI but all write attempts fail.
   - Attempts to edit their assigned profile (if any) fail.
4. Run operator commands as each role to confirm skill-level enforcement.

## Notes for Implementation Agent
- Use existing `security-policy.ts` as the runtime source of truth—avoid sprinkling ad-hoc role checks.
- Ensure all path checks use normalized/resolved paths to prevent traversal.
- Update any caches or stores (e.g., `statusStore`) if they display new role info.
