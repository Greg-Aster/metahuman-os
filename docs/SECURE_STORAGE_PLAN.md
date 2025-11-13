# Secure Storage System - Implementation Plan

**Date**: 2025-11-13
**Status**: Planning
**Feature**: Encrypted external drive support for user profile data

⚠️ **CRITICAL**: Before implementing, read:
- [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md) - Required security mitigations
- [SECURE_STORAGE_IMPLEMENTATION_DETAILS.md](SECURE_STORAGE_IMPLEMENTATION_DETAILS.md) - Key derivation, session tokens, testing infrastructure

## Overview

This system allows users to store sensitive profile data (memories, persona, models) on encrypted external drives that are only accessible when physically connected. This provides:

1. **Physical Security**: Data is encrypted at rest and requires the drive to be present
2. **User Ownership**: Each user controls their own data physically
3. **Minimal Server Exposure**: Central server never stores plaintext sensitive data
4. **Remote Access**: Users can mount drives remotely when needed via secure tunnels
5. **Flexible Security**: Configurable per-user encryption levels and data placement

---

## Architecture

### Storage Metadata Schema

⚠️ **SECURITY WARNING**: This schema contains sensitive information. See [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md#1-storage-metadata-protection) for encryption requirements.

Each profile can have a `profiles/<username>/etc/storage.json` file:

```json
{
  "deviceId": "UUID-from-lsblk-or-diskutil",
  "deviceSerial": "WD-ABC123",
  "friendlyName": "Metahuman Secure Drive - greggles",
  "mountPoint": "/mnt/mh/greggles",
  "encryption": {
    "type": "LUKS" | "APFS-Encrypted" | "BitLocker" | "VeraCrypt" | "none",
    "cipher": "aes-xts-plain64",
    "keySize": 512,
    "passwordProtected": true,
    "hasRecoveryKey": true
  },
  "directories": [
    "memory",
    "persona/facets",
    "etc/models.json",
    "out/voice-training"
  ],
  "autoMount": true,
  "policies": {
    "requireForWrite": true,
    "allowReadOnlyFallback": false,  // ⚠️ Default false - see security addendum
    "autoEjectOnIdle": true,         // ⚠️ Default true for security
    "idleTimeoutMinutes": 30
  },
  "remote": {
    "enabled": false,
    "method": "sshfs" | "wireguard" | "sync",
    "gatewayHost": "192.168.1.100",
    "tunnelConfig": "/etc/wireguard/mh-tunnel.conf"
  },
  "health": {
    "lastMounted": "2025-11-13T10:30:00Z",
    "lastChecked": "2025-11-13T12:00:00Z",
    "smartStatus": "PASSED",
    "freeSpaceGB": 250,
    "totalSpaceGB": 500
  }
}
```

### Path Resolution Changes

Update `packages/core/src/paths.ts` to check for storage metadata:

1. If `storage.json` exists and device is mounted → use `mountPoint` as profile root
2. If `storage.json` exists but device is NOT mounted:
   - `requireForWrite: true` → return 503 Service Unavailable for writes
   - `allowReadOnlyFallback: true` → use cached/local copies for reads
3. If `storage.json` doesn't exist → use default `profiles/<username>/` path

---

## Implementation Phases

### Phase 1: Core Storage Metadata & Path Resolution

**Files to Create/Modify:**
- `packages/core/src/storage.ts` - New module for storage operations
- `packages/core/src/paths.ts` - Modify to check storage metadata
- `packages/core/src/storage-health.ts` - Drive health monitoring

**Key Functions:**

```typescript
// packages/core/src/storage.ts
export interface StorageMetadata { /* schema above */ }

export function loadStorageMetadata(username: string): StorageMetadata | null
export function saveStorageMetadata(username: string, metadata: StorageMetadata): void
export function isStorageDeviceMounted(deviceId: string): boolean
export function getDeviceMountPoint(deviceId: string): string | null
export function validateStorageDevice(metadata: StorageMetadata): { ok: boolean; error?: string }

// packages/core/src/storage-health.ts
export function checkDriveHealth(mountPoint: string): HealthStatus
export function getSmartStatus(devicePath: string): SmartData
export function getFreeSpace(mountPoint: string): { free: number; total: number }
```

**Path Resolution Updates:**

```typescript
// In packages/core/src/paths.ts
export function getProfilePaths(username: string) {
  const storage = loadStorageMetadata(username);

  if (storage) {
    // Check if device is mounted
    if (isStorageDeviceMounted(storage.deviceId)) {
      const profileRoot = storage.mountPoint;
      // Return paths based on mountPoint
    } else {
      // Device not mounted - check policies
      if (storage.policies.requireForWrite) {
        // Writes will fail, reads may use fallback
      }
    }
  }

  // Default: profiles/<username>
  const profileRoot = path.join(ROOT, 'profiles', username);
  // ...
}
```

### Phase 2: CLI Storage Helper (`bin/mh storage`)

**Commands:**

```bash
# List available devices
./bin/mh storage list

# Setup new encrypted drive
./bin/mh storage setup --device /dev/sdb1 --user greggles --encryption luks

# Register existing encrypted drive
./bin/mh storage register --device /dev/sdb1 --user greggles --mount-point /mnt/mh/greggles

# Mount registered drive
./bin/mh storage mount greggles

# Unmount drive
./bin/mh storage unmount greggles

# Check drive health
./bin/mh storage health greggles

# Migrate data to encrypted drive
./bin/mh storage migrate greggles --directories memory,persona

# Generate recovery key
./bin/mh storage recovery-key greggles
```

**Implementation:** `packages/cli/src/commands/storage.ts`

### Phase 3: Web UI - Secure Storage Panel

**Location:** `apps/site/src/pages/api/storage/*`

**API Endpoints:**

- `GET /api/storage/devices` - List connected devices
- `GET /api/storage/status/:username` - Get storage status for user
- `POST /api/storage/setup` - Format and encrypt new drive
- `POST /api/storage/register` - Register existing drive
- `POST /api/storage/mount` - Mount drive
- `POST /api/storage/unmount` - Unmount drive
- `POST /api/storage/migrate` - Move data to drive
- `GET /api/storage/health/:username` - Health check

**UI Components:**

```svelte
<!-- apps/site/src/components/SecureStorage.svelte -->
<script>
  // Storage status display
  // Drive registration wizard
  // Mount/unmount controls
  // Data migration interface
  // Health monitoring dashboard
</script>
```

**Settings Tab:** Add "Secure Storage" section to Settings with:
- Connected devices list
- Registration wizard
- Mount/unmount buttons
- Data selection (what to move to drive)
- Encryption level selector
- Policy toggles (require for write, allow fallback, auto-eject)
- Health indicators (SMART status, free space, last mounted)

### Phase 4: Auto-Mount on Boot

⚠️ **SECURITY CRITICAL**: Requires privilege separation via dedicated daemon. See [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md#4-privilege-separation-for-auto-mount).

**Linux (`/etc/systemd/system/metahuman-storage@.service`):**

```ini
[Unit]
Description=Metahuman Secure Storage for %i
After=local-fs.target

[Service]
Type=oneshot
User=greggles
ExecStart=/home/greggles/metahuman/bin/mh storage mount %i
RemainAfterExit=yes
ExecStop=/home/greggles/metahuman/bin/mh storage unmount %i

[Install]
WantedBy=multi-user.target
```

**Enable:** `sudo systemctl enable metahuman-storage@greggles.service`

**macOS (LaunchDaemon):**

```xml
<!-- /Library/LaunchDaemons/com.metahuman.storage.greggles.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.metahuman.storage.greggles</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/greggles/metahuman/bin/mh</string>
        <string>storage</string>
        <string>mount</string>
        <string>greggles</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

### Phase 5: Remote Access

⚠️ **SECURITY CRITICAL**: Remote access requires mutual TLS, key rotation, and rate limiting. See [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md#3-remote-access-security).

**Option A: SSHFS Tunnel**

```bash
# On owner machine (has the drive):
sshfs user@server:/mnt/mh/greggles /mnt/remote-greggles

# Or reverse tunnel from server:
ssh -R 2222:localhost:22 server
# Server mounts: sshfs -p 2222 localhost:/mnt/mh/greggles /profiles/greggles
```

**Option B: WireGuard + NFS/Samba**

1. Set up WireGuard tunnel between owner device and server
2. Export drive via NFS/Samba over WireGuard interface only
3. Server mounts network share as profile root

**Option C: Encrypted Sync**

```bash
# When drive is connected locally, push encrypted snapshot to server
rsync -az --delete /mnt/mh/greggles/ user@server:/encrypted-snapshots/greggles/

# Server decrypts only in memory when needed
```

**Implementation:** Add remote mount helpers to `packages/core/src/storage-remote.ts`

### Phase 6: Security Policies & Fallback

**Write Protection When Drive Missing:**

```typescript
// In tryResolveProfilePath helper
const storage = loadStorageMetadata(username);
if (storage && storage.policies.requireForWrite) {
  if (!isStorageDeviceMounted(storage.deviceId)) {
    return { ok: false, error: 'storage_unavailable' };
  }
}
```

**Read-Only Fallback:**

⚠️ **SECURITY WARNING**: Caching sensitive data defeats physical security goals. See [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md#2-cache-protection-read-only-fallback).

Keep cached copies in `profiles/<username>/.cache/encrypted/` that sync from drive when mounted. Cache MUST be encrypted with profile key. When drive is unmounted, reads use encrypted cache (marked as read-only).

**Auto-Eject on Idle:**

```typescript
// In scheduler-service or new storage-monitor agent
setInterval(() => {
  for (const user of getUsers()) {
    const storage = loadStorageMetadata(user.username);
    if (storage?.policies.autoEjectOnIdle) {
      const lastActivity = getLastActivity(user.username);
      const idleMinutes = (Date.now() - lastActivity) / 60000;

      if (idleMinutes >= storage.policies.idleTimeoutMinutes) {
        unmountStorage(user.username);
      }
    }
  }
}, 60000); // Check every minute
```

---

## Platform-Specific Setup Instructions

### Linux (LUKS)

```bash
# 1. Find device
lsblk

# 2. Format and encrypt
sudo cryptsetup luksFormat /dev/sdb1
# Enter passphrase when prompted

# 3. Open encrypted device
sudo cryptsetup open /dev/sdb1 mh_greggles

# 4. Create filesystem
sudo mkfs.ext4 /dev/mapper/mh_greggles

# 5. Create mount point
sudo mkdir -p /mnt/mh/greggles

# 6. Mount
sudo mount /dev/mapper/mh_greggles /mnt/mh/greggles

# 7. Set ownership
sudo chown -R greggles:greggles /mnt/mh/greggles

# 8. Get UUID for metadata
sudo blkid /dev/sdb1
# Copy the UUID value

# 9. Create recovery key (optional)
sudo cryptsetup luksAddKey /dev/sdb1
# Store this key securely offline
```

**Auto-mount via crypttab/fstab:**

```bash
# /etc/crypttab
mh_greggles UUID=<device-uuid> none luks,noauto

# /etc/fstab
/dev/mapper/mh_greggles /mnt/mh/greggles ext4 noauto,user 0 0
```

### macOS (APFS Encrypted)

```bash
# 1. List disks
diskutil list

# 2. Create encrypted APFS volume
diskutil apfs addVolume disk2 APFS "Metahuman-greggles" -passphrase

# 3. Get volume UUID
diskutil info /Volumes/Metahuman-greggles | grep UUID
# Copy Volume UUID

# 4. Unmount to test
diskutil unmount /Volumes/Metahuman-greggles

# 5. Mount with passphrase
diskutil apfs unlockVolume disk2s2 -passphrase
```

### Windows (BitLocker)

```powershell
# 1. List drives
Get-Disk

# 2. Enable BitLocker (requires admin)
Enable-BitLocker -MountPoint E: -EncryptionMethod Aes256 -Password (ConvertTo-SecureString "passphrase" -AsPlainText -Force) -PasswordProtector

# 3. Save recovery key
(Get-BitLockerVolume -MountPoint E:).KeyProtector | Where-Object {$_.KeyProtectorType -eq 'RecoveryPassword'} | Select-Object RecoveryPassword

# 4. Get volume ID
Get-BitLockerVolume -MountPoint E: | Select-Object VolumeId
```

---

## Migration Process

When a user enables secure storage for the first time:

1. **Backup Check:** Verify user has backups
2. **Drive Setup:** Format and encrypt the drive
3. **Register:** Create `storage.json` metadata
4. **Move Data:**
   ```bash
   rsync -av --progress profiles/greggles/memory/ /mnt/mh/greggles/memory/
   ```
5. **Create Symlink (optional):**
   ```bash
   mv profiles/greggles/memory profiles/greggles/memory.backup
   ln -s /mnt/mh/greggles/memory profiles/greggles/memory
   ```
6. **Update Paths:** Path resolver now uses mount point
7. **Verify:** Test reads/writes work correctly
8. **Remove Backup:** After confirmation, delete `profiles/greggles/memory.backup`

---

## Security Considerations

### Passphrase Management

- **Never store passphrases in code or config files**
- Prompt user at mount time or use OS keychain (Keychain Access, gnome-keyring, Windows Credential Manager)
- Option to use keyfiles stored on second device (2FA approach)

### Recovery Keys

- Generate during setup
- Store offline (print or password manager)
- Test recovery process before deleting local backups

### Permissions

- Mount helper may need sudo/admin privileges
- Consider creating systemd service or LaunchDaemon that runs as root but restricts commands
- Alternative: Use `udisks2` (Linux) or Disk Utility (macOS) which handle permissions

### Audit Trail

All storage operations should be logged:

```typescript
audit({
  level: 'info',
  category: 'security',
  event: 'storage_mounted',
  details: {
    username: 'greggles',
    deviceId: 'UUID-123',
    mountPoint: '/mnt/mh/greggles'
  },
  actor: 'system'
});
```

---

## Testing Plan

⚠️ **TESTING REQUIRED**: Must test failure scenarios before production. See [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md#6-automated-testing-matrix).

1. **Unit Tests:**
   - Storage metadata loading/saving
   - Path resolution with/without mounted storage
   - Device detection logic

2. **Integration Tests:**
   - Full setup workflow
   - Mount/unmount cycles
   - Fallback behavior when drive missing
   - Remote access scenarios

3. **Manual Testing:**
   - Physical drive plug/unplug
   - Boot with drive connected/disconnected
   - Multi-user scenarios
   - Recovery from drive failure

---

## User Documentation

Create `docs/user-guide/21-secure-storage.md` with:

1. Why use secure storage?
2. Step-by-step setup wizard screenshots
3. Drive recommendations (SSDs, capacity)
4. Backup best practices
5. Troubleshooting (drive not detected, mount failures, etc.)
6. Remote access setup guide
7. Recovery procedures

---

## Performance Considerations

- **USB 3.0+ Required:** USB 2.0 will be too slow for LLM model loading
- **SSD Preferred:** Mechanical drives add 50-100ms latency per file access
- **Caching:** Keep frequently accessed files (persona core, config) in local cache
- **Lazy Loading:** Only mount when user actually accesses protected data

---

## Future Enhancements

1. **Multi-Drive Support:** Allow splitting data across multiple drives (memories on one, models on another)
2. **Cloud Backup Integration:** Encrypted snapshots to S3/Backblaze
3. **Hardware Security Keys:** YubiKey support for drive unlocking
4. **Mobile Apps:** iOS/Android apps to control remote mounting
5. **RAID:** Mirror critical data across two drives for redundancy

---

## Risk Assessment

⚠️ **See [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md#7-data-at-rest-vs-data-in-use) for complete threat model.**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Drive failure | Medium | High | Regular backups, SMART monitoring, recovery keys |
| Lost passphrase | Low | Critical | Recovery keys stored offline, optional keyfile 2FA |
| Performance degradation | Medium | Medium | SSD requirement, encrypted caching, benchmark tests |
| Mount failures | Medium | Medium | Graceful fallback, clear error messages, health checks |
| Remote access exploits | Low | High | Mutual TLS/PSK, key rotation, rate limits, read-only exports |
| Metadata leakage | High | Medium | Encrypt sensitive fields, use OS keychain |
| Cache exposure | High | High | Encrypt cache or disable fallback by default |
| Privilege escalation | Medium | Critical | Dedicated mount daemon with privilege separation |
| Compromise while mounted | Medium | High | Auto-eject on idle (default 30min), physical security |

---

## Timeline Estimate

- **Phase 1** (Core Storage): 3-5 days
- **Phase 2** (CLI Tools): 2-3 days
- **Phase 3** (Web UI): 3-4 days
- **Phase 4** (Auto-Mount): 1-2 days
- **Phase 5** (Remote Access): 3-4 days
- **Phase 6** (Policies & Testing): 2-3 days

**Total:** 14-21 days for full implementation and testing

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Create GitHub issues** for each phase
3. **Set up test environment** with USB drives
4. **Draft storage metadata schema** in TypeScript
5. **Begin Phase 1 implementation**

Would you like me to start implementing any specific phase, or would you prefer to have your other agent create a more detailed breakdown first?
