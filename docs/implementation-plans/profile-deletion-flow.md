# Profile Deletion Flow

## Goal
Add a first-class "Delete Profile" action to the MetaHuman UI so owners can safely remove obsolete accounts (including their `profiles/<name>` directory and user entry). The feature should be available in a logical location (Security or System tab) with safeguards to prevent accidental loss.

## Requirements
- Owner-only: only authenticated owners can delete profiles; guests can never delete.
- Confirmation: require the username to be typed or a checkbox acknowledging that the action is irreversible.
- Cascading cleanup:
  1. Remove the user record from `persona/users.json`.
  2. Delete `profiles/<username>/`.
  3. Remove active sessions for that user from `logs/run/sessions.json`.
- Audit log entry noting who deleted which profile.
- Post-delete UX: show success toast and refresh the profile list so the entry disappears.

## Implementation Steps

### 1. Server-Side Endpoint
- `apps/site/src/pages/api/profiles/delete.ts`
  - POST body: `{ username: string }`
  - Middleware: `withUserContext` + new `requireOwner`.
  - Validate:
    - Target profile exists (`profiles/<username>`).
    - Target is not the current session unless we add special handling.
  - Steps:
    1. Load `persona/users.json`, remove the entry, save.
    2. Remove sessions from `logs/run/sessions.json` that reference the userId.
    3. Recursively delete `profiles/<username>`.
  - Audit: `profile_deleted` with actor + username.
  - Response: `{ success: true }` or error message.

### 2. Frontend UI
- Suggested location: `System` tab (`apps/site/src/components/NetworkSettings.svelte` sibling) or `Security` tab component.
- Create a new component `ProfileDangerZone.svelte`:
  - Show a table/list of existing profiles (call `/api/profiles/list` or reuse store).
  - Each row gets a "Delete" button (disabled for `owner` or currently logged-in profile if needed).
  - Clicking opens a modal requiring the user to type the profile name.
  - On confirm, call `/api/profiles/delete`.
  - Surface success or error messages.
- Hook the component into whichever view we choose (System/Security).

### 3. Update Profile List API
- Ensure `/api/profiles/list.ts` returns role info so UI can disable deletion of owner-profile.
- Add cache busting or manual refresh after deletion.

### 4. Documentation & Messaging
- After building the feature, update:
  - `docs/user-guide/05-user-interface.md` (or the relevant section) describing where the delete option lives.
  - `docs/user-guide/19-multi-user-profiles.md` to include a "Deleting a profile" section with warnings.
- Mention that the delete action removes the filesystem directory and user entry permanently.

### 5. Testing Checklist
1. Create a throwaway profile.
2. Delete via UI.
3. Confirm the folder, user record, and sessions are removed.
4. Attempt to delete a non-existent profile → expect error.
5. Verify audit log captures the event.

## Reminder
Once implemented, **update the relevant docs under `docs/user-guide/`** (UI overview + multi-user guide) to explain the new delete flow and safety checks. Developers reading this plan should not forget this documentation step.
