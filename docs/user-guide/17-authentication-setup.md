# Authentication & User Setup

## Overview

MetaHuman OS now supports user authentication and role-based access control. This guide explains how to set up your first user and manage authentication.

## Initial Setup (First Time)

### Problem: No Owner User Exists Yet

When you first install MetaHuman OS, there are no users in the system. The authentication system is in place, but you need to create your first "owner" user.

### Current Workaround: Create Owner User Programmatically

Since the CLI user management commands are not yet implemented, you need to create the first owner user using a one-time setup script.

#### Step 1: Create Setup Script

Create a file `scripts/create-owner.ts`:

```typescript
import { createUser } from '@metahuman/core/users';

// Replace these with your desired credentials
const username = 'your-username';  // e.g., 'greggles'
const password = 'your-secure-password';  // Choose a strong password
const displayName = 'Your Name';  // e.g., 'Greg'

try {
  const user = createUser(username, password, 'owner', {
    displayName,
    email: 'your-email@example.com',  // Optional
  });

  console.log('✅ Owner user created successfully!');
  console.log(`   Username: ${user.username}`);
  console.log(`   Role: ${user.role}`);
  console.log(`   Display name: ${user.metadata?.displayName}`);
  console.log('');
  console.log('You can now login at http://localhost:4321/login');
} catch (error) {
  if (error instanceof Error && error.message.includes('already exists')) {
    console.log('⚠️  User already exists. Try a different username.');
  } else {
    console.error('❌ Failed to create user:', error);
  }
}
```

#### Step 2: Run the Script

```bash
# From the metahuman root directory
npx tsx scripts/create-owner.ts
```

#### Step 3: Login

1. Start the dev server: `pnpm dev`
2. Navigate to `http://localhost:4321`
3. Click on the persona name/icon in the header
4. Click "Login"
5. Enter your username and password
6. You'll be redirected to the dashboard

### What Gets Created

When you create a user, the following happens:

1. **User file created:**
   ```
   persona/users.json
   ```
   Contains: username, password hash, role, metadata

2. **Memory directory structure:**
   ```
   memory/
   ├── users/
   │   └── <username>.json
   └── sessions/
       └── (session files created on login)
   ```

## User Roles

MetaHuman OS has three user roles:

### Owner
- **Full access** to all system features
- Can create and delete guest users (UI not yet implemented)
- Can modify all system settings
- Can use all cognitive modes (unless restricted by env triggers)
- Session duration: **24 hours**

### Guest
- **Limited access** to system features
- Cannot modify system settings
- Cannot create other users
- Can use cognitive modes based on permissions
- Session duration: **1 hour**

### Anonymous
- **No authentication** required
- Read-only access in emulation mode only
- Cannot modify anything
- Session duration: **30 minutes**

## Logging In

### Via Web UI

1. Click the **persona name/icon** in the header (top-left)
2. Click **"Login"** in the dropdown
3. Enter your **username** and **password**
4. Click **"Login"** button
5. You'll be redirected to the main dashboard
6. Your username will now appear next to the persona name in the header

### Session Behavior

- Your session is stored in an HTTPOnly cookie (`mh_session`)
- Sessions expire based on your role (owner: 24h, guest: 1h)
- Closing the browser does NOT log you out (session persists)
- You must explicitly click "Logout" to end your session

## Logging Out

1. Click the **persona name/icon** in the header
2. Click **"Logout"** in the dropdown
3. Your session will be terminated
4. You'll be redirected to the login page

## Finding Your Current Login

If you've already created a user but forgot the username:

### Check User Files

```bash
# List all users
ls -la memory/users/

# View a user file (replace <username> with actual filename)
cat persona/users.json
```

Example output:
```json
{
  "id": "usr-1730764012345-abc123",
  "username": "greggles",
  "passwordHash": "...",
  "role": "owner",
  "createdAt": "2025-11-04T12:34:56.789Z",
  "metadata": {
    "displayName": "Greg",
    "email": "greg@example.com"
  }
}
```

The **username** field is what you use to login.

### Check Active Sessions

```bash
# List active sessions
ls -la logs/run/sessions.json

# View a session file (replace <session-id> with actual filename)
cat logs/run/sessions.json<session-id>.json
```

Example output:
```json
{
  "id": "sess-1730764123456-xyz789",
  "userId": "usr-1730764012345-abc123",
  "role": "owner",
  "createdAt": "2025-11-04T13:45:00.000Z",
  "expiresAt": "2025-11-05T13:45:00.000Z",
  "lastActivity": "2025-11-04T14:30:00.000Z"
}
```

## Resetting Your Password

### Manual Method (Current)

Since password reset UI is not yet implemented:

1. **Delete the user file:**
   ```bash
   rm persona/users.json
   ```

2. **Recreate the user** with the same username but new password:
   ```bash
   npx tsx scripts/create-owner.ts
   # (Edit script with new password first)
   ```

### Security Note

Passwords are currently hashed with SHA-256. For production use, the system should be upgraded to bcrypt (see `packages/core/src/users.ts`).

## Environment Triggers & Authentication

Authentication interacts with environment triggers:

### HIGH_SECURITY Mode
```bash
# In .env
HIGH_SECURITY=true
```

- **Effect:** Even authenticated owners are locked to emulation mode only
- **Use case:** Public demos, untrusted environments
- **Login:** Still required to track who is using the system

### WETWARE_DECEASED Mode
```bash
# In .env
WETWARE_DECEASED=true
```

- **Effect:** Dual consciousness mode disabled for all users
- **Use case:** Operating as independent digital consciousness
- **Login:** Works normally, but dual mode is unavailable

### Normal Mode
```bash
# In .env (commented out or not set)
#HIGH_SECURITY=true
#WETWARE_DECEASED=true
```

- **Effect:** All modes available based on user role
- **Use case:** Normal operation

## Troubleshooting

### "Invalid username or password"

1. Check if user file exists: `ls persona/users.json`
2. If not, create the user with the setup script
3. If yes, verify you're using the correct password
4. Remember: passwords are case-sensitive

### "Cannot access /login page"

1. Make sure dev server is running: `pnpm dev`
2. Navigate to `http://localhost:4321/login` directly
3. Check terminal for any errors

### Session expires immediately

1. Check system time (sessions are time-based)
2. Verify session files are being created: `ls logs/run/sessions.json`
3. Check for errors in browser console (F12)

### Stuck in anonymous mode

1. Clear browser cookies: F12 → Application → Cookies → Delete `mh_session`
2. Navigate to `/login` page
3. Login again

### "User already exists" error

1. Check existing users: `ls memory/users/`
2. Either:
   - Use a different username in the script
   - Delete the existing user file first

## Future Features (Not Yet Implemented)

The following features are planned but not yet available:

### CLI User Management
```bash
# Future commands (not yet working):
./bin/mh user create <username> <password> --role owner
./bin/mh user delete <username>
./bin/mh user list
./bin/mh user reset-password <username>
```

### First-Run Setup Wizard
- Interactive web-based setup on first launch
- Automatically creates owner user
- Sets up basic configuration

### User Management UI
- Owner can create/delete guest users via web interface
- Password change form
- User list and permissions management

### Session Management UI
- View active sessions
- Revoke sessions from other devices
- Session history

## Security Best Practices

### For Development
1. Use a **simple password** (it's just local development)
2. Don't commit your `.env` file
3. User files are in `memory/` which should be gitignored

### For Production (Future)
1. Use **strong passwords** (12+ characters, mixed case, numbers, symbols)
2. Upgrade to **bcrypt** password hashing
3. Enable **HTTPS** (secure flag on cookies)
4. Implement **rate limiting** on login endpoint
5. Add **session rotation** after login
6. Enable **2FA** (future feature)

## Quick Reference

### Create First Owner User
```bash
# 1. Create scripts/create-owner.ts with your credentials
# 2. Run it:
npx tsx scripts/create-owner.ts
```

### Login
1. Go to `http://localhost:4321`
2. Click persona name/icon → Login
3. Enter credentials

### Logout
1. Click persona name/icon → Logout

### Check Username
```bash
ls memory/users/
cat persona/users.json
```

### Reset Password
```bash
rm persona/users.json
npx tsx scripts/create-owner.ts  # with new password
```

## Related Documentation

- [Phase 6 Implementation Summary](../dev/PHASE6_IMPLEMENTATION_SUMMARY.md)
- [Phase 6 UI Changes](../dev/PHASE6_UI_CHANGES.md)
- [Security Policy](../dev/SECURITY_POLICY.md)
- [Architecture](../ARCHITECTURE.md)

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review browser console for errors (F12)
3. Check terminal output for server errors
4. File an issue at https://github.com/anthropics/claude-code/issues
