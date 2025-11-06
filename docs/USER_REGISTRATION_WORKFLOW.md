# User Registration & Authentication Workflow

**Date:** 2025-11-06
**Status:** ✅ Complete - Ready for Testing

---

## Overview

Implemented a complete user registration and authentication system with an authentication gate that blocks access to MetaHuman OS until users either:
1. **Login** with existing credentials
2. **Create a new account** (first user becomes owner)
3. **Continue as Guest** (anonymous, read-only access)

---

## What Was Implemented

### 1. **User Registration API** (`/api/auth/register`)

**File:** `apps/site/src/pages/api/auth/register.ts`

**Features:**
- Validates username format (letters, numbers, underscore, hyphen only)
- Validates username length (3-50 characters)
- Enforces password strength (minimum 6 characters)
- First user automatically becomes **owner**, subsequent users are **guests**
- Initializes complete profile directory structure
- Creates session cookie and logs user in automatically
- Full audit logging

**Request:**
```json
POST /api/auth/register
{
  "username": "alice",
  "password": "securepass123",
  "displayName": "Alice Smith",  // optional
  "email": "alice@example.com"   // optional
}
```

**Response (Success):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "alice",
    "role": "guest",
    "metadata": {
      "displayName": "Alice Smith",
      "email": "alice@example.com"
    }
  },
  "message": "Account created successfully!"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Username 'alice' already exists"
}
```

---

### 2. **Profile Initialization System**

**File:** `packages/core/src/profile.ts`

**New Functions:**

#### `initializeProfile(username: string)`
Creates complete directory structure and default files for new user:

**Directory Structure Created:**
```
profiles/{username}/
├── memory/
│   ├── episodic/           # Timeline of events
│   ├── tasks/
│   │   ├── active/
│   │   ├── completed/
│   │   └── projects/
│   ├── inbox/              # File ingestion
│   │   └── _archive/
│   ├── index/              # Vector embeddings
│   └── calendar/
├── persona/                # Identity files
│   ├── core.json          # Main personality
│   ├── facets.json        # Personality facets
│   ├── relationships.json
│   ├── routines.json
│   └── decision-rules.json
├── out/                    # Generated outputs
│   ├── adapters/          # LoRA adapters
│   ├── datasets/          # Training data
│   └── state/
├── logs/                   # User-specific logs
│   ├── audit/
│   ├── decisions/
│   └── actions/
└── etc/                    # User configuration
    ├── cognitive-mode.json
    ├── models.json
    ├── training.json
    ├── boredom.json
    ├── sleep.json
    ├── audio.json
    ├── ingestor.json
    └── autonomy.json
```

**Default Persona Created:**
```json
{
  "identity": {
    "name": "username",
    "role": "Digital personality extension",
    "purpose": "Mirror and extend the capabilities of the user"
  },
  "personality": {
    "communicationStyle": {
      "tone": ["helpful", "authentic", "thoughtful"],
      "verbosity": "balanced",
      "emphasis": "clarity and usefulness"
    },
    "traits": {
      "openness": 0.75,
      "conscientiousness": 0.7,
      "extraversion": 0.5,
      "agreeableness": 0.7,
      "neuroticism": 0.3
    }
  },
  "values": {
    "core": [
      {"value": "autonomy", "description": "Act with agency while respecting user intent"},
      {"value": "transparency", "description": "Make decisions visible and auditable"},
      {"value": "growth", "description": "Continuously learn and improve"}
    ]
  }
}
```

**Default Configuration:**
- **Cognitive Mode:** `dual` (default operational mode)
- **Model Preferences:** Inherits system defaults
- **Training Config:** Qwen3-Coder-30B base model, LoRA rank 8
- **Boredom Service:** 30-minute reflection interval
- **Sleep Schedule:** 2 AM - 8 AM (America/New_York)
- **Audio:** Disabled by default
- **Autonomy Level:** `suggest` (requires approval for most actions)

#### `profileExists(username: string)`
Checks if a profile directory exists for a user.

#### `deleteProfile(username: string, confirm: boolean)`
Deletes a user's profile (requires explicit confirmation flag).

---

### 3. **Authentication Gate Component**

**File:** `apps/site/src/components/AuthGate.svelte`

**Replaces:** Old SplashScreen component (which was just a dismissible welcome modal)

**Three Views:**

#### A. **Splash Screen** (Initial View)
- Shows MetaHuman OS logo and description
- Displays persona info from `/api/boot`
- Three action buttons:
  - **Login** → Shows login form
  - **Create Account** → Shows registration form
  - **Continue as Guest** → Grants anonymous access

#### B. **Login Form**
- Username field
- Password field
- Error display
- "Don't have an account? Create one" link
- Back button to return to splash

#### C. **Registration Form**
- Username field (with pattern validation)
- Display Name field (optional)
- Email field (optional)
- Password field (minimum 6 characters)
- Confirm Password field (must match)
- Error display
- "Already have an account? Sign in" link
- Back button to return to splash

**Features:**
- Blocks main app until authenticated
- Auto-reloads page after successful login/registration
- Guest mode allows immediate access (read-only)
- Beautiful gradient design matching MetaHuman OS aesthetic
- Fully responsive (mobile-friendly)
- Dark mode support

---

## Technical Details

### Dependencies Added
- `fs-extra` - For async file system operations with extra utilities
- `@types/fs-extra` - TypeScript definitions

### Core Package Exports
Updated `packages/core/src/index.ts` to export:
```typescript
export * from './profile';  // New profile management module
```

### Integration Points

**1. Registration Flow:**
```
User fills form → POST /api/auth/register → createUser() → initializeProfile() → createSession() → Set cookie → Reload page
```

**2. Profile Initialization:**
```
initializeProfile(username) → Create directories → Create default persona → Create default configs → Audit log
```

**3. Path Resolution:**
The existing multi-user context system (from `packages/core/src/context.ts`) automatically resolves paths to the correct user profile when a session is active.

---

## Testing Checklist

### Manual Testing Steps

#### 1. **First User Registration (Owner)**
```bash
# Start dev server
pnpm dev

# Navigate to http://localhost:4321
# Should see AuthGate splash screen

# Click "Create Account"
# Fill form:
#   Username: greggles
#   Display Name: Greg
#   Password: password123
#   Confirm: password123
# Click "Create Account"

# Expected:
# - Account created
# - Automatically logged in
# - Page reloads and shows main app
# - User has owner role

# Verify profile created:
ls -la profiles/greggles/
cat profiles/greggles/persona/core.json
cat profiles/greggles/etc/cognitive-mode.json
```

#### 2. **Second User Registration (Guest)**
```bash
# Logout (or open incognito window)
# Navigate to http://localhost:4321
# Click "Create Account"
# Fill form with different username
# Click "Create Account"

# Expected:
# - Account created with guest role
# - Cannot switch profiles (only owner can)
# - Has own isolated profile directory
```

#### 3. **Login with Existing User**
```bash
# Logout
# Navigate to http://localhost:4321
# Click "Login"
# Enter credentials
# Click "Sign In"

# Expected:
# - Successful login
# - Redirected to main app
# - Session cookie set
```

#### 4. **Continue as Guest**
```bash
# Navigate to http://localhost:4321
# Click "Continue as Guest"

# Expected:
# - Immediate access to app
# - Read-only mode (cannot save memories)
# - No user profile loaded
```

#### 5. **Error Handling**
Test validation:
- Username too short (< 3 chars) → Error
- Username with invalid chars → Error
- Password too short (< 6 chars) → Error
- Passwords don't match → Error
- Username already exists → Error "Username 'x' already exists"
- Wrong password on login → Error "Invalid username or password"

### API Testing

```bash
# Test registration endpoint
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "test1234",
    "displayName": "Test User",
    "email": "test@example.com"
  }'

# Expected: 201 Created with user object

# Test duplicate username
curl -X POST http://localhost:4321/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "test1234"
  }'

# Expected: 409 Conflict with error message

# Test login endpoint
curl -X POST http://localhost:4321/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "test1234"
  }' \
  -c cookies.txt

# Expected: 200 OK with user object and session cookie
```

### Profile Verification

```bash
# After creating user "alice"
tree profiles/alice/

# Should show complete directory structure

# Check default persona
cat profiles/alice/persona/core.json | jq .

# Check default config
cat profiles/alice/etc/cognitive-mode.json | jq .
cat profiles/alice/etc/models.json | jq .

# Verify audit log
cat logs/audit/$(date +%Y-%m-%d).ndjson | grep user_registered
cat logs/audit/$(date +%Y-%m-%d).ndjson | grep profile_initialized
```

---

## Security Considerations

### Implemented
✅ **Password Hashing** - bcrypt with 12 rounds
✅ **Username Validation** - Only alphanumeric, underscore, hyphen
✅ **Password Strength** - Minimum 6 characters
✅ **Session Management** - HttpOnly cookies, SameSite=strict
✅ **Audit Logging** - All registration/login events logged
✅ **Profile Isolation** - Each user has separate directory
✅ **Role-Based Access** - Owner vs Guest vs Anonymous

### Future Enhancements
- Rate limiting for registration/login attempts
- Email verification
- Password reset functionality
- Two-factor authentication
- Account deletion by users
- Profile export/import

---

## File Summary

### New Files Created
```
apps/site/src/pages/api/auth/register.ts       (143 lines) - Registration endpoint
apps/site/src/components/AuthGate.svelte       (710 lines) - Auth UI component
packages/core/src/profile.ts                   (291 lines) - Profile management
docs/USER_REGISTRATION_WORKFLOW.md             (This file) - Documentation
```

### Files Modified
```
apps/site/src/pages/index.astro                - Use AuthGate instead of SplashScreen
packages/core/src/index.ts                     - Export profile module
packages/core/src/paths.ts                     - Fix require() → import
package.json (root)                            - Add fs-extra dependency
```

### Dependencies Added
```
fs-extra@^11.3.2                               - Async file operations
@types/fs-extra@^11.0.4                        - TypeScript types
```

---

## User Experience Flow

### First Time Visit (No Users Exist)
```
1. User visits http://localhost:4321
2. AuthGate shows splash screen
3. User clicks "Create Account"
4. Fills registration form
5. Submits → Account created (role: owner)
6. Page reloads → Main app visible
7. User can now use all features
```

### Returning User
```
1. User visits http://localhost:4321
2. AuthGate checks for existing session
3. If session valid → Skip to main app
4. If no session → Show splash screen
5. User clicks "Login"
6. Enters credentials → Session created
7. Page reloads → Main app visible
```

### Guest User
```
1. User visits http://localhost:4321
2. Clicks "Continue as Guest"
3. Immediate access to main app
4. Read-only mode (no memory saving)
5. No profile directory created
```

---

## Architecture Integration

### Multi-User Context System
The new registration system integrates seamlessly with the existing multi-user infrastructure:

- **Context Management** (`packages/core/src/context.ts`) - Already exists
- **Dynamic Paths** (`packages/core/src/paths.ts`) - Already exists
- **User Sessions** (`packages/core/src/sessions.ts`) - Already exists
- **User Database** (`persona/users.json`) - Already exists
- **Profile Initialization** (`packages/core/src/profile.ts`) - ✅ NEW

When a user logs in or registers:
1. Session created with userId, username, role
2. Session cookie set in browser
3. All API requests include session cookie
4. Middleware sets user context for request
5. `paths` proxy automatically resolves to `profiles/{username}/`
6. All memory/persona operations use user's profile

---

## Next Steps

### Immediate Testing
1. Test user registration flow
2. Test login flow
3. Verify profile directory structure
4. Test guest mode
5. Verify session persistence across page reloads
6. Test error handling

### Future Enhancements
1. **Profile Management UI** - Allow users to edit display name, email
2. **Password Change** - Endpoint exists (`/api/auth/change-password`), add UI
3. **Owner User Management** - UI for owner to create/delete guest users
4. **Profile Switching** (Owner Only) - Switch between profiles in UI
5. **User Avatar Upload** - Custom avatars for profiles
6. **Account Deletion** - Self-service account deletion with confirmation

---

## Troubleshooting

### AuthGate doesn't appear
- Check browser console for errors
- Verify AuthGate.svelte is imported in index.astro
- Check `client:only="svelte"` directive is present

### Registration fails with "Cannot find package 'fs-extra'"
- Run: `pnpm install`
- Verify fs-extra in root package.json dependencies

### Profile directory not created
- Check logs: `cat logs/audit/$(date +%Y-%m-%d).ndjson | grep profile`
- Verify initializeProfile() function exists and is exported
- Check permissions on profiles/ directory

### Session not persisting
- Check browser cookies (mh_session should exist)
- Verify cookie settings in `/api/auth/register` and `/api/auth/login`
- Check session validation in `/api/auth/me`

---

## Related Documentation

- [Multi-User Plan](MULTI_USER_PLAN.md) - Overall multi-user architecture
- [Authentication Setup](user-guide/17-authentication-setup.md) - User management guide
- [Persona Facets](PERSONA_FACETS_IMPLEMENTATION.md) - Personality system

---

**Status:** ✅ Implementation complete, ready for user testing

**Next Phase:** Test the complete workflow and integrate with existing features
