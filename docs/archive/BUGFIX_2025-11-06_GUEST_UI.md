# Bug Fixes: Guest UI & Profile Visibility (November 6, 2025)

## Issues Found

### Issue 1: Profile Selector Not Showing for Guests
**Symptom**: When clicking "Continue as Guest", the API call succeeded (`/api/profiles/list` returned 200), but the ProfileSelector modal never appeared.

**Root Cause**: The ProfileSelector component was placed AFTER the `</style>` tag and OUTSIDE the main template's `{#if !isAuthenticated}` block, making it unreachable.

**Location**: `apps/site/src/components/AuthGate.svelte`

**Fix**: Moved ProfileSelector inside the main template, before the closing `{/if}`:
```svelte
<!-- Before (line 1025 - AFTER </style>) -->
</style>

{#if showProfileSelector}
  <ProfileSelector ... />
{/if}

<!-- After (line 444 - INSIDE template) -->
  </div>

  <!-- Profile Selector Modal (for guest access) -->
  {#if showProfileSelector}
    <ProfileSelector
      onSelect={handleProfileSelected}
      onCancel={handleProfileCancel}
    />
  {/if}
{/if}

<style>
```

### Issue 2: Profile Visibility Not Persisting
**Symptom**: When setting profile to "public" in SecuritySettings, the dropdown changed but the setting didn't persist. After logout/login, it reset to private.

**Root Cause**: The middleware was NOT setting `context.locals.userContext`, so API routes couldn't access the user context. The visibility API returned "Authentication required" even for logged-in users.

**Location**: `apps/site/src/middleware.ts`

**Fix**: Added `context.locals.userContext` assignment in middleware:
```typescript
// For authenticated users
context.locals.userContext = {
  userId: user.id,
  username: user.username,
  role: user.role,
  activeProfile: activeProfile,
};

// For anonymous users
context.locals.userContext = {
  userId: 'anonymous',
  username: 'anonymous',
  role: 'anonymous',
};
```

**Additional Fix**: Added TypeScript declaration for `context.locals` in `env.d.ts`:
```typescript
declare namespace App {
  interface Locals {
    userContext?: {
      userId: string;
      username: string;
      role: 'owner' | 'guest' | 'anonymous';
      activeProfile?: string;
    };
  }
}
```

## Testing

### Test 1: Guest Profile Selection
**Steps**:
1. Open browser (incognito mode)
2. Click "Continue as Guest"
3. ProfileSelector modal should appear

**Expected**: Modal shows with list of public profiles (or empty state)
**Before**: Nothing happened (modal didn't appear)
**After**: ✅ Modal appears correctly

### Test 2: Profile Visibility Persistence
**Steps**:
1. Login as owner (greggles)
2. Go to Security Settings
3. Change "Profile Visibility" to "Public"
4. Verify success message appears
5. Logout
6. Login again
7. Check Security Settings

**Expected**: Profile visibility is still "Public"
**Before**: ❌ Reset to "Private" after logout
**After**: ✅ Persists correctly (saves to `persona/users.json`)

## Files Modified

1. **apps/site/src/components/AuthGate.svelte**
   - Moved ProfileSelector inside main template (line 444)
   - Removed duplicate ProfileSelector block (was at line 1025)

2. **apps/site/src/middleware.ts**
   - Added `context.locals.userContext` assignment for authenticated users (line 35-40)
   - Added `context.locals.userContext` assignment for anonymous users (line 53-57)
   - Added activeProfile passthrough from session metadata (line 32, 44)

3. **apps/site/src/env.d.ts**
   - Added TypeScript declaration for `App.Locals.userContext` (lines 3-12)

## Verification Commands

### Check profile visibility in database:
```bash
cat persona/users.json | jq '.users[] | {username, visibility: .metadata.profileVisibility}'
```

### Test visibility API (requires authentication):
```bash
# Get visibility
curl -s http://localhost:4321/api/profiles/visibility \
  -H "Cookie: mh_session=YOUR_SESSION_ID" | jq .

# Set visibility
curl -s http://localhost:4321/api/profiles/visibility \
  -X POST \
  -H "Cookie: mh_session=YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"visibility":"public"}' | jq .
```

### Monitor audit logs:
```bash
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | jq 'select(.event == "profile_visibility_changed")'
```

## Impact

### Positive
- ✅ Guest users can now access ProfileSelector
- ✅ Profile visibility settings now persist correctly
- ✅ All API routes can now access user context via `context.locals.userContext`
- ✅ TypeScript type safety for context.locals

### No Regressions
- ✅ Authenticated users unaffected
- ✅ Session validation still works
- ✅ Security boundaries maintained
- ✅ Audit logging continues to work

## Related Documentation

- [GUEST_PROFILE_IMPLEMENTATION_COMPLETE.md](GUEST_PROFILE_IMPLEMENTATION_COMPLETE.md)
- [SECURITY_FIXES_2025-11-06_GUEST_PATHS.md](SECURITY_FIXES_2025-11-06_GUEST_PATHS.md)

## Notes

These were implementation bugs in the UI layer, not security issues. The backend APIs were functioning correctly - the problems were:
1. UI component placement (Svelte template structure)
2. Missing context propagation (Astro middleware → API routes)

Both fixes are minimal and focused on the specific issues without changing any core logic or security boundaries.
