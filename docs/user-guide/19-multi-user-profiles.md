# Multi-User Profiles & Guest Mode

**MetaHuman OS** now supports multiple users with independent configurations, memories, and personas. This enables:
- Guest users to explore public profiles
- Independent settings per user
- Profile switching and persona merging
- Complete data isolation

---

## Overview

### User Roles & Permission Tiers

MetaHuman OS implements a three-tier permission system to ensure security and data isolation:

1. **Owner (Admin)** - Full system access
   - Can create, edit, and delete any user profile
   - Can modify system code and configurations
   - Can access all profiles and their data
   - Can edit documentation
   - Full operator and training access

2. **Standard User** - Own profile access
   - Full read/write access to own profile directory (`profiles/{username}/`)
   - Read-only access to documentation (`docs/`)
   - Cannot access other users' profiles
   - Cannot modify system configurations
   - Can use operator and training features for own profile

3. **Guest** - Read-only access
   - Can read documentation (`docs/`)
   - Can view public profiles (read-only)
   - Cannot write memories or modify any data
   - No operator or training access

4. **Anonymous** - Unauthenticated users
   - Read-only access (emulation mode only)
   - Can chat with public profiles
   - Cannot save memories or modify data

### Profile Architecture

Each user has their own isolated directory:
```
profiles/
├── {username}/          # Owner profile
│   ├── persona/         # Personality & facets
│   ├── memory/          # Memories & reflections
│   ├── etc/             # User-specific configs
│   └── logs/            # User activity logs
└── guest/               # Shared guest profile
    └── [same structure]
```

---

## Getting Started as a Guest

### 1. Access the Web UI

When you first visit MetaHuman OS without logging in, you're an **anonymous user** with limited access.

### 2. Select a Public Profile

To interact with the system, select a public profile:

1. Look for the **profile selector** in the UI (usually in header/sidebar)
2. Choose from available public profiles:
   - Individual profiles (e.g., "greggles")
   - Special merged profile: "Mutant Super Intelligence"
3. Click to activate

**What happens:**
- Persona data copied to guest profile
- All 14 config files copied
- Facet files copied (poet, thinker, friend, antagonist)
- Session updated with selected profile

### 3. Interact with the Persona

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
