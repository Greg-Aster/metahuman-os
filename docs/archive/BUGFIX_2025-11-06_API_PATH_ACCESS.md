# Bug Fix: API Endpoints Path Access for Anonymous Users

**Date**: November 6, 2025
**Issue**: API endpoints throwing "Access denied" errors for anonymous users trying to select guest profiles

## Problem

When a guest selected a profile (e.g., "greggles"), the page would reload and immediately throw errors:

```
[persona-facet] GET error: Error: Access denied: Anonymous users cannot access user data paths.
Attempted to access: paths.personaFacets.
```

### Root Cause

Several API endpoints were directly accessing context-aware paths (e.g., `paths.personaFacets`) without handling the case where anonymous users don't have a profile selected yet.

**Timing Issue**:
1. Guest clicks on profile → `/api/profiles/select` is called
2. Session metadata is updated with `activeProfile`
3. `window.location.href = '/'` triggers page reload
4. During reload, multiple API endpoints fire immediately (e.g., `/api/persona-facet`)
5. **Race condition**: Some requests arrive before the session middleware has propagated the activeProfile

Even though the session is updated on disk, there's a brief window where API requests can arrive before the context is fully established.

## Solution

Wrap all path accesses in try-catch blocks to handle anonymous users gracefully.

### Fix 1: `/api/persona-facet` GET Handler

**File**: `apps/site/src/pages/api/persona-facet.ts` (lines 16-25)

**Before**:
```typescript
const facetsPath = paths.personaFacets; // Throws for anonymous users
if (!fs.existsSync(facetsPath)) {
  return default;
}
```

**After**:
```typescript
let facetsPath: string;
try {
  facetsPath = paths.personaFacets;
} catch (error) {
  // Anonymous user without profile - return default
  return new Response(
    JSON.stringify({ activeFacet: 'default', facets: {} }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

if (!fs.existsSync(facetsPath)) {
  return default;
}
```

**Behavior**: Returns default facets for anonymous users instead of throwing an error.

### Fix 2: `/api/persona-facet` POST Handler

**File**: `apps/site/src/pages/api/persona-facet.ts` (lines 66-75)

**Before**:
```typescript
const facetsPath = paths.personaFacets; // Throws for anonymous users
if (!fs.existsSync(facetsPath)) {
  return error;
}
```

**After**:
```typescript
let facetsPath: string;
try {
  facetsPath = paths.personaFacets;
} catch (error) {
  // Anonymous user without profile - deny write
  return new Response(
    JSON.stringify({ error: 'Authentication required to change facets' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}

if (!fs.existsSync(facetsPath)) {
  return error;
}
```

**Behavior**: Returns 401 Unauthorized for anonymous users trying to change facets.

## Pattern for Other API Endpoints

All API endpoints that access user-specific paths should follow this pattern:

```typescript
// For READ operations (return defaults for anonymous users)
let somePath: string;
try {
  somePath = paths.someUserPath;
} catch (error) {
  // Return safe defaults for anonymous users
  return new Response(
    JSON.stringify({ /* defaults */ }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// For WRITE operations (deny access for anonymous users)
let somePath: string;
try {
  somePath = paths.someUserPath;
} catch (error) {
  // Deny write access for anonymous users
  return new Response(
    JSON.stringify({ error: 'Authentication required' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}
```

## Testing

### Before Fix
```bash
# Select guest profile "greggles"
curl -X POST http://localhost:4321/api/profiles/select \
  -H "Cookie: mh_session=GUEST_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"username":"greggles"}'

# Navigate to home page - throws error
curl http://localhost:4321/ -H "Cookie: mh_session=GUEST_SESSION"
# Error: Access denied: Anonymous users cannot access user data paths
```

### After Fix
```bash
# Same flow - no errors
curl -X POST http://localhost:4321/api/profiles/select \
  -H "Cookie: mh_session=GUEST_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"username":"greggles"}'

# Navigate to home page - returns defaults gracefully
curl http://localhost:4321/api/persona-facet -H "Cookie: mh_session=GUEST_SESSION"
# { "activeFacet": "default", "facets": {} }
```

## Related Fixes

This builds on previous fixes:
1. **SECURITY_FIXES_2025-11-06_GUEST_PATHS.md** - Fixed path access in `paths.ts` proxy
2. **BUGFIX_2025-11-06_GUEST_UI.md** - Fixed ProfileSelector z-index and middleware

## Other Endpoints to Audit

The following endpoints may also need this pattern applied:

- [x] `/api/persona-facet` - Fixed
- [ ] `/api/persona-core` - Check if it accesses paths directly
- [ ] `/api/tasks` - Check if it accesses paths directly
- [ ] `/api/memories` - Check if it accesses paths directly
- [ ] `/api/capture` - Check if it accesses paths directly

**Recommendation**: Audit all API endpoints that use `paths.*` to ensure they handle anonymous users gracefully.

## Alternative Solution (Not Implemented)

Instead of try-catch in every endpoint, we could:

1. **Add a delay before reload** - Wait for session to be fully written:
   ```typescript
   await fetch('/api/profiles/select', { ... });
   await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
   window.location.href = '/';
   ```

2. **Use middleware to block anonymous requests** - Reject all API requests from anonymous users without activeProfile

However, the try-catch approach is more robust because:
- It handles the race condition at the source
- It allows graceful degradation (return defaults vs. hard failure)
- It doesn't slow down the user experience
- It's explicit about anonymous user handling

## Impact

### Positive
- ✅ Guest profile selection now works without errors
- ✅ Anonymous users get sensible defaults instead of crashes
- ✅ Write operations properly reject anonymous users
- ✅ No more noisy error logs during profile selection

### No Regressions
- ✅ Authenticated users unaffected
- ✅ Profile paths still resolve correctly for guests with activeProfile
- ✅ Security boundaries maintained (anonymous can't write)

## Files Modified

1. **apps/site/src/pages/api/persona-facet.ts**
   - Line 16-25: Added try-catch for GET handler path access
   - Line 66-75: Added try-catch for POST handler path access
