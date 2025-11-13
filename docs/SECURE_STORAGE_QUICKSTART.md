# Secure Storage Quick Start Guide

**Target Audience**: Developers implementing the encrypted external drive system
**Estimated Time**: 30 minutes to understand, 2-3 weeks to implement
**Prerequisites**: TypeScript, Node.js, understanding of filesystem operations

---

## Implementation Checklist

Use this checklist to track progress through the implementation phases:

### Phase 1: Core Storage Metadata & Path Resolution ⏳

- [ ] Create `packages/core/src/storage.ts` module
  - [ ] Define `StorageMetadata` interface
  - [ ] Implement `loadStorageMetadata(username)`
  - [ ] Implement `saveStorageMetadata(username, metadata)`
  - [ ] Implement `isStorageDeviceMounted(deviceId)`
  - [ ] Implement `getDeviceMountPoint(deviceId)`
  - [ ] Implement `validateStorageDevice(metadata)`

- [ ] Create `packages/core/src/storage-health.ts` module
  - [ ] Implement `checkDriveHealth(mountPoint)`
  - [ ] Implement `getSmartStatus(devicePath)`
  - [ ] Implement `getFreeSpace(mountPoint)`

- [ ] Modify `packages/core/src/paths.ts`
  - [ ] Update `getProfilePaths()` to check for storage metadata
  - [ ] Add logic to use `mountPoint` when device is mounted
  - [ ] Add fallback logic when device is not mounted
  - [ ] Update `tryResolveProfilePath()` to handle storage unavailable

- [ ] Write unit tests
  - [ ] Test storage metadata serialization
  - [ ] Test path resolution with mounted storage
  - [ ] Test path resolution with unmounted storage
  - [ ] Test fallback behavior

### Phase 2: CLI Storage Helper ⏳

- [ ] Create `packages/cli/src/commands/storage.ts`
  - [ ] Implement `storage list` command
  - [ ] Implement `storage setup` command (format + encrypt)
  - [ ] Implement `storage register` command (existing drive)
  - [ ] Implement `storage mount` command
  - [ ] Implement `storage unmount` command
  - [ ] Implement `storage health` command
  - [ ] Implement `storage migrate` command (move data to drive)
  - [ ] Implement `storage recovery-key` command

- [ ] Create platform-specific helpers
  - [ ] Linux: LUKS encryption (`cryptsetup`)
  - [ ] macOS: APFS encryption (`diskutil`)
  - [ ] Windows: BitLocker (`manage-bde`)

- [ ] Add prompts for user input
  - [ ] Device selection prompt
  - [ ] Passphrase input (with confirmation)
  - [ ] Data directory selection (checkboxes)
  - [ ] Migration confirmation

- [ ] Add progress indicators
  - [ ] Encryption progress
  - [ ] Migration progress (rsync with --progress)

### Phase 3: Web UI - Secure Storage Panel ⏳

- [ ] Create API endpoints (`apps/site/src/pages/api/storage/`)
  - [ ] `GET /api/storage/devices` - List connected devices
  - [ ] `GET /api/storage/status/:username` - Get storage status
  - [ ] `POST /api/storage/setup` - Format and encrypt drive
  - [ ] `POST /api/storage/register` - Register existing drive
  - [ ] `POST /api/storage/mount` - Mount drive
  - [ ] `POST /api/storage/unmount` - Unmount drive
  - [ ] `POST /api/storage/migrate` - Move data to drive
  - [ ] `GET /api/storage/health/:username` - Health check

- [ ] Create Svelte components
  - [ ] `SecureStorage.svelte` - Main panel
  - [ ] `DriveList.svelte` - Show connected devices
  - [ ] `DriveSetupWizard.svelte` - Multi-step setup
  - [ ] `MountControls.svelte` - Mount/unmount buttons
  - [ ] `MigrationInterface.svelte` - Data migration UI
  - [ ] `HealthDashboard.svelte` - SMART status, free space

- [ ] Add to Settings tab
  - [ ] Create "Secure Storage" section
  - [ ] Wire up components
  - [ ] Add navigation

### Phase 4: Auto-Mount on Boot ⏳

- [ ] Create systemd service (Linux)
  - [ ] Write service template file
  - [ ] Add installation script
  - [ ] Test enable/disable

- [ ] Create LaunchDaemon (macOS)
  - [ ] Write plist template
  - [ ] Add installation script
  - [ ] Test load/unload

- [ ] Create Windows Task Scheduler entry
  - [ ] PowerShell installation script
  - [ ] Test task creation

- [ ] Add boot-time health checks
  - [ ] Verify device is connected
  - [ ] Verify encryption is intact
  - [ ] Log boot events to audit trail

### Phase 5: Remote Access ⏳

- [ ] Implement SSHFS option
  - [ ] Create `packages/core/src/storage-remote.ts`
  - [ ] Add SSHFS mount helper
  - [ ] Add SSH tunnel setup
  - [ ] Document port forwarding

- [ ] Implement WireGuard option
  - [ ] Add WireGuard config generation
  - [ ] Add NFS/Samba export scripts
  - [ ] Document network setup

- [ ] Implement encrypted sync option
  - [ ] Add rsync wrapper with encryption
  - [ ] Add snapshot scheduling
  - [ ] Add sync status tracking

- [ ] Add remote mount UI
  - [ ] Remote mount toggle
  - [ ] Gateway configuration form
  - [ ] Connection status indicator

### Phase 6: Security Policies & Fallback ⏳

- [ ] Implement write protection
  - [ ] Check `requireForWrite` policy in path resolver
  - [ ] Return 503 Service Unavailable when drive missing
  - [ ] Add clear error messages

- [ ] Implement read-only fallback
  - [ ] Create cache directory structure
  - [ ] Sync cache from drive when mounted
  - [ ] Serve reads from cache when drive unmounted
  - [ ] Add "read-only mode" indicator in UI

- [ ] Implement auto-eject on idle
  - [ ] Create storage-monitor agent
  - [ ] Track last activity per user
  - [ ] Schedule eject checks
  - [ ] Log eject events

- [ ] Add policy UI controls
  - [ ] "Require drive for writes" toggle
  - [ ] "Allow read-only fallback" toggle
  - [ ] "Auto-eject after idle" slider (minutes)

### Testing & Documentation ⏳

- [ ] Write integration tests
  - [ ] Test full setup workflow
  - [ ] Test mount/unmount cycles
  - [ ] Test migration process
  - [ ] Test remote access scenarios
  - [ ] Test fallback behavior

- [ ] Manual testing
  - [ ] Physical drive plug/unplug
  - [ ] Boot with drive connected/disconnected
  - [ ] Multi-user scenarios
  - [ ] Recovery from failures

- [ ] Create user documentation
  - [ ] `docs/user-guide/21-secure-storage.md`
  - [ ] Screenshots of setup wizard
  - [ ] Drive recommendations
  - [ ] Troubleshooting guide
  - [ ] Recovery procedures

- [ ] Update existing docs
  - [ ] Add references to security guide
  - [ ] Update architecture diagrams
  - [ ] Add to table of contents

---

## Quick Implementation Guide

### Step 1: Storage Metadata Interface

Create `packages/core/src/storage.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths, getProfilePaths } from './paths.js';

export interface StorageMetadata {
  deviceId: string;
  deviceSerial?: string;
  friendlyName: string;
  mountPoint: string;
  encryption: {
    type: 'LUKS' | 'APFS-Encrypted' | 'BitLocker' | 'VeraCrypt' | 'none';
    cipher?: string;
    keySize?: number;
    passwordProtected: boolean;
    hasRecoveryKey: boolean;
  };
  directories: string[];
  autoMount: boolean;
  policies: {
    requireForWrite: boolean;
    allowReadOnlyFallback: boolean;
    autoEjectOnIdle: boolean;
    idleTimeoutMinutes: number;
  };
  remote?: {
    enabled: boolean;
    method: 'sshfs' | 'wireguard' | 'sync';
    gatewayHost?: string;
    tunnelConfig?: string;
  };
  health?: {
    lastMounted?: string;
    lastChecked?: string;
    smartStatus?: string;
    freeSpaceGB?: number;
    totalSpaceGB?: number;
  };
}

export function loadStorageMetadata(username: string): StorageMetadata | null {
  const profilePaths = getProfilePaths(username);
  const metadataPath = path.join(profilePaths.etc, 'storage.json');

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(data) as StorageMetadata;
  } catch (error) {
    console.error(`Failed to load storage metadata for ${username}:`, error);
    return null;
  }
}

export function saveStorageMetadata(username: string, metadata: StorageMetadata): void {
  const profilePaths = getProfilePaths(username);
  const metadataPath = path.join(profilePaths.etc, 'storage.json');

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

export function isStorageDeviceMounted(deviceId: string): boolean {
  // Platform-specific implementation
  // Linux: check /proc/mounts or lsblk output
  // macOS: check diskutil list
  // Windows: check Get-Volume
  // TODO: Implement
  return false;
}

export function getDeviceMountPoint(deviceId: string): string | null {
  // Platform-specific implementation
  // TODO: Implement
  return null;
}

export function validateStorageDevice(metadata: StorageMetadata): { ok: boolean; error?: string } {
  if (!metadata.deviceId) {
    return { ok: false, error: 'Missing device ID' };
  }

  if (!metadata.mountPoint) {
    return { ok: false, error: 'Missing mount point' };
  }

  if (!fs.existsSync(metadata.mountPoint)) {
    return { ok: false, error: `Mount point does not exist: ${metadata.mountPoint}` };
  }

  return { ok: true };
}
```

### Step 2: Update Path Resolution

Modify `packages/core/src/paths.ts`:

```typescript
import { loadStorageMetadata, isStorageDeviceMounted } from './storage.js';

export function getProfilePaths(username: string) {
  // Check for storage metadata
  const storage = loadStorageMetadata(username);

  let profileRoot: string;

  if (storage && isStorageDeviceMounted(storage.deviceId)) {
    // Use encrypted drive mount point
    profileRoot = storage.mountPoint;
  } else if (storage && !isStorageDeviceMounted(storage.deviceId)) {
    // Drive not mounted - policies determine behavior
    if (storage.policies.requireForWrite) {
      // Writes will fail, reads may use cache
      console.warn(`Storage device not mounted for ${username}, using fallback`);
    }
    profileRoot = path.join(ROOT, 'profiles', username);
  } else {
    // No storage metadata - use default
    profileRoot = path.join(ROOT, 'profiles', username);
  }

  return {
    root: profileRoot,
    persona: path.join(profileRoot, 'persona'),
    memory: path.join(profileRoot, 'memory'),
    // ... rest of paths
  };
}
```

Update `tryResolveProfilePath`:

```typescript
export function tryResolveProfilePath(
  key: keyof ReturnType<typeof getProfilePaths>
): PathResolutionResult {
  try {
    const context = getUserContext();

    if (context && context.username === 'anonymous' && !context.activeProfile) {
      return { ok: false, error: 'anonymous' };
    }

    if (context && (context.username !== 'anonymous' || context.activeProfile)) {
      const username = context.activeProfile || context.username;
      const storage = loadStorageMetadata(username);

      // Check if storage is required but not mounted
      if (storage && storage.policies.requireForWrite) {
        if (!isStorageDeviceMounted(storage.deviceId)) {
          return { ok: false, error: 'storage_unavailable' };
        }
      }

      const profilePaths = context.profilePaths;
      if (key in profilePaths) {
        return { ok: true, path: profilePaths[key as keyof typeof profilePaths] as string };
      }
      return { ok: false, error: 'invalid_key' };
    }

    // ... rest of implementation
  } catch (error) {
    return { ok: false, error: 'no_context' };
  }
}
```

### Step 3: CLI Storage Command

Create `packages/cli/src/commands/storage.ts`:

```typescript
import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { loadStorageMetadata, saveStorageMetadata, type StorageMetadata } from '@metahuman/core/storage';

export function createStorageCommand(): Command {
  const storage = new Command('storage')
    .description('Manage encrypted external storage');

  storage
    .command('list')
    .description('List available storage devices')
    .action(() => {
      // Platform-specific device listing
      console.log('Connected devices:');
      // Linux: lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
      // macOS: diskutil list
      // Windows: Get-Disk | Format-Table
    });

  storage
    .command('setup')
    .description('Format and encrypt a new drive')
    .requiredOption('--device <path>', 'Device path (e.g., /dev/sdb1)')
    .requiredOption('--user <username>', 'Username for this drive')
    .option('--encryption <type>', 'Encryption type (luks|apfs|bitlocker)', 'luks')
    .action(async (options) => {
      console.log(`Setting up encrypted drive for ${options.user}...`);

      // 1. Confirm device selection
      // 2. Format device
      // 3. Encrypt with passphrase
      // 4. Create filesystem
      // 5. Mount
      // 6. Create metadata
      // 7. Offer to migrate data
    });

  storage
    .command('mount <username>')
    .description('Mount encrypted drive for user')
    .action(async (username) => {
      const metadata = loadStorageMetadata(username);
      if (!metadata) {
        console.error(`No storage configured for ${username}`);
        process.exit(1);
      }

      // Platform-specific mount
      // Linux: cryptsetup open + mount
      // macOS: diskutil apfs unlockVolume
      // Windows: manage-bde -unlock + mountvol
    });

  // ... more commands

  return storage;
}
```

### Step 4: API Endpoint Example

Create `apps/site/src/pages/api/storage/status/[username].ts`:

```typescript
import type { APIRoute } from 'astro';
import { loadStorageMetadata, isStorageDeviceMounted } from '@metahuman/core/storage';
import { withUserContext } from '../../../../middleware/userContext';

const handler: APIRoute = async ({ params }) => {
  const username = params.username;

  if (!username) {
    return new Response(
      JSON.stringify({ error: 'Username required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const metadata = loadStorageMetadata(username);

  if (!metadata) {
    return new Response(
      JSON.stringify({ configured: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const isMounted = isStorageDeviceMounted(metadata.deviceId);

  return new Response(
    JSON.stringify({
      configured: true,
      mounted: isMounted,
      metadata,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

export const GET = withUserContext(handler);
```

---

## Common Pitfalls & Solutions

### Issue: Mount requires sudo privileges

**Solution**: Create systemd service or LaunchDaemon that runs as root, accepts limited commands

### Issue: Passphrase storage

**Solution**: Never store passphrases! Prompt at mount time or use OS keychain

### Issue: Drive not detected after reboot

**Solution**: Add udev rules (Linux) or plist entry (macOS) to auto-detect

### Issue: Performance degradation

**Solution**: Use SSD, enable filesystem caching, benchmark before deploying

### Issue: Lost recovery key

**Solution**: Enforce recovery key backup during setup, test recovery before deleting local copies

---

## Platform-Specific Notes

### Linux

- **Preferred**: LUKS (cryptsetup)
- **Requires**: `sudo` for cryptsetup/mount commands
- **Auto-mount**: `/etc/crypttab` + `/etc/fstab`
- **Detection**: `lsblk`, `blkid`

### macOS

- **Preferred**: APFS Encrypted
- **Requires**: Admin password for diskutil
- **Auto-mount**: LaunchDaemon with `diskutil apfs unlockVolume`
- **Detection**: `diskutil list`

### Windows

- **Preferred**: BitLocker
- **Requires**: Administrator privileges
- **Auto-mount**: Task Scheduler with `manage-bde -unlock`
- **Detection**: `Get-Volume`, `Get-Disk`

---

## Next Steps

1. **Review the full plan**: [SECURE_STORAGE_PLAN.md](SECURE_STORAGE_PLAN.md)
2. **Read security requirements**: [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md)
3. **Review implementation details**: [SECURE_STORAGE_IMPLEMENTATION_DETAILS.md](SECURE_STORAGE_IMPLEMENTATION_DETAILS.md)
4. **Start with Phase 1**: Core storage metadata and path resolution
5. **Write tests**: Before moving to next phase
6. **Iterate**: Get feedback after each phase

Good luck with the implementation! Refer back to [SECURITY_OVERVIEW.md](SECURITY_OVERVIEW.md) for how this fits into the overall security architecture.
