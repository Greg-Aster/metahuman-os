# Testing Guide - User Registration & Security Fixes

**Date:** 2025-11-06
**Status:** Ready for Testing

---

## What Was Implemented

### 1. Complete User Registration System
- **AuthGate Component** - Splash screen with Login/Register/Guest options
- **Registration API** - `/api/auth/register` with validation and rollback
- **Profile Initialization** - Automatic directory structure and default files
- **CC BY-NC License** - Displayed on splash screen

### 2. Critical Security Fixes
- **Anonymous Context Protection** - Blocks root data access
- **Registration Rollback** - Prevents orphaned user accounts
- **Fresh Role Privileges** - No stale session privileges
- **Global Middleware** - All API routes protected automatically

---

## Quick Start Testing

### Step 1: Start the Server
```bash
cd /home/greggles/metahuman/apps/site
pnpm dev
```

### Step 2: Open Browser
Navigate to: `http://localhost:4321`

You should see the AuthGate splash screen with:
- MetaHuman OS logo
- Description
- Three buttons: Login / Create Account / Continue as Guest
- CC BY-NC license at bottom

### Step 3: Create First User (Owner)
1. Click "Create Account"
2. Fill in form:
   - Username: `greggles` (or your choice)
   - Display Name: `Greg` (optional)
   - Email: (optional)
   - Password: At least 6 characters
   - Confirm Password: Must match
3. Click "Create Account"
4. Should automatically log in and show main app
5. Check terminal - should see profile created

### Step 4: Verify Profile Created
```bash
# Check profile directory exists
ls -la profiles/greggles/

# Should show:
# - memory/
# - persona/
# - out/
# - logs/
# - etc/

# Check default persona
cat profiles/greggles/persona/core.json

# Check audit log
tail -f logs/audit/$(date +%Y-%m-%d).ndjson
```

---

## Security Testing

### Test 1: Anonymous User Cannot Access Data

```bash
# In incognito/private window, visit:
http://localhost:4321

# Click "Continue as Guest"
# Main app should load but...

# Open browser console
# Try to access memories or persona
# Should see errors: "Access denied: Anonymous users cannot access user data paths"
```

**Expected Result:** Anonymous users can see UI but cannot read/write any user data

### Test 2: Registration Rollback on Failure

```bash
# Simulate disk full by making profiles read-only
sudo chmod -R 555 profiles/

# Try to register new user
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testfail",
    "password": "test123"
  }'

# Should return error: "Failed to initialize profile"

# Check user was NOT created
cat persona/users.json | jq '.users[] | select(.username == "testfail")'
# Should be empty

# Check audit log for rollback event
grep "registration_rollback" logs/audit/$(date +%Y-%m-%d).ndjson

# Cleanup
sudo chmod -R 755 profiles/
```

**Expected Result:** Failed registrations don't leave orphaned user accounts

### Test 3: Role Changes Take Effect Immediately

```bash
# 1. Create test user
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "roletest",
    "password": "test123"
  }' \
  -c cookies.txt

# 2. Check role
curl -X GET http://localhost:4321/api/auth/me \
  -b cookies.txt | jq .user.role
# Should show: "guest"

# 3. Change role in database
# Edit persona/users.json manually:
# Find roletest user, change role from "guest" to "owner"

# 4. Check again with SAME cookie
curl -X GET http://localhost:4321/api/auth/me \
  -b cookies.txt | jq .user.role
# Should immediately show: "owner"
```

**Expected Result:** Role changes propagate to active sessions immediately

---

## Feature Testing

### Test 4: Login Flow

```bash
# Logout or use new browser
# Visit http://localhost:4321
# Click "Login"
# Enter:
#   Username: greggles
#   Password: (your password)
# Click "Sign In"
# Should log in and show main app
```

### Test 5: Multiple Users

```bash
# Create second user (will be guest)
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "alice123",
    "displayName": "Alice Smith",
    "email": "alice@example.com"
  }'

# Check profile created
ls -la profiles/alice/

# Check role is guest (not owner)
cat persona/users.json | jq '.users[] | select(.username == "alice") | .role'
# Should show: "guest"
```

### Test 6: Profile Isolation

```bash
# Login as greggles, create a memory
curl -X POST http://localhost:4321/api/capture \
  -b greggles-cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"content": "Greggles secret memory"}'

# Login as alice, search for memory
curl -X GET "http://localhost:4321/api/remember?q=secret" \
  -b alice-cookies.txt

# Should NOT find greggles' memory
```

**Expected Result:** Users have completely isolated data

---

## Error Handling Testing

### Test 7: Validation Errors

Test each validation rule:

```bash
# Username too short
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "ab", "password": "test123"}'
# Expected: 400 "Username must be 3-50 characters"

# Username with invalid chars
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type": application/json" \
  -d '{"username": "test@user", "password": "test123"}'
# Expected: 400 "Username can only contain letters, numbers..."

# Password too short
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "12345"}'
# Expected: 400 "Password must be at least 6 characters"

# Duplicate username
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "greggles", "password": "test123"}'
# Expected: 409 "Username 'greggles' already exists"
```

### Test 8: Password Mismatch in UI

1. Go to registration form
2. Enter password: `test123`
3. Enter confirm: `test456`
4. Click submit
5. Should show error: "Passwords do not match"

---

## What to Look For

### In Browser Console
- ✅ No errors on splash screen load
- ✅ AuthGate component renders
- ✅ Form submissions work
- ✅ Automatic redirect after registration/login

### In Terminal (Dev Server)
- ✅ Profile initialization messages
- ✅ No "Access denied" errors for authenticated users
- ✅ "Access denied" errors for anonymous users (expected)
- ✅ Registration rollback messages (if you test failure scenario)

### In Audit Logs
```bash
# Watch audit log in real-time
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | jq .

# Look for these events:
# - user_registered
# - profile_initialized
# - user_logged_in
# - registration_rollback (if testing failures)
```

### In File System
```bash
# Check profile structure
tree profiles/greggles/ -L 2

# Should show:
profiles/greggles/
├── etc/              # Config files
├── logs/             # User logs
├── memory/           # Memories
├── out/              # Outputs
└── persona/          # Identity
```

---

## Known Behaviors

### Anonymous Users
- ✅ Can see splash screen
- ✅ Can see UI after "Continue as Guest"
- ❌ Cannot save memories
- ❌ Cannot access any user data paths
- ✅ Get clear error messages

### Guest Users
- ✅ Full profile with all features
- ✅ Can save memories
- ✅ Cannot switch profiles
- ✅ Cannot create other users

### Owner Users
- ✅ Full system access
- ✅ Can switch profiles (future feature)
- ✅ Can manage other users (future feature)

---

## Troubleshooting

### "Failed to initialize profile"
- Check disk space: `df -h`
- Check permissions: `ls -la profiles/`
- Check audit log: `grep profile_initialization_failed logs/audit/*.ndjson`

### "Access denied: Anonymous users..."
- This is expected for anonymous users
- Indicates security is working correctly
- Authenticate to access user data

### "Username already exists"
- User wasn't properly rolled back from failed registration
- Check: `cat persona/users.json | jq .users`
- Manually remove orphaned user if needed

### Session not persisting
- Check cookies in browser DevTools
- Look for `mh_session` cookie
- Check expiry (should be 24 hours)
- Try clearing cookies and re-logging in

---

## Next Steps After Testing

If all tests pass:

1. **Commit changes** with descriptive message
2. **Update CHANGELOG.md** with new features
3. **Deploy to production** (if applicable)
4. **Monitor audit logs** for first week

If issues found:

1. **Document the issue** with steps to reproduce
2. **Check audit logs** for relevant events
3. **Review security fixes doc** for edge cases
4. **Test rollback** if needed

---

## Files to Review

```
docs/USER_REGISTRATION_WORKFLOW.md    - Complete feature documentation
docs/SECURITY_FIXES_2025-11-06.md     - Security analysis and fixes
apps/site/src/components/AuthGate.svelte  - UI component
apps/site/src/middleware.ts           - Global middleware
packages/core/src/profile.ts          - Profile initialization
apps/site/src/pages/api/auth/register.ts  - Registration endpoint
```

---

**Status:** Ready for testing
**Priority:** High (security fixes)
**Estimated Testing Time:** 30-45 minutes
