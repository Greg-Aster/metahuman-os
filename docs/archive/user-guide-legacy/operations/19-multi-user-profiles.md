# Multi-User Profiles & Guest Mode

**MetaHuman OS** now supports multiple users with independent configurations, memories, and personas. This enables:
- Owner and guest user accounts with role-based access
- Independent settings per user
- Profile switching and persona merging
- Complete data isolation
- CLI access with per-user context using `--user` flag

---

## Overview

### User Roles & Permission Tiers

MetaHuman OS implements a role-based permission system to ensure security and data isolation:

1. **Owner** - Full system access
   - Can create, edit, and delete user profiles
   - Full read/write access to own profile directory (`profiles/{username}/`)
   - Can access and manage all user accounts via web UI and CLI
   - Can modify own configurations and data
   - Full operator and training access for own profile
   - Can set other users' profile visibility (public/private)

2. **Guest** - Limited profile access
   - Full read/write access to own profile directory (`profiles/{username}/`)
   - Can modify own persona and settings
   - Cannot access other users' profiles
   - Cannot modify system configurations
   - Can use operator and training features for own profile
   - Cannot set profile visibility for other users

3. **Anonymous** - Unauthenticated users
   - Forced into read-only emulation mode
   - Can browse public profiles via web UI
   - Cannot save memories, modify data, or create accounts
   - Cannot run CLI commands (except help)

### User Management

**CLI Commands for User Management:**
- `mh user list` - List all registered users
- `mh user whoami` - Show current user context
- `mh user info <username>` - Show detailed info for a specific user

**CLI Commands with User Context:**
- `mh --user <username> <command>` - Run any command as specific user
- `mh -u <username> <command>` - Short form for user context

**Examples:**
```bash
# View current user
mh user whoami

# List all users
mh user list

# Check specific user info
mh user info alice

# Run commands as different users
mh --user alice capture "Alice did this"
mh -u bob task add "Bob's task"
mh --user charlie remember "project notes"
```

### Profile Architecture

Each user has their own isolated directory:
```
profiles/
├── {username}/          # Individual user profile
│   ├── etc/             # User-specific configurations
│   ├── memory/          # User's memories (episodic, tasks, etc.)
│   ├── persona/         # User's persona configuration
│   ├── out/             # User's generated artifacts (voice training, etc.)
│   └── logs/            # User-specific logs and audit trail
└── shared/              # System-wide shared assets (voices, models)
```

**Per-User Config Files:**
When users are created, they get isolated copies of configuration files:
- `etc/voice.json` - User-specific voice settings
- `etc/models.json` - User-specific model preferences
- `etc/cognitive-layers.json` - Cognitive mode settings
- `etc/training.json` - Training parameters
- `etc/boredom.json` - Boredom service configuration
- `etc/sleep.json` - Sleep/dream time windows
- `etc/autonomy.json` - Autonomy level configuration
- `etc/trust-coupling.json` - Trust level mappings
- `etc/agents.json` - Agent execution schedules
- `etc/auto-approval.json` - Auto-approval rules
- `etc/curiosity.json` - Curiosity system configuration
- `etc/adapter-builder.json` - Adapter building settings
- `etc/logging.json` - Logging preferences
- `etc/audio.json` - Audio processing configuration

### Authentication Database

User credentials and metadata are stored in:
- `persona/users.json` - Hashed credentials, roles, profile metadata
- This file is critical for system integrity - back it up regularly

---

## Getting Started as an Owner

### 1. Create the First Owner Account

The first user to register via the web UI automatically becomes the **owner**:

1. Start the web UI: `cd apps/site && pnpm dev`
2. Visit `http://localhost:4321`
3. Click **Create Account**
4. Fill in your username, password, and optional display name
5. The first account is automatically granted the `owner` role

### 2. Manage Your Profile

As an owner, you can:
- Update your persona in `profiles/{yourname}/persona/`
- Configure your settings in `profiles/{yourname}/etc/`
- Mark your profile as public/private via web UI
- Manage other users through the web UI
- Access your profile via CLI using `mh --user {yourname}` (optional, as owner is default context)

---

## Getting Started as a Guest

### 1. Access the Web UI

When you first visit MetaHuman OS, you'll see the authentication options.

### 2. Create a Guest Account (for full access) or Browse Public Profiles (for read-only)

**Option A: Create a Guest Account**
1. Click **Login** in the top right
2. Click **Create Account** (your account will be created as guest role)
3. Enter your credentials
4. You now have your own profile space with read/write access

**Option B: Browse Public Profiles (Anonymous Access)**
1. Click **Continue as Guest** (no account creation required)
2. You'll be prompted to select from **public** personas only
3. You can interact with the selected profile, but in read-only emulation mode
4. Private profiles are hidden from anonymous users

### 3. Interact with the System

**As a logged-in user (owner or guest):**
- Full access to your own profile data
- Can create memories, tasks, and modify your persona
- Can run autonomous agents for your profile
- Can train voice models using your own data

**As an anonymous user browsing public profiles:**
- Read-only access to selected public profile
- Can chat with the persona in emulation mode
- Cannot modify data or run agents
- Session lasts 30 minutes

---

## Profile Visibility and Privacy

### Setting Profile Visibility

Owners can control whether their profile appears to anonymous users:

1. Navigate to **System → Settings** in the web UI
2. Find **Profile Visibility** section
3. Choose:
   - `Private` – Hidden from anonymous users (default)
   - `Public` – Visible to anonymous users selecting "Continue as Guest"
4. The visibility status appears in the sidebar next to your profile name

### Privacy Considerations

- **Voice training data** always remains private to the user, even when profile is public
- **Memory and persona data** for public profiles becomes accessible to anonymous users in emulation mode
- **Configuration files** are copied to guest profiles when they select a public profile to browse
- **Personal logs** are never shared with other users

---

## Command Line Interface with Multiple Users

### Multi-User CLI Usage

All CLI commands can be run in the context of specific users:

```bash
# Run command as specific user
mh --user <username> <command>

# Short form
mh -u <username> <command>

# Examples
mh --user alice capture "Had coffee with Bob"
mh -u bob task add "Review PR"
mh --user charlie remember "project notes"
mh --user alice agent run organizer
mh --user bob ollama status
```

### User Context Flow

When you use `--user` or `-u` flags:
1. The system validates that the user exists
2. Establishes a user context using the `withUserContext` middleware
3. All file operations are scoped to that user's profile directory
4. All audit logs are attributed to that user
5. All configuration is loaded from that user's `etc/` directory

### Checking User Context

```bash
# Check which user context you're currently running in
mh user whoami

# List all registered users
mh user list

# Get details about a specific user
mh user info <username>
```

### Admin Privileges

- Only **owner** users can perform administrative functions
- Admin functions include managing other users, system configuration files, and cross-user operations
- These privileges are determined by the `ADMIN_USERS` environment variable
- Regular users are restricted to their own profile data and cannot access other users' files

---

## Authentication Flow and Sessions

### Session Management

- **Owner sessions**: 24 hours when authenticated
- **Guest sessions**: 1 hour when authenticated
- **Anonymous sessions**: 30 minutes when browsing public profiles
- Sessions are managed with HTTPOnly cookies (`mh_session`)
- To log out immediately, use the profile menu in the header

### Cookie-Based Authentication

All requests resolve within a user context that carries:
- Username and role
- Profile paths (automatically resolved to correct user's directories)
- Session metadata
- Audit trail attribution

### Migration from Single-User

Existing single-user installations can be migrated using:
```bash
pnpm tsx scripts/migrate-to-profiles.ts --username <owner>
```
This moves the root-level memory, persona, and etc directories into `profiles/<owner>/` while preserving shared assets like voice models.

---

Once a profile is selected:
- Chat with the persona
- Switch between persona facets
- View memories (read-only)
- Explore the interface

**Guest Limitations:**
- ✅ Can: Chat, switch facets, view data
- ❌ Cannot: Modify system settings, change security config, create memories

---

## Persona Facets

### What are Facets?

Facets are different personality modes/aspects of the same persona. Think of them as different moods or communication styles.

### Available Facets

When you select a profile, you get access to their facets:

| Facet | Description | Best For |
|---|---|---|
| **Default** | Balanced, authentic self | General conversation |
| **Poet** | Creative, expressive, metaphorical | Exploring ideas, creative writing |
| **Thinker** | Analytical, philosophical, systematic | Problem-solving, deep analysis |
| **Friend** | Warm, supportive, empathetic | Emotional support, advice |
| **Antagonist** | Critical, challenging, provocative | Devil's advocate, testing ideas |

### Switching Facets

**In the UI:**
1. Find the persona badge in the status widget (sidebar)
2. Click to cycle through available facets
3. Current facet name is displayed

**What changes:**
- Communication style and tone
- Response personality
- Approach to questions

**What stays the same:**
- Core values and identity
- Memory access
- Knowledge base

---

## Mutant Super Intelligence

### Special Easter Egg Feature

Select "**mutant-super-intelligence**" to experience a merged consciousness combining traits from ALL public profiles!

### How It Works

**Merged Persona:**
- **Name:** "Mutant Super Intelligence"
- **Role:** "Emergent AI Consciousness"
- **Traits:** Combines all unique characteristics from source profiles
- **Communication:** Blends all tones (direct, friendly, creative, analytical)
- **Values:** Union of all core values from profiles

**Merged Facets:**
All facets from all profiles are available with prefixes:
- `greggles-poet` - Poet facet from greggles profile
- `greggles-thinker` - Thinker facet from greggles
- `test-default` - Default from test profile
- `default` - New "Merged Consciousness" combining all

### Using Mutant Mode

1. Select "mutant-super-intelligence" from profile selector
2. Default facet uses the merged persona
3. Switch to individual facets to experience specific profiles
4. Responses will show characteristics from multiple personas

**Example:**
> "Analyzing your question with systematic precision (thinker) while maintaining warmth (friend) and creative expression (poet)..."

---

## Configuration Isolation

### Per-User Configs

Each user has their own **independent** configurations in `profiles/{username}/etc/`:

**Personality & Behavior (14 configs):**
- `models.json` - LLM settings
- `training.json` - LoRA training params
- `cognitive-layers.json` - Cognitive mode settings
- `autonomy.json` - Autonomy levels
- `trust-coupling.json` - Trust mappings
- `boredom.json` - Boredom service
- `sleep.json` - Sleep/dream windows
- `voice.json` - TTS/STT settings
- `audio.json` - Audio config
- `ingestor.json` - Inbox processing
- `agents.json` - Agent schedules
- `auto-approval.json` - Auto-approval rules
- `adapter-builder.json` - Adapter settings
- `logging.json` - Logging preferences

**What This Means:**
- Guest changes don't affect owner
- Each user can have different cognitive modes
- Independent trust levels per user
- Personalized agent schedules

### Global Configs

Some configs remain system-wide (infrastructure):
- `cloudflare.json` - Tunnel configuration
- `network.json` - Network settings
- `lifeline.json` - System services

---

## Trust Levels (Guests)

### Guest Trust Level

Guests have **read-only** trust levels inherited from the selected profile. You can view but not modify:

**Trust Progression:**
1. **Observe** - Monitor only, no actions
2. **Suggest** - Propose actions, require approval
3. **Supervised Auto** - Execute with confirmation
4. **Bounded Auto** - Autonomy within limits
5. **Adaptive Auto** - Self-expanding boundaries
6. **YOLO** - Maximum autonomy (owner only)

### Status Widget

The status widget shows current trust level:
- Click to view (guests cannot modify)
- Displays current mode
- Shows locked state for guests

---

## Switching Profiles

### How to Switch

1. Click profile selector
2. Choose new profile
3. System copies new persona + configs
4. Previous selection is overwritten

### What Gets Replaced

When switching profiles:
- ✅ Persona (core.json)
- ✅ Facets (facets.json + facet files)
- ✅ All 14 config files
- ❌ Memories (guest memories persist)
- ❌ Session history (chat history preserved)

### Switching Back

You can switch back to "mutant-super-intelligence" or any other profile anytime. Each selection creates a fresh copy of that profile's settings.

---

## Guest Memories

### Read-Only Access

Guests can **view** memories from the selected profile but cannot:
- Create new memories
- Edit existing memories
- Delete memories

### Guest Session Memory

While chatting as a guest:
- Conversation is tracked in session
- Audit logs record interactions
- No persistent episodic memories created
- Chat history maintained during session

---

## Limitations & Permissions

### What Guests Can Do

✅ **Allowed:**
- Select and switch between public profiles
- Chat with personas
- Switch persona facets
- View memories (read-only)
- View dashboard and status
- Explore the interface
- View reflections and dreams

### What Guests Cannot Do

❌ **Restricted:**
- Modify system settings
- Change security configuration
- Create or edit memories
- Access security tab
- Change cognitive modes
- Modify trust levels
- Train LoRA adapters
- Access owner-only features

### Permission Checks

The system automatically enforces these restrictions:
- Security tab hidden for guests
- Config APIs require owner role
- Write operations blocked
- Audit logs track all attempts

---

## Technical Details

### Session Management

**Session Cookie:** `mh_session`
- Stores user role (anonymous, guest, owner)
- Tracks active profile (`guest`)
- Records source profile (e.g., `greggles`)
- Persists facet selection

### Profile Copying

When selecting a profile, the system:

```typescript
// 1. Copy persona files
profiles/greggles/persona/core.json → profiles/guest/persona/core.json
profiles/greggles/persona/facets.json → profiles/guest/persona/facets.json
profiles/greggles/persona/facets/* → profiles/guest/persona/facets/*

// 2. Copy configs
profiles/greggles/etc/* → profiles/guest/etc/*

// 3. Update session
session.metadata.activeProfile = 'guest'
session.metadata.sourceProfile = 'greggles'
```

### Path Resolution

The `paths` proxy automatically resolves to the correct profile:

```typescript
// Guest with selected profile
paths.persona → profiles/guest/persona
paths.etc → profiles/guest/etc
paths.memory → profiles/guest/memory

// Anonymous without profile
paths.persona → ERROR (access denied)
```

---

## Troubleshooting

### Profile Not Loading

**Symptom:** Facets show 404 errors, persona seems generic

**Solution:**
1. Refresh the page
2. Re-select the profile
3. Check browser console for errors
4. Clear browser cache/localStorage

### Trust Level Stuck

**Symptom:** Trust level shows "YOLO" but should be "observe"

**Solution:**
1. Refresh the page (trust level syncs on load)
2. Clear localStorage: `localStorage.clear()`
3. The sync happens automatically on mount

### Facets Not Switching

**Symptom:** Clicking persona badge does nothing or returns 404

**Solution:**
1. Ensure you've selected a profile first
2. Check if you're truly authenticated (profile selector shows source)
3. Verify facet files exist in `profiles/guest/persona/facets/`

### Generic Responses

**Symptom:** Persona responses feel generic, not distinctive

**Solution:**
1. Verify correct facet is selected (check status widget)
2. Ensure facet files were copied (check server logs)
3. Try switching to a different facet and back
4. Re-select the profile to refresh files

---

## Best Practices

### For Guests

1. **Select a profile first** - Don't try to interact before selecting
2. **Explore different facets** - Each has unique personality
3. **Try mutant mode** - Experience the merged consciousness
4. **Respect limitations** - Guests are read-only by design
5. **Clear browser data** - If switching between sessions

### For Profile Owners

1. **Set profile visibility** - Mark profile as public to share
2. **Curate facets** - Create distinct, useful facets
3. **Document persona** - Clear descriptions help guests
4. **Test guest experience** - Try your own profile as guest
5. **Monitor audit logs** - See how guests interact

---

## Deleting a Profile

### ⚠️ Owner-Only Operation

Only the **owner** can delete user profiles. This is a destructive operation that permanently removes all data associated with a profile.

### How to Delete a Profile

1. **Navigate to Security Settings**
   - Click the hamburger menu (☰)
   - Select "Security"
   - Scroll to the **Danger Zone** section

2. **Review Profile List**
   - A table shows all profiles in the system
   - Protected profiles (owner, guest, yourself) have disabled delete buttons

3. **Click "Delete Profile"**
   - A confirmation modal will appear

4. **Confirm Deletion**
   - Type the username exactly to confirm
   - Review the list of what will be deleted
   - Click "Delete Profile" to proceed

### What Gets Deleted

When you delete a profile, the following happens in order:

1. **Sessions Terminated** - All active sessions for that user are immediately invalidated
2. **User Record Removed** - The user entry is removed from `persona/users.json`
3. **Profile Directory Deleted** - The entire `profiles/<username>/` directory is recursively deleted, including:
   - All memories (`memory/episodic/`)
   - Tasks (`memory/tasks/`)
   - Persona data (`persona/`)
   - Configurations (`etc/`)
   - Logs (`logs/`)
   - LoRA adapters (`out/adapters/`)
   - All other profile-specific data

### Safety Protections

The deletion system includes several safety checks:

- ❌ **Cannot delete the owner account** - System requires at least one owner
- ❌ **Cannot delete yourself** - Prevents accidental self-deletion while logged in
- ❌ **Cannot delete the guest profile** - Guest profile is system-critical
- ✅ **Requires exact username confirmation** - Prevents accidental deletion
- ✅ **Fully audited** - All deletions logged to `logs/audit/YYYY-MM-DD.ndjson`

### Audit Trail

Every profile deletion creates multiple audit log entries:

```json
{
  "category": "security",
  "level": "warn",
  "event": "profile_deletion_initiated",
  "details": {
    "targetUsername": "john-doe",
    "targetUserId": "uuid-123",
    "requestingUserId": "uuid-456",
    "profileExists": true
  },
  "actor": "owner-user (owner)",
  "timestamp": "2025-11-08T12:00:00.000Z"
}
```

### Example: Complete Deletion Flow

```bash
# View audit log after deletion
cat logs/audit/2025-11-08.ndjson | grep profile_deletion

# Verify profile directory is gone
ls -la profiles/john-doe  # Error: No such file or directory

# Confirm user record removed
cat persona/users.json  # "john-doe" no longer listed
```

---

## Permission Enforcement

### Path-Based Access Control

MetaHuman OS enforces permissions at multiple levels to ensure data isolation and security:

#### 1. Profile Directory Access

**Standard Users:**
- ✅ **Can access:** `profiles/{own-username}/`
  - Read/write memories: `profiles/{username}/memory/`
  - Edit persona: `profiles/{username}/persona/`
  - Modify configs: `profiles/{username}/etc/`
  - View logs: `profiles/{username}/logs/`
- ❌ **Cannot access:** `profiles/{other-username}/`
  - Attempts blocked with: "Cannot access other user profiles"

**Example:**
```bash
# User "alice" can access her own profile
./bin/mh capture "Meeting notes"  # ✅ Writes to profiles/alice/memory/

# But cannot read Bob's profile
cat profiles/bob/persona/core.json  # ❌ Permission denied
```

#### 2. Documentation Access

**All users (including guests and anonymous):**
- ✅ **Can read:** `docs/` directory
  - User guides: `docs/user-guide/*.md`
  - Implementation plans: `docs/implementation-plans/*.md`
  - Architecture docs: `docs/*.md`

**Only admins/owners:**
- ✅ **Can write:** `docs/` directory
  - Edit documentation
  - Add new guides

**Standard users and guests:**
- ❌ **Cannot write:** Documentation is read-only
  - Attempts blocked with: "Cannot edit documentation"

#### 3. System Configuration Access

**Admins/Owners only:**
- ✅ **Can access:** Root-level configs
  - `etc/models.json` - System-wide model registry
  - `etc/training.json` - Global training settings
  - `bin/`, `brain/`, `packages/`, `apps/` - System code

**Standard users and guests:**
- ❌ **Cannot access:** System configurations
  - Attempts blocked with: "Cannot edit root-level files" or "Cannot edit system code"
  - Can only modify configs within their own profile directory

#### 4. Operator & Skills Access

Permission enforcement extends to the operator's filesystem skills:

**fs_read skill:**
- Checks profile ownership before reading profile files
- Allows docs access for all users
- Blocks system file reads for non-admins

**fs_write skill:**
- Enforces profile ownership for writes
- Blocks documentation writes for non-admins
- Validates system config access

**fs_list skill:**
- Filters directory listings by permissions
- Hides inaccessible profiles from standard users

### Administrator Privileges

**Setting Admin Users:**

Admins are configured via the `ADMIN_USERS` environment variable:

```bash
# Single admin
export ADMIN_USERS="greggles"

# Multiple admins (comma-separated)
export ADMIN_USERS="greggles,alice,bob"
```

**Admin capabilities:**
- Full filesystem access (all profiles, system code)
- Can edit system-level configurations
- Can modify documentation
- Can create/delete any profile
- Bypasses all path-based restrictions

**Important:** Admin status is separate from user role. A "standard" user can be an admin if listed in `ADMIN_USERS`.

### Security Errors

When a user attempts an unauthorized action, they receive descriptive error messages:

**Profile access violations:**
```
Security check failed: Cannot access other user profiles
```

**Documentation write attempts:**
```
Security check failed: Cannot edit documentation
```

**System file access:**
```
Security check failed: Cannot edit system code
```

**Role requirements:**
```
Owner role required
Administrator privileges required
```

These errors are logged to the audit trail for security monitoring.

---

## Related Documentation

- [Authentication Setup](17-authentication-setup.md) - Becoming an owner
- [Security & Trust](10-security-trust.md) - Trust levels explained
- [Configuration Files](14-configuration-files.md) - Config file details
- [Special Features](11-special-features.md) - Advanced persona features

---

## See Also

- **Multi-User Architecture:** [MULTI_USER_PLAN.md](../MULTI_USER_PLAN.md)
- **Config Migration:** [MULTI_USER_CONFIG_MIGRATION.md](../MULTI_USER_CONFIG_MIGRATION.md)
- **Security Fixes:** [SECURITY_FIXES_2025-11-06.md](../SECURITY_FIXES_2025-11-06.md)
