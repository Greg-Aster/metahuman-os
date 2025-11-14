# Secure Storage - Security Addendum

**Date**: 2025-11-13
**Status**: Required Reading Before Implementation
**Related**:
- [SECURE_STORAGE_PLAN.md](SECURE_STORAGE_PLAN.md) - Base implementation plan
- [SECURE_STORAGE_IMPLEMENTATION_DETAILS.md](SECURE_STORAGE_IMPLEMENTATION_DETAILS.md) - Concrete implementations for key derivation, tokens, testing

This document addresses critical security considerations that MUST be implemented alongside the base secure storage plan.

---

## Critical Security Issues & Mitigations

### 1. Storage Metadata Protection

**Issue**: Plaintext storage metadata in `profiles/<user>/etc/storage.json` leaks sensitive information even when drive is unplugged (device serials, gateway hosts, tunnel configs, recovery key fingerprints).

**Attack Vector**: Filesystem access reveals how to locate/attack user's hardware.

**Solution**: Minimize metadata, encrypt sensitive fields

#### Revised Storage Metadata Schema

```json
{
  // MINIMAL RUNTIME METADATA (plaintext, safe to expose)
  "deviceId": "UUID-from-lsblk",
  "mountPoint": "/mnt/mh/greggles",
  "autoMount": false,
  "policies": {
    "requireForWrite": true,
    "allowReadOnlyFallback": false,
    "autoEjectOnIdle": true,
    "idleTimeoutMinutes": 30
  },

  // SENSITIVE METADATA (encrypted with profile key or OS keychain)
  "_encrypted": {
    "deviceSerial": "ENCRYPTED(WD-ABC123)",
    "friendlyName": "ENCRYPTED(Metahuman Secure Drive - greggles)",
    "encryption": {
      "type": "ENCRYPTED(LUKS)",
      "cipher": "ENCRYPTED(aes-xts-plain64)",
      "keySize": "ENCRYPTED(512)"
    },
    "remote": {
      "enabled": "ENCRYPTED(true)",
      "method": "ENCRYPTED(sshfs)",
      "gatewayHost": "ENCRYPTED(192.168.1.100)",
      "tunnelConfig": "ENCRYPTED(/etc/wireguard/mh-tunnel.conf)"
    },
    "health": {
      "lastMounted": "ENCRYPTED(2025-11-13T10:30:00Z)",
      "smartStatus": "ENCRYPTED(PASSED)",
      "freeSpaceGB": "ENCRYPTED(250)"
    }
  }
}
```

#### Implementation

```typescript
// packages/core/src/storage-crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

/**
 * Derive encryption key from user profile password
 * Store salt in OS keychain, not in metadata file
 */
export function deriveStorageKey(username: string, password: string): Buffer {
  const salt = getKeychainValue(username, 'storage-salt') || randomBytes(SALT_LENGTH);
  if (!getKeychainValue(username, 'storage-salt')) {
    setKeychainValue(username, 'storage-salt', salt);
  }
  return scryptSync(password, salt, KEY_LENGTH);
}

export function encryptMetadataField(value: any, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptMetadataField(encrypted: string, key: Buffer): any {
  const [ivB64, tagB64, ciphertextB64] = encrypted.split(':');

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * OS Keychain integration (platform-specific)
 */
function getKeychainValue(username: string, key: string): Buffer | null {
  // Linux: libsecret / gnome-keyring
  // macOS: Keychain Access (security command)
  // Windows: Windows Credential Manager (cmdkey)
  // TODO: Implement platform-specific calls
  return null;
}

function setKeychainValue(username: string, key: string, value: Buffer): void {
  // Store in OS keychain, NOT filesystem
  // TODO: Implement platform-specific calls
}
```

**Metadata Rotation**: If drive is replaced/compromised, regenerate `deviceId` and re-encrypt all `_encrypted` fields with new key.

---

### 2. Cache Protection (Read-Only Fallback)

**Issue**: Serving cached copies from `profiles/<user>/.cache` means sensitive memories remain unencrypted on server, defeating physical security goal.

**Attack Vector**: Attacker with filesystem access reads cached data even when drive is unplugged.

**Solution**: Encrypt cache or disable fallback by default

#### Option A: Encrypted Cache (Recommended)

```typescript
// packages/core/src/storage-cache.ts
import { encryptMetadataField, decryptMetadataField, deriveStorageKey } from './storage-crypto.js';

/**
 * Write memory to encrypted cache
 * Cache is only readable with user's profile key
 */
export function writeCacheEntry(username: string, relPath: string, data: any): void {
  const cacheDir = path.join(systemPaths.profiles, username, '.cache', 'encrypted');
  const key = deriveStorageKey(username, getUserProfileKey(username));

  const encrypted = encryptMetadataField(data, key);
  const cachePath = path.join(cacheDir, `${relPath}.enc`);

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, encrypted);
}

/**
 * Read from encrypted cache
 * Requires user authentication to decrypt
 */
export function readCacheEntry(username: string, relPath: string): any | null {
  const cacheDir = path.join(systemPaths.profiles, username, '.cache', 'encrypted');
  const cachePath = path.join(cacheDir, `${relPath}.enc`);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  const key = deriveStorageKey(username, getUserProfileKey(username));
  const encrypted = fs.readFileSync(cachePath, 'utf-8');

  return decryptMetadataField(encrypted, key);
}
```

#### Option B: Disable Fallback (High Security)

```json
{
  "policies": {
    "allowReadOnlyFallback": false  // Default to false
  }
}
```

**Documentation Update**: Add explicit warning that enabling fallback trades data-at-rest protection for availability.

---

### 3. Remote Access Security

**Issue**: SSHFS/WireGuard guidance omits host authentication, key rotation, and rate-limiting.

**Attack Vector**: Man-in-the-middle, stolen keys, brute-force attacks.

**Solution**: Mutual authentication, key rotation, locked-down exports

#### Mutual TLS for Remote Mounts

```bash
# Generate certificates for mutual authentication
# Server certificate
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes

# Client certificate
openssl req -x509 -newkey rsa:4096 -keyout client.key -out client.crt -days 365 -nodes

# Both sides verify each other's certificates
```

#### WireGuard with Pre-Shared Keys

```ini
# /etc/wireguard/mh-tunnel.conf
[Interface]
PrivateKey = <server-private-key>
Address = 10.0.0.1/24
ListenPort = 51820

[Peer]
PublicKey = <owner-public-key>
PresharedKey = <rotating-psk>  # Rotate monthly
AllowedIPs = 10.0.0.2/32
PersistentKeepalive = 25
```

#### Read-Only NFS Export with IP Allowlist

```bash
# /etc/exports (Linux)
/mnt/mh/greggles 10.0.0.2(ro,sync,no_subtree_check,root_squash)

# Only allow specific WireGuard peer IP
# root_squash prevents root access
# ro = read-only (critical!)
```

#### Key Rotation Policy

```typescript
// packages/core/src/storage-remote.ts

/**
 * Check if remote access keys need rotation
 * Enforce 30-day maximum key lifetime
 */
export function checkKeyRotation(username: string): { needsRotation: boolean; daysRemaining: number } {
  const metadata = loadStorageMetadata(username);
  if (!metadata?.remote?.keyRotation) {
    return { needsRotation: true, daysRemaining: 0 };
  }

  const lastRotated = new Date(metadata.remote.keyRotation.lastRotated);
  const daysSince = (Date.now() - lastRotated.getTime()) / (1000 * 60 * 60 * 24);
  const maxAge = 30; // days

  return {
    needsRotation: daysSince >= maxAge,
    daysRemaining: Math.max(0, maxAge - daysSince)
  };
}

/**
 * Rotate WireGuard PSK
 */
export async function rotateRemoteKey(username: string): Promise<void> {
  // 1. Generate new PSK
  const newPsk = execSync('wg genpsk').toString().trim();

  // 2. Update server config
  updateWireGuardPsk(username, newPsk);

  // 3. Notify owner to update their client config
  notifyKeyRotation(username);

  // 4. Update metadata
  const metadata = loadStorageMetadata(username);
  metadata.remote.keyRotation = {
    lastRotated: new Date().toISOString(),
    nextRotation: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
  saveStorageMetadata(username, metadata);

  // 5. Audit log
  audit({
    level: 'info',
    category: 'security',
    event: 'remote_key_rotated',
    details: { username },
    actor: 'system'
  });
}
```

#### Rate Limiting

```typescript
// packages/core/src/storage-remote.ts

const mountAttempts = new Map<string, number[]>();

export function rateLimitMountAttempt(username: string): boolean {
  const now = Date.now();
  const attempts = mountAttempts.get(username) || [];

  // Remove attempts older than 1 hour
  const recentAttempts = attempts.filter(t => now - t < 3600000);

  // Max 10 mount attempts per hour
  if (recentAttempts.length >= 10) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'mount_rate_limit_exceeded',
      details: { username, attempts: recentAttempts.length },
      actor: username
    });
    return false;
  }

  recentAttempts.push(now);
  mountAttempts.set(username, recentAttempts);
  return true;
}
```

---

### 4. Privilege Separation for Auto-Mount

**Issue**: Auto-mount services run `./bin/mh storage mount` as root, but plan doesn't cover privilege separation.

**Attack Vector**: Web API can execute arbitrary mount commands with root privileges.

**Solution**: Dedicated mount daemon with narrow interface

#### mh-storaged - Privileged Mount Daemon

```typescript
// brain/services/mh-storaged.ts
/**
 * Privileged daemon for storage operations
 * Runs as root/systemd service, listens on Unix socket
 * Only accepts pre-defined commands with strict validation
 */

import net from 'node:net';
import { validateSession } from '@metahuman/core/sessions';
import { getUserByUsername } from '@metahuman/core/users';
import { audit } from '@metahuman/core/audit';

const SOCKET_PATH = '/var/run/mh-storaged.sock';

interface MountRequest {
  command: 'mount' | 'unmount' | 'health';
  username: string;
  sessionToken: string;
  metadata?: any;
}

const server = net.createServer((socket) => {
  socket.on('data', async (data) => {
    try {
      const request: MountRequest = JSON.parse(data.toString());

      // 1. Validate session
      const session = validateSession(request.sessionToken);
      if (!session || session.username !== request.username) {
        socket.write(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // 2. Validate user exists and is owner
      const user = getUserByUsername(request.username);
      if (!user || user.role !== 'owner') {
        socket.write(JSON.stringify({ error: 'Permission denied' }));
        return;
      }

      // 3. Execute command with strict validation
      switch (request.command) {
        case 'mount':
          await executeMount(request.username, request.metadata);
          break;
        case 'unmount':
          await executeUnmount(request.username);
          break;
        case 'health':
          await checkHealth(request.username);
          break;
        default:
          throw new Error(`Unknown command: ${request.command}`);
      }

      socket.write(JSON.stringify({ success: true }));
    } catch (error) {
      socket.write(JSON.stringify({ error: (error as Error).message }));
    }
  });
});

server.listen(SOCKET_PATH, () => {
  console.log(`mh-storaged listening on ${SOCKET_PATH}`);

  // Set socket permissions (only root + metahuman group)
  fs.chmodSync(SOCKET_PATH, 0o660);
  fs.chownSync(SOCKET_PATH, 0, getGroupId('metahuman'));
});

async function executeMount(username: string, metadata: any): Promise<void> {
  // Strict validation - no shell injection
  const deviceId = sanitizeDeviceId(metadata.deviceId);
  const mountPoint = sanitizePath(metadata.mountPoint);

  // Execute mount command
  // Platform-specific: LUKS, APFS, BitLocker

  // Audit log
  audit({
    level: 'info',
    category: 'security',
    event: 'storage_mounted',
    details: { username, deviceId, mountPoint },
    actor: 'mh-storaged'
  });
}
```

#### Client API (Unprivileged)

```typescript
// packages/core/src/storage-daemon-client.ts
import net from 'node:net';

export async function requestMount(username: string, sessionToken: string): Promise<void> {
  const client = net.createConnection({ path: '/var/run/mh-storaged.sock' });

  return new Promise((resolve, reject) => {
    client.write(JSON.stringify({
      command: 'mount',
      username,
      sessionToken
    }));

    client.on('data', (data) => {
      const response = JSON.parse(data.toString());
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve();
      }
      client.end();
    });
  });
}
```

**Systemd Service**:

```ini
# /etc/systemd/system/mh-storaged.service
[Unit]
Description=MetaHuman Storage Daemon
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/node /home/greggles/metahuman/brain/services/mh-storaged.js
Restart=on-failure

# Security hardening
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=true
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

---

### 5. Rollback & Incident Procedures

**Issue**: No documented rollback if Phase 1 breaks existing profiles.

**Solution**: Comprehensive rollback plan

#### Rollback Procedure

```bash
#!/bin/bash
# scripts/rollback-storage.sh

USERNAME=$1

if [ -z "$USERNAME" ]; then
  echo "Usage: ./scripts/rollback-storage.sh <username>"
  exit 1
fi

echo "Rolling back storage changes for $USERNAME..."

# 1. Backup storage metadata
if [ -f "profiles/$USERNAME/etc/storage.json" ]; then
  cp "profiles/$USERNAME/etc/storage.json" "profiles/$USERNAME/etc/storage.json.backup"
  echo "✓ Backed up storage metadata"
fi

# 2. Disable storage metadata detection
if [ -f "profiles/$USERNAME/etc/storage.json" ]; then
  mv "profiles/$USERNAME/etc/storage.json" "profiles/$USERNAME/etc/storage.json.disabled"
  echo "✓ Disabled storage metadata"
fi

# 3. Restore paths to default behavior
# (Path resolver will fall back to profiles/<username>/)

# 4. Re-link any moved directories
MOUNT_POINT=$(grep -Po '"mountPoint":\s*"\K[^"]+' "profiles/$USERNAME/etc/storage.json.disabled" || echo "")

if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
  for DIR in memory persona logs out etc; do
    if [ -d "$MOUNT_POINT/$DIR" ] && [ ! -d "profiles/$USERNAME/$DIR" ]; then
      echo "Copying $DIR back from mount point..."
      rsync -av "$MOUNT_POINT/$DIR/" "profiles/$USERNAME/$DIR/"
      echo "✓ Restored $DIR"
    fi
  done
fi

# 5. Verify integrity
echo "Verifying profile integrity..."
REQUIRED_DIRS="memory persona logs out etc"
for DIR in $REQUIRED_DIRS; do
  if [ ! -d "profiles/$USERNAME/$DIR" ]; then
    echo "❌ Missing directory: $DIR"
    exit 1
  fi
done

echo "✅ Rollback complete for $USERNAME"
echo "Storage metadata disabled, paths restored to default"
echo "To re-enable: mv profiles/$USERNAME/etc/storage.json.disabled profiles/$USERNAME/etc/storage.json"
```

---

### 6. Automated Testing Matrix

**Issue**: No automated tests for failure scenarios (drive missing mid-write, corrupted metadata, remote mount failure).

**Solution**: Comprehensive test suite

```typescript
// tests/storage-failure-tests.ts

describe('Storage Failure Scenarios', () => {
  describe('Drive Missing Mid-Write', () => {
    it('should return 503 Service Unavailable when drive unplugged during write', async () => {
      // 1. Mount drive
      await mountStorage('testuser');

      // 2. Start write operation
      const writePromise = writeMemory('testuser', { content: 'test' });

      // 3. Simulate drive removal
      await simulateDriveRemoval('testuser');

      // 4. Verify graceful failure
      await expect(writePromise).rejects.toThrow('Storage unavailable');
    });

    it('should queue writes and retry after drive reconnected', async () => {
      // Enable write queue policy
      // Unmount drive
      // Attempt write (should queue)
      // Remount drive
      // Verify queued write completes
    });
  });

  describe('Corrupted Metadata', () => {
    it('should fall back to default paths if metadata is corrupted', async () => {
      // Write invalid JSON to storage.json
      // Attempt path resolution
      // Verify falls back to profiles/<user>/
    });

    it('should log corruption warning to audit trail', async () => {
      // Corrupt metadata
      // Load storage metadata
      // Verify audit log entry
    });
  });

  describe('Remote Mount Failure', () => {
    it('should timeout after 30s if gateway unreachable', async () => {
      // Configure remote mount with invalid gateway
      // Attempt mount
      // Verify timeout and fallback
    });

    it('should retry with exponential backoff', async () => {
      // Simulate intermittent network failure
      // Verify retry attempts with backoff
    });
  });

  describe('Concurrent Mounts', () => {
    it('should prevent mounting same device twice', async () => {
      // Mount drive
      // Attempt second mount
      // Verify lock prevents concurrent mount
    });
  });

  describe('Partial Migration', () => {
    it('should rollback if migration fails midway', async () => {
      // Start migration
      // Simulate failure after 50% copied
      // Verify rollback to original state
    });
  });
});
```

---

### 7. Data-at-Rest vs. Data-in-Use

**Issue**: Encrypted storage only protects data at rest, not when drive is mounted.

**Solution**: Explicit documentation and auto-eject defaults

#### Updated Security Overview

Add to `docs/SECURITY_OVERVIEW.md`:

```markdown
## Threat Model: Encrypted Storage Limitations

### What Encrypted Storage Protects

✅ **Data at Rest**: Files are encrypted when drive is unplugged
✅ **Physical Theft**: Stolen drive is unreadable without passphrase
✅ **Server Compromise (Drive Unmounted)**: Attacker cannot access memories
✅ **Multi-User Isolation**: Each user controls their own physical drive

### What Encrypted Storage Does NOT Protect

❌ **Data in Use**: When drive is mounted, files are accessible
❌ **Active Compromise**: Attacker with shell access while drive mounted can read data
❌ **Memory Dumps**: Data in RAM is not encrypted
❌ **Side Channels**: Timing attacks, cache analysis

### Recommended Mitigations

1. **Auto-Eject on Idle** (Default: 30 minutes)
   ```json
   {
     "policies": {
       "autoEjectOnIdle": true,
       "idleTimeoutMinutes": 30
     }
   }
   ```

2. **Manual Eject When Done**
   ```bash
   ./bin/mh storage unmount greggles
   ```

3. **Memory-Level Encryption** (Future Enhancement)
   - Encrypt sensitive fields in memory
   - Clear buffers after use
   - Require re-authentication for sensitive operations

4. **Minimize Mount Time**
   - Only mount when actively using system
   - Eject before stepping away
   - Use read-only fallback for passive access

5. **Physical Security**
   - Lock workstation when mounted
   - Use full-disk encryption on host OS
   - Keep drives in secure location when unmounted
```

---

## Updated Implementation Checklist

Add these security tasks to each phase:

### Phase 1: Core Storage Metadata

- [ ] Implement metadata field encryption
- [ ] Integrate OS keychain for salt/keys
- [ ] Add metadata rotation on drive replacement
- [ ] Add corrupted metadata fallback handling

### Phase 2: CLI Storage Helper

- [ ] Add passphrase confirmation prompts
- [ ] Warn about fallback data-at-rest trade-offs
- [ ] Implement encrypted cache option
- [ ] Add metadata integrity checks

### Phase 3: Web UI

- [ ] Show warning when enabling fallback
- [ ] Display data-at-rest status clearly
- [ ] Add auto-eject idle timer UI
- [ ] Show mount time duration

### Phase 4: Auto-Mount

- [ ] Implement mh-storaged daemon
- [ ] Add privilege separation
- [ ] Strict command validation
- [ ] Audit all mount/unmount operations

### Phase 5: Remote Access

- [ ] Implement mutual TLS authentication
- [ ] Add WireGuard PSK rotation
- [ ] Enforce read-only NFS exports
- [ ] Add rate limiting
- [ ] Document key rotation procedures

### Phase 6: Security Policies

- [ ] Default allowReadOnlyFallback to false
- [ ] Default autoEjectOnIdle to true (30 min)
- [ ] Implement encrypted cache
- [ ] Add data-in-use warnings to UI

### Phase 7: Testing & Rollback

- [ ] Write failure scenario tests
- [ ] Document rollback procedures
- [ ] Test metadata corruption recovery
- [ ] Test concurrent mount prevention
- [ ] Test partial migration rollback

---

## Security Checklist for Deployment

Before enabling encrypted storage in production:

- [ ] All metadata sensitive fields encrypted
- [ ] Passphrases stored in OS keychain only
- [ ] mh-storaged running with privilege separation
- [ ] Auto-eject on idle enabled by default
- [ ] Read-only fallback disabled or encrypted
- [ ] Remote access uses mutual TLS/PSK
- [ ] Key rotation scheduled (30-day max)
- [ ] Rate limiting enabled
- [ ] Rollback procedures tested
- [ ] Failure scenarios tested
- [ ] Users warned about data-in-use limitations
- [ ] Audit logging verified for all mount operations

---

## Summary

This addendum addresses critical security gaps:

1. **Metadata Protection**: Encrypt sensitive fields, use OS keychain
2. **Cache Security**: Encrypt cache or disable fallback by default
3. **Remote Access**: Mutual auth, key rotation, rate limits, read-only exports
4. **Privilege Separation**: Dedicated daemon for mount operations
5. **Rollback Procedures**: Documented recovery from failures
6. **Automated Testing**: Comprehensive failure scenario coverage
7. **Threat Model**: Explicit data-at-rest vs. data-in-use limitations

Implement these alongside the base plan before deploying encrypted storage to production.
