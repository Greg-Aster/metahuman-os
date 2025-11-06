# Bug Fix: AuthGate Loop for Guest Sessions

**Date**: November 6, 2025
**Issue**: Guest users selecting a profile were immediately kicked back to the splash screen

## Problem

After successfully selecting a guest profile (e.g., "greggles"), the page would reload and immediately show the AuthGate splash screen again, preventing the guest from accessing the main app.

**User Flow**:
1. Click "Continue as Guest"
2. ProfileSelector modal appears
3. Click on "greggles" profile
4. `/api/profiles/select` updates session with activeProfile
5. `window.location.href = '/'` triggers reload
6. **AuthGate immediately shows splash screen again**

### Root Cause

The AuthGate component calls `/api/auth/me` on mount to check authentication status. For anonymous sessions, the endpoint was doing:

```typescript
const user = getUser(session.userId); // getUser('anonymous') returns null
if (!user) {
  return { user: null, role: 'anonymous' }; // Treated as not authenticated
}
```

Since there's no user record for `'anonymous'`, it returned `user: null`, which made AuthGate think the user was not authenticated and show the splash screen again.

## Solution

Updated `/api/auth/me` to recognize anonymous sessions with a selected profile and return a "virtual user" object.

### Changes to `/api/auth/me`

**File**: `apps/site/src/pages/api/auth/me.ts`

Added logic to handle anonymous sessions (lines 48-87):

```typescript
// Handle anonymous sessions with selected profile
if (session.role === 'anonymous') {
  const activeProfile = session.metadata?.activeProfile;

  if (activeProfile) {
    // Guest has selected a profile - return virtual user
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: session.userId,
          username: activeProfile, // Display selected profile name
          role: 'anonymous',
          metadata: {
            displayName: `Guest viewing ${activeProfile}`,
            activeProfile: activeProfile,
          },
        },
        role: 'anonymous',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } else {
    // Anonymous without profile - not authenticated
    return new Response(
      JSON.stringify({
        success: true,
        user: null,
        role: 'anonymous',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
```

### Virtual User Object

For guest sessions with an activeProfile, we now return:

```json
{
  "success": true,
  "user": {
    "id": "anonymous",
    "username": "greggles",
    "role": "anonymous",
    "metadata": {
      "displayName": "Guest viewing greggles",
      "activeProfile": "greggles"
    }
  },
  "role": "anonymous"
}
```

This makes AuthGate recognize the session as "authenticated" and grants access to the main app.

### Display in UI

The username will show as the selected profile name ("greggles") and the user menu will display:
- **Username**: greggles
- **Role**: ANONYMOUS
- **Display Name**: Guest viewing greggles

## Flow Comparison

### Before Fix
```
1. Guest selects "greggles" profile
2. Session updated: { userId: 'anonymous', metadata: { activeProfile: 'greggles' } }
3. Page reloads
4. AuthGate calls /api/auth/me
5. getUser('anonymous') → null
6. Returns: { user: null }
7. AuthGate: if (!data.user) → show splash screen ❌
```

### After Fix
```
1. Guest selects "greggles" profile
2. Session updated: { userId: 'anonymous', metadata: { activeProfile: 'greggles' } }
3. Page reloads
4. AuthGate calls /api/auth/me
5. Check: session.role === 'anonymous' && activeProfile exists
6. Returns: { user: { username: 'greggles', role: 'anonymous', ... } }
7. AuthGate: if (data.user) → show main app ✅
```

## Security Considerations

### Read-Only Access
Even though the virtual user is returned, all write operations are still blocked:
- Cognitive mode locked to "emulation" (enforced in cognitive-mode.ts)
- Trust level locked to "observe" (enforced in security-policy.ts)
- Memory writes disabled (enforced in memory.ts)
- Operator pipeline disabled (enforced in model-router.ts)

### Path Isolation
The guest's context still resolves to the selected profile's paths:
- `paths.episodic` → `profiles/greggles/memory/episodic/`
- `paths.persona` → `profiles/greggles/persona/`
- All data access is to the selected profile only

### Session Expiry
Anonymous sessions still expire after 30 minutes:
- Session cleaned up automatically
- Guest kicked back to splash screen on next request

## Testing

### Test Case 1: Guest Profile Selection
```bash
# 1. Create anonymous session
curl -X POST http://localhost:4321/api/auth/guest

# 2. Select profile
curl -X POST http://localhost:4321/api/profiles/select \
  -H "Cookie: mh_session=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"username":"greggles"}'

# 3. Check auth status
curl http://localhost:4321/api/auth/me \
  -H "Cookie: mh_session=SESSION_ID"

# Expected: { "user": { "username": "greggles", "role": "anonymous", ... } }
```

### Test Case 2: Anonymous Without Profile
```bash
# 1. Create anonymous session
curl -X POST http://localhost:4321/api/auth/guest

# 2. Check auth status (no profile selected)
curl http://localhost:4321/api/auth/me \
  -H "Cookie: mh_session=SESSION_ID"

# Expected: { "user": null, "role": "anonymous" }
```

### Test Case 3: Regular User
```bash
# 1. Login as owner
curl -X POST http://localhost:4321/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"greggles","password":"password"}'

# 2. Check auth status
curl http://localhost:4321/api/auth/me \
  -H "Cookie: mh_session=SESSION_ID"

# Expected: { "user": { "username": "greggles", "role": "owner", ... } }
```

## Related Fixes

This completes the guest profile selection feature:
1. **GUEST_PROFILE_IMPLEMENTATION_COMPLETE.md** - Initial implementation
2. **SECURITY_FIXES_2025-11-06_GUEST_PATHS.md** - Path access fixes
3. **BUGFIX_2025-11-06_GUEST_UI.md** - ProfileSelector z-index fix
4. **BUGFIX_2025-11-06_API_PATH_ACCESS.md** - API endpoint path handling
5. **BUGFIX_2025-11-06_AUTH_GATE_LOOP.md** - This fix (AuthGate recognition)

## Impact

### Positive
- ✅ Guest profile selection now works end-to-end
- ✅ Guests can access main app after selecting profile
- ✅ Virtual user displayed in UI with clear "Guest viewing X" label
- ✅ Security boundaries maintained (read-only, emulation mode)

### No Regressions
- ✅ Regular authenticated users unaffected
- ✅ Anonymous users without profile still blocked (as intended)
- ✅ Session expiry still works correctly
- ✅ All security checks still enforced

## Files Modified

1. **apps/site/src/pages/api/auth/me.ts**
   - Lines 48-87: Added anonymous session handling with virtual user support
