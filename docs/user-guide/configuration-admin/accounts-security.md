# Accounts & Security

This guide covers account types, multi-device sync, data storage, encryption, and security best practices.

---

## Account Types

MetaHuman OS has three account roles:

| Role | Description | Permissions |
|------|-------------|-------------|
| **Owner** | System administrator | Full access: all settings, mode switching, trust levels, user management |
| **Standard** | Regular user | Read/write memories, chat, tasks. Cannot change system settings or trust levels |
| **Guest** | Read-only visitor | View-only access. Cannot create memories, modify data, or access sensitive settings |

### Owner Account

- The **first account created** on any machine automatically becomes the owner
- Only one owner per machine
- Owners can:
  - Switch cognitive modes (Dual Consciousness, Agent, Emulation)
  - Modify trust levels and security policies
  - Manage other user accounts
  - Access all system configuration

### Standard Account

- Any account created after the owner
- Full access to personal features (chat, memory, tasks, persona editing)
- Cannot modify system-wide settings

### Guest Account

**⚠️ Important:** All users must authenticate - there are no anonymous sessions.

- Created by owner or via existing credentials
- Must log in with credentials (no "Continue as Guest" without authentication)
- Sessions last 1 hour
- Always forced into emulation mode (read-only)
- Read-only access to view public profiles
- Useful for demonstrations or sharing your digital twin with others

See [Authentication](authentication.md) for details on creating guest accounts.

---

## Where Accounts Are Stored

**Accounts are local to each machine.** When you create an account:

- **On a server:** Account exists on that server
- **On a mobile device:** Account exists on that device
- **On your local machine:** Account exists on that machine

If you try to log in on a machine where your account doesn't exist, you'll see:
- "User not found" error
- Options to **Sync from Server** or **Create Account**

---

## Multi-Device Sync

MetaHuman supports using your profile across multiple devices through sync.

### How Sync Works

When you sync from a server:

1. You authenticate with the remote server
2. The following data is downloaded to your local machine:
   - Persona files (identity, personality, relationships)
   - Configuration files
   - Conversation buffer (recent chat context)
   - Recent memories

This effectively creates **two copies of your account** — one on each machine.

### Setting Up Sync

**Initial sync (login screen):**
1. Enter your username and password
2. If "User not found", click **Sync from Server**
3. Enter the server URL (e.g., `https://mh.example.com`)
4. Click **Sync Profile**

**Ongoing sync (after login):**
- **Status Widget** (left sidebar) — Shows sync status and last sync time
- **Settings → Sync** — Configure auto-sync and manual sync options

### Auto-Sync on Login

When enabled, each login will:
1. Check for the remote server
2. Pull latest persona, config, and memories
3. Merge with local data

### Important Notes

> **Sync is currently pull-only.** Data flows FROM the server TO your device.
>
> To keep both devices up-to-date, you must log into **both machines regularly**.
>
> This feature is under active development and may change.

---

## Data Storage

### Default Storage Location

By default, user data is stored in:

```
profiles/{username}/
├── persona/          # Identity and personality
├── memory/           # Episodic memories, tasks
├── etc/              # User-specific configuration
├── state/            # Runtime state
└── out/              # Generated outputs, adapters
```

**This data is stored unencrypted by default.**

### Custom Storage Location (Stacks)

**⚠️ CRITICAL: Many users configure custom profile storage** for encrypted drives, external storage, or network mounts.

You can store your profile data on a different location:
- USB drive
- External hard drive
- Encrypted partition (LUKS, VeraCrypt)
- Network storage (NAS)

This is called a **"stack"** — a portable, self-contained profile storage.

#### Configuration via `persona/users.json`

Custom storage is configured per-user in `persona/users.json`:

```json
{
  "users": [
    {
      "id": "user-123",
      "username": "greggles",
      "metadata": {
        "profileStorage": {
          "path": "/media/greggles/STACK/metahuman-profiles/greggles",
          "type": "encrypted",
          "fallbackBehavior": "error",
          "encryption": {
            "type": "luks",
            "mountPoint": "/media/greggles/STACK/metahuman-profiles/greggles"
          }
        }
      }
    }
  ]
}
```

**Configuration Fields:**
- `path` - Absolute path to custom profile storage location
- `type` - Storage type: `internal` (default), `external`, or `encrypted`
- `fallbackBehavior` - What to do if custom path unavailable:
  - `error` (recommended for encrypted storage) - Throw error, prevent writes to default location
  - `fallback` - Silently fall back to default `profiles/<username>/` location
- `encryption` - Optional encryption metadata

#### Storage Types

| Type | Description | Example |
|------|-------------|---------|
| `internal` | Default location in repo | `profiles/<username>/` |
| `external` | USB drive, network mount | `/mnt/external/profiles/<username>/` |
| `encrypted` | LUKS, VeraCrypt, AES-256 | `/media/user/STACK/metahuman-profiles/<username>/` |

#### Path Resolution Flow

**For developers:** Always use `getProfilePaths(username)` - never hardcode paths.

```typescript
import { getProfilePaths } from '@metahuman/core';

// CORRECT: Resolves actual path (including custom storage)
const profilePaths = getProfilePaths('greggles');
console.log(profilePaths.root);  // /media/greggles/STACK/metahuman-profiles/greggles

// WRONG: Hardcoded path fails for custom storage
const path = `profiles/greggles/`;  // ❌ Will miss encrypted storage!
```

**Resolution Process:**
1. Check `persona/users.json` → `users[].metadata.profileStorage.path`
2. If custom path exists and is accessible → use it
3. If unavailable:
   - `fallbackBehavior: 'error'` → Throw error (prevent unencrypted writes)
   - `fallbackBehavior: 'fallback'` → Use default `profiles/<username>/`

#### Finding Your Actual Profile Path

**Never assume** your profile is at `profiles/<username>/`. Check the actual location:

```bash
# Via CLI (shows actual path)
./bin/mh profile path

# Via API
import { resolveProfileRoot } from '@metahuman/core/path-builder';
const resolution = resolveProfileRoot('username');
console.log(resolution.root);  // Shows actual location
console.log(resolution.storageType);  // 'encrypted', 'external', or 'internal'
```

#### Security with Custom Storage

**Recommended: `fallbackBehavior: 'error'` for encrypted storage**

When using encrypted storage, set `fallbackBehavior: 'error'` to prevent the system from silently writing to unencrypted default storage if the encrypted drive is unmounted.

```json
{
  "profileStorage": {
    "path": "/media/user/encrypted-drive/metahuman/user",
    "type": "encrypted",
    "fallbackBehavior": "error"  // Fail loudly if drive unavailable
  }
}
```

This ensures sensitive data never accidentally writes to unencrypted storage.

#### Manual Configuration

**To configure custom storage:**
1. Edit `persona/users.json` and add `metadata.profileStorage` configuration
2. Create the custom directory: `mkdir -p /path/to/custom/storage`
3. Move existing profile data: `mv profiles/username/* /path/to/custom/storage/`
4. Restart MetaHuman OS
5. Verify: `./bin/mh profile path` should show custom location

### Mobile Storage

On mobile devices:
- Data is stored in the app's private storage
- No encryption options available (relies on device passcode)
- Assumes single-user device with device-level security

---

## Encryption

For users who want additional privacy, MetaHuman supports profile encryption.

### Available Encryption Options

| Method | Platform | Stability | Notes |
|--------|----------|-----------|-------|
| **LUKS** | Linux | Stable | Recommended. Full disk encryption |
| **AES-256** | All | Experimental | Software-based encryption |
| **None** | All | Stable | Default. Data stored in plaintext |

### LUKS Encryption (Recommended for Linux)

LUKS (Linux Unified Key Setup) provides proven, system-level encryption:

1. Go to **Settings → Storage → Encryption**
2. Select **LUKS**
3. Choose whether to use your login password or a separate encryption key
4. Follow the setup wizard

When using login password:
- Profile auto-unlocks on login
- Profile auto-locks on logout

### Mobile Encryption

**No encryption is currently available on mobile devices.**

Mobile security relies on:
- Device passcode/biometrics
- App sandboxing
- Assumption of single-user device

---

## Recovery Codes

Recovery codes allow you to reset your password if you forget it.

### Finding Your Recovery Codes

After creating an account:
1. Log in to your account
2. Go to **Settings → Security**
3. View or regenerate your recovery codes

### Using Recovery Codes

Each code:
- Can only be used **once**
- Resets your password
- Generates new recovery codes after use

**Store your codes securely** — in a password manager or printed copy.

---

## Security Best Practices

### For Maximum Security

1. **Use trusted devices only** — MetaHuman stores sensitive personal data
2. **Enable encryption** — Use LUKS on Linux for proven protection
3. **Use a remote server with Cloudflare** — For secure remote access without port forwarding
4. **Backup to external storage** — Use a stack on a removable drive
5. **Keep sync server behind HTTPS** — Never sync over unencrypted connections

### Deployment Options

| Setup | Pros | Cons |
|-------|------|------|
| **Local only** | Simple, private | Limited to one device |
| **Local + Mobile sync** | Use on multiple devices | Must sync manually, pull-only |
| **Remote server** | Access from anywhere, full features | Requires server setup |
| **Remote server + Cloudflare** | Secure remote access, no port forwarding | Requires Cloudflare account |
| **Mobile only** | Portable, always with you | Limited compute power |

### Remote Server Benefits

Running MetaHuman on a remote server provides:
- Maximum storage capacity
- Full computational power for training
- Access from any device without syncing
- Always-on autonomous agents

### Cloud Processing (RunPod)

You don't need to install MetaHuman locally to use it:

1. Set up an account on an existing server
2. Configure RunPod for remote LLM processing
3. Access via browser from any device

Note: Cloud processing services typically have usage costs.
