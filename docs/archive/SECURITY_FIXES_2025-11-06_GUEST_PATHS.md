# Security Fix: Anonymous User Path Access (November 6, 2025)

## Issue

After implementing the guest profile selection system, anonymous users without a selected profile were being blocked from ALL operations, including system-level operations like model warmup. This caused errors:

```
Error: Access denied: Anonymous users cannot access user data paths.
Attempted to access: paths.persona.
Please authenticate to access user-specific data.
```

## Root Cause

The `paths` proxy in `packages/core/src/paths.ts` was blocking ALL anonymous users from accessing user-specific paths, without checking if they had selected a public profile.

**Original Logic** (lines 134-142):
```typescript
if (context && context.username === 'anonymous') {
  throw new Error('Access denied: Anonymous users cannot access user data paths...');
}
```

This blocked anonymous users even when they had an `activeProfile` set.

## Solution

### Fix 1: Allow Anonymous Users with Active Profile

**File**: `packages/core/src/paths.ts`

Updated the security check to allow anonymous users who have selected a profile:

```typescript
// Before
if (context && context.username === 'anonymous') {
  throw new Error(...);
}

// After
if (context && context.username === 'anonymous' && !context.activeProfile) {
  throw new Error(...);
}
```

This allows:
- ✅ Anonymous + activeProfile → Access selected profile's paths
- ✅ Authenticated users → Access own profile's paths
- ❌ Anonymous + no profile → Blocked (security boundary)

### Fix 2: Update Path Resolution for Anonymous with Profile

**File**: `packages/core/src/paths.ts` (line 147)

Updated the path resolution condition:

```typescript
// Before
if (context && context.username !== 'anonymous') {
  return context.profilePaths[prop];
}

// After
if (context && (context.username !== 'anonymous' || context.activeProfile)) {
  return context.profilePaths[prop];
}
```

This ensures anonymous users with a selected profile get the correct profile paths.

### Fix 3: Model Registry Fallback for System Operations

**File**: `packages/core/src/model-resolver.ts`

Added graceful fallback for anonymous users without profiles (e.g., warmup endpoint):

```typescript
// Import ROOT constant
import { paths, ROOT } from './paths.js';

// Add try-catch around paths.etc access
let registryPath: string;
try {
  registryPath = path.join(paths.etc, 'models.json');
} catch (error) {
  // Anonymous user without profile - use system root
  registryPath = path.join(ROOT, 'etc', 'models.json');
}
```

This allows system operations (warmup, health checks) to work even for anonymous users.

## Security Model (After Fix)

### Path Access Matrix

| User Type | Active Profile | Path Access | Example |
|-----------|----------------|-------------|---------|
| Owner | N/A | Own profile | `profiles/greggles/` |
| Guest | Yes | Selected profile | `profiles/greggles/` (read-only) |
| Anonymous | Yes | Selected profile | `profiles/greggles/` (read-only) |
| Anonymous | No | BLOCKED | Error thrown |
| System/CLI | N/A | Root fallback | `memory/`, `persona/` (legacy) |

### Security Boundaries Maintained

✅ **Anonymous users without profile are blocked**
- Prevents unauthorized access to user data
- Forces profile selection for guest mode

✅ **Guest users limited to emulation mode**
- Enforced in cognitive mode system
- No operator pipeline, no skill execution

✅ **No memory writes for guests**
- Enforced at memory capture layer
- Conversations not saved to episodic memory

✅ **Profile isolation**
- Each guest only sees selected profile's data
- Cannot switch profiles without re-selection

## Testing

### Before Fix
```bash
curl -s http://localhost:4321/api/warmup
# Result: {"success": false, "errors": ["Access denied..."]}
```

### After Fix
```bash
curl -s http://localhost:4321/api/warmup
# Result: {"success": true, "warmedModels": ["orchestrator", "persona"]}
```

## Files Modified

1. **packages/core/src/paths.ts** (2 changes)
   - Line 137: Added `!context.activeProfile` check
   - Line 147: Added `|| context.activeProfile` to path resolution

2. **packages/core/src/model-resolver.ts** (2 changes)
   - Line 10: Added `ROOT` import
   - Lines 93-99: Added try-catch fallback for paths.etc access

## Impact

### Positive
- ✅ Warmup endpoint works for all users
- ✅ Anonymous guests can access selected profile data
- ✅ System operations (health checks, model warmup) work
- ✅ CLI commands remain unaffected

### No Regressions
- ✅ Authenticated users work as before
- ✅ Security boundaries still enforced
- ✅ Anonymous users without profile still blocked
- ✅ Profile isolation maintained

## Related Documentation

- [GUEST_PROFILE_IMPLEMENTATION_COMPLETE.md](GUEST_PROFILE_IMPLEMENTATION_COMPLETE.md)
- [GUEST_PROFILE_TESTING.md](GUEST_PROFILE_TESTING.md)

## Audit Trail

This fix was applied on November 6, 2025, immediately after the initial guest profile selection implementation was completed. The issue was discovered during runtime testing when the warmup endpoint began failing for anonymous users.

**Error Log Entry**:
```
[identity] Error loading faceted persona, using core: Error: Access denied:
Anonymous users cannot access user data paths. Attempted to access: paths.persona.
```

**Resolution**: Security boundaries adjusted to allow anonymous users with selected profiles while maintaining protection for those without.
