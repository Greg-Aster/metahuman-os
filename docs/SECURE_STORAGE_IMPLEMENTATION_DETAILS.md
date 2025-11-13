# Secure Storage - Implementation Details

**Date**: 2025-11-13
**Status**: Required Supplement
**Related**: SECURE_STORAGE_SECURITY_ADDENDUM.md

This document fills critical implementation gaps identified in the security addendum.

---

## 1. Profile Key Derivation

### Problem

The security addendum references `getUserProfileKey()` and `deriveStorageKey()` without defining where the profile password comes from.

### Solution: Multi-Tier Key Derivation

```typescript
// packages/core/src/profile-crypto.ts

import { scryptSync, randomBytes, pbkdf2Sync } from 'node:crypto';
import { systemPaths } from './paths.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Derive profile encryption key from user's login password
 *
 * Key hierarchy:
 * 1. User login password (entered at authentication)
 * 2. Profile master key (derived with scrypt, salt stored in OS keychain)
 * 3. Storage encryption key (derived from master key for specific use)
 */

const KEY_LENGTH = 32; // 256 bits
const SCRYPT_N = 2**14; // CPU/memory cost (16384)
const SCRYPT_R = 8;     // Block size
const SCRYPT_P = 1;     // Parallelization

interface ProfileKeys {
  masterKey: Buffer;
  storageKey: Buffer;
  cacheKey: Buffer;
}

/**
 * Derive profile master key from user password
 * Called during login, result cached in memory for session lifetime
 */
export function deriveProfileKey(username: string, password: string): Buffer {
  const salt = getOrCreateProfileSalt(username);

  return scryptSync(
    password,
    salt,
    KEY_LENGTH,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }
  );
}

/**
 * Derive storage-specific key from profile master key
 */
export function deriveStorageKey(masterKey: Buffer, purpose: 'metadata' | 'cache'): Buffer {
  const info = `metahuman-storage-${purpose}`;

  return pbkdf2Sync(
    masterKey,
    info,
    100000, // iterations
    KEY_LENGTH,
    'sha256'
  );
}

/**
 * Get or create profile salt
 * Stored in OS keychain (secure) or fallback to file with warning
 */
function getOrCreateProfileSalt(username: string): Buffer {
  // Try OS keychain first
  const keychainSalt = getKeychainValue(username, 'profile-salt');
  if (keychainSalt) {
    return keychainSalt;
  }

  // Fallback: generate and store
  const salt = randomBytes(32);

  try {
    setKeychainValue(username, 'profile-salt', salt);
  } catch (error) {
    // Keychain failed - fall back to filesystem with warning
    console.warn(`⚠️  OS keychain unavailable for ${username}, using filesystem fallback`);
    console.warn(`   This reduces security. Install: libsecret (Linux), use Keychain (macOS), or Credential Manager (Windows)`);

    const saltPath = path.join(systemPaths.profiles, username, '.salt');
    fs.writeFileSync(saltPath, salt);
    fs.chmodSync(saltPath, 0o600); // Read/write owner only
  }

  return salt;
}

/**
 * OS Keychain integration (platform-specific)
 */
function getKeychainValue(username: string, key: string): Buffer | null {
  const service = 'com.metahuman.profile';
  const account = `${username}:${key}`;

  try {
    if (process.platform === 'darwin') {
      // macOS Keychain
      const { execSync } = require('node:child_process');
      const output = execSync(
        `security find-generic-password -s "${service}" -a "${account}" -w`,
        { encoding: 'utf-8' }
      );
      return Buffer.from(output.trim(), 'hex');
    } else if (process.platform === 'linux') {
      // Linux libsecret via secret-tool
      const { execSync } = require('node:child_process');
      const output = execSync(
        `secret-tool lookup service "${service}" account "${account}"`,
        { encoding: 'utf-8' }
      );
      return Buffer.from(output.trim(), 'hex');
    } else if (process.platform === 'win32') {
      // Windows Credential Manager (requires node-keytar or similar)
      // TODO: Implement Windows support
      return null;
    }
  } catch (error) {
    // Keychain item not found or tool not installed
    return null;
  }

  return null;
}

function setKeychainValue(username: string, key: string, value: Buffer): void {
  const service = 'com.metahuman.profile';
  const account = `${username}:${key}`;
  const hexValue = value.toString('hex');

  if (process.platform === 'darwin') {
    const { execSync } = require('node:child_process');
    execSync(
      `security add-generic-password -s "${service}" -a "${account}" -w "${hexValue}" -U`
    );
  } else if (process.platform === 'linux') {
    const { execSync } = require('node:child_process');
    execSync(
      `secret-tool store --label="MetaHuman Profile: ${username}" service "${service}" account "${account}"`,
      { input: hexValue }
    );
  } else if (process.platform === 'win32') {
    // TODO: Implement Windows support
    throw new Error('Windows keychain not yet implemented');
  }
}

/**
 * Session-based key cache
 * Keys are derived once per login and cached in memory
 */
const keyCache = new Map<string, ProfileKeys>();

export function cacheProfileKeys(username: string, password: string): void {
  const masterKey = deriveProfileKey(username, password);
  const storageKey = deriveStorageKey(masterKey, 'metadata');
  const cacheKey = deriveStorageKey(masterKey, 'cache');

  keyCache.set(username, { masterKey, storageKey, cacheKey });
}

export function getProfileKeys(username: string): ProfileKeys | null {
  return keyCache.get(username) || null;
}

export function clearProfileKeys(username: string): void {
  const keys = keyCache.get(username);
  if (keys) {
    // Zero out buffers before deletion
    keys.masterKey.fill(0);
    keys.storageKey.fill(0);
    keys.cacheKey.fill(0);
  }
  keyCache.delete(username);
}

/**
 * Get user profile key (for backward compatibility with addendum examples)
 */
export function getUserProfileKey(username: string): Buffer {
  const keys = getProfileKeys(username);
  if (!keys) {
    throw new Error(`No cached keys for ${username}. User must be authenticated first.`);
  }
  return keys.storageKey;
}
```

### Integration with Authentication

Update `apps/site/src/middleware.ts` to cache keys on login:

```typescript
import { cacheProfileKeys } from '@metahuman/core/profile-crypto';

// In login handler after password verification:
const user = await verifyPassword(username, password);
if (user) {
  cacheProfileKeys(username, password); // Derive and cache keys
  // ... create session
}

// In logout handler:
clearProfileKeys(username);
```

### Headless Deployments

For headless servers without GUI keychain:

1. **Option A: File-based fallback** (used automatically)
   - Salt stored in `profiles/<username>/.salt` (mode 0600)
   - Warns in logs about reduced security
   - Good for development/testing

2. **Option B: Environment variable** (production)
   ```bash
   # /etc/metahuman/secrets/<username>.env
   export MH_PROFILE_SALT_BASE64="<base64-encoded-salt>"
   chmod 600 /etc/metahuman/secrets/<username>.env
   ```

3. **Option C: Hardware Security Module**
   - Future enhancement
   - Use PKCS#11 or cloud KMS

---

## 2. Session Token Flow for mh-storaged

### Problem

mh-storaged requires `sessionToken` but Astro middleware only exposes cookies. How does the web tier acquire a token?

### Solution: Signed Short-Lived Tokens

```typescript
// packages/core/src/storage-daemon-token.ts

import { createHmac, randomBytes } from 'node:crypto';
import { getUserContext } from './context.js';

const TOKEN_SECRET = process.env.MH_DAEMON_SECRET || randomBytes(32).toString('hex');
const TOKEN_TTL = 30000; // 30 seconds

interface DaemonToken {
  username: string;
  sessionId: string;
  expiresAt: number;
  nonce: string;
}

/**
 * Generate short-lived token for daemon access
 * Called by API endpoints before requesting mount/unmount
 */
export function generateDaemonToken(username: string, sessionId: string): string {
  const token: DaemonToken = {
    username,
    sessionId,
    expiresAt: Date.now() + TOKEN_TTL,
    nonce: randomBytes(16).toString('hex')
  };

  const payload = JSON.stringify(token);
  const signature = createHmac('sha256', TOKEN_SECRET)
    .update(payload)
    .digest('hex');

  return `${Buffer.from(payload).toString('base64')}.${signature}`;
}

/**
 * Validate daemon token
 * Called by mh-storaged before executing privileged operation
 */
export function validateDaemonToken(token: string): DaemonToken | null {
  try {
    const [payloadB64, signature] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64').toString('utf-8');

    // Verify signature
    const expectedSignature = createHmac('sha256', TOKEN_SECRET)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      return null; // Invalid signature
    }

    const parsed: DaemonToken = JSON.parse(payload);

    // Check expiration
    if (Date.now() > parsed.expiresAt) {
      return null; // Expired
    }

    return parsed;
  } catch (error) {
    return null; // Malformed token
  }
}
```

### API Endpoint Integration

```typescript
// apps/site/src/pages/api/storage/mount.ts

import type { APIRoute } from 'astro';
import { withUserContext } from '../../../middleware/userContext';
import { generateDaemonToken } from '@metahuman/core/storage-daemon-token';
import { requestMount } from '@metahuman/core/storage-daemon-client';

const handler: APIRoute = async (context) => {
  const username = context.locals.userContext?.username;
  const sessionId = context.cookies.get('mh_session')?.value;

  if (!username || !sessionId) {
    return new Response(
      JSON.stringify({ error: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Generate short-lived token for daemon
  const daemonToken = generateDaemonToken(username, sessionId);

  try {
    // Request mount via daemon with token
    await requestMount(username, daemonToken);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = withUserContext(handler);
```

### Updated mh-storaged Daemon

```typescript
// brain/services/mh-storaged.ts

import { validateDaemonToken } from '@metahuman/core/storage-daemon-token';
import { validateSession } from '@metahuman/core/sessions';

interface MountRequest {
  command: 'mount' | 'unmount' | 'health';
  username: string;
  daemonToken: string; // Changed from sessionToken
}

server.on('data', async (data) => {
  try {
    const request: MountRequest = JSON.parse(data.toString());

    // 1. Validate daemon token
    const token = validateDaemonToken(request.daemonToken);
    if (!token || token.username !== request.username) {
      socket.write(JSON.stringify({ error: 'Invalid token' }));
      return;
    }

    // 2. Verify session is still valid
    const session = validateSession(token.sessionId);
    if (!session || session.username !== request.username) {
      socket.write(JSON.stringify({ error: 'Session expired' }));
      return;
    }

    // 3. Verify user is owner
    const user = getUserByUsername(request.username);
    if (!user || user.role !== 'owner') {
      socket.write(JSON.stringify({ error: 'Permission denied' }));
      return;
    }

    // 4. Execute command
    // ... rest of implementation
  } catch (error) {
    socket.write(JSON.stringify({ error: (error as Error).message }));
  }
});
```

---

## 3. Remote Access CLI/UI Integration

### CLI: `./bin/mh storage remote setup`

```typescript
// packages/cli/src/commands/storage.ts

storage
  .command('remote setup')
  .description('Configure remote access for encrypted drive')
  .requiredOption('--user <username>', 'Username')
  .option('--method <type>', 'Method: sshfs|wireguard', 'wireguard')
  .action(async (options) => {
    console.log(`Setting up remote access for ${options.user}...`);

    const metadata = loadStorageMetadata(options.user);
    if (!metadata) {
      console.error('No storage configured. Run setup first.');
      process.exit(1);
    }

    if (options.method === 'wireguard') {
      // 1. Generate WireGuard keypair
      console.log('Generating WireGuard keys...');
      const privateKey = execSync('wg genkey').toString().trim();
      const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
      const psk = execSync('wg genpsk').toString().trim();

      // 2. Create config file
      const configPath = `/etc/wireguard/mh-${options.user}.conf`;
      const config = `
[Interface]
PrivateKey = ${privateKey}
Address = 10.0.${getUserId(options.user)}.1/24
ListenPort = 51820

[Peer]
PublicKey = ${publicKey}
PresharedKey = ${psk}
AllowedIPs = 10.0.${getUserId(options.user)}.2/32
`;

      fs.writeFileSync(configPath, config);
      fs.chmodSync(configPath, 0o600);

      console.log(`✅ WireGuard config created: ${configPath}`);

      // 3. Update metadata
      metadata.remote = {
        enabled: true,
        method: 'wireguard',
        tunnelConfig: configPath,
        keyRotation: {
          lastRotated: new Date().toISOString(),
          nextRotation: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      };
      saveStorageMetadata(options.user, metadata);

      // 4. Display client config
      console.log('\nClient configuration (save to owner device):');
      console.log('---');
      console.log(`
[Interface]
PrivateKey = <CLIENT-PRIVATE-KEY>
Address = 10.0.${getUserId(options.user)}.2/24

[Peer]
PublicKey = ${publicKey}
PresharedKey = ${psk}
Endpoint = <SERVER-IP>:51820
AllowedIPs = 10.0.${getUserId(options.user)}.1/32
PersistentKeepalive = 25
`);

    } else if (options.method === 'sshfs') {
      // Generate SSH keypair
      // ... similar flow
    }
  });

storage
  .command('remote rotate-keys')
  .description('Rotate remote access keys')
  .requiredOption('--user <username>', 'Username')
  .action(async (options) => {
    const { rotateRemoteKey, checkKeyRotation } = await import('@metahuman/core/storage-remote');

    const check = checkKeyRotation(options.user);
    if (!check.needsRotation) {
      console.log(`Keys are still valid (${check.daysRemaining} days remaining)`);
      return;
    }

    console.log('Rotating keys...');
    await rotateRemoteKey(options.user);
    console.log('✅ Keys rotated successfully');
    console.log('⚠️  Owner must update their client config');
  });
```

### UI: Dashboard Integration

Add to Settings → Secure Storage panel:

```svelte
<!-- apps/site/src/components/RemoteAccessPanel.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  let remoteConfig: any = null;
  let keyRotationStatus: { needsRotation: boolean; daysRemaining: number } | null = null;

  async function setupRemoteAccess(method: 'sshfs' | 'wireguard') {
    const response = await fetch('/api/storage/remote/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method })
    });

    if (response.ok) {
      const data = await response.json();
      // Show modal with client config to copy
      showConfigModal(data.clientConfig);
    }
  }

  async function rotateKeys() {
    await fetch('/api/storage/remote/rotate-keys', { method: 'POST' });
    await loadStatus();
  }

  async function loadStatus() {
    const response = await fetch('/api/storage/remote/status');
    const data = await response.json();
    remoteConfig = data.config;
    keyRotationStatus = data.keyRotation;
  }

  onMount(loadStatus);
</script>

<div class="remote-access-panel">
  <h3>Remote Access</h3>

  {#if !remoteConfig}
    <p>Enable remote mounting of your encrypted drive</p>
    <button on:click={() => setupRemoteAccess('wireguard')}>
      Setup WireGuard Tunnel
    </button>
    <button on:click={() => setupRemoteAccess('sshfs')}>
      Setup SSHFS
    </button>
  {:else}
    <div class="status">
      <span class="badge success">Enabled ({remoteConfig.method})</span>
    </div>

    {#if keyRotationStatus?.needsRotation}
      <div class="warning">
        ⚠️ Keys need rotation
        <button on:click={rotateKeys}>Rotate Now</button>
      </div>
    {:else}
      <p>Keys valid for {keyRotationStatus?.daysRemaining} days</p>
    {/if}

    <button on:click={() => showConfigModal(remoteConfig.clientConfig)}>
      View Client Config
    </button>
  {/if}
</div>
```

---

## 4. Enhanced Rollback Script

### Problem

Current rollback doesn't handle partial failures or multi-profile drives.

### Solution: Verified Rollback with Multi-Profile Support

```bash
#!/bin/bash
# scripts/rollback-storage.sh

set -e # Exit on error

USERNAME=$1
VERIFY=${2:-false} # Optional: --verify for hash checking

if [ -z "$USERNAME" ]; then
  echo "Usage: ./scripts/rollback-storage.sh <username> [--verify]"
  exit 1
fi

echo "=== MetaHuman Storage Rollback for $USERNAME ==="

# 1. Backup storage metadata
if [ -f "profiles/$USERNAME/etc/storage.json" ]; then
  BACKUP_FILE="profiles/$USERNAME/etc/storage.json.rollback-$(date +%Y%m%d-%H%M%S)"
  cp "profiles/$USERNAME/etc/storage.json" "$BACKUP_FILE"
  echo "✓ Backed up storage metadata to $BACKUP_FILE"
fi

# 2. Load mount point
MOUNT_POINT=$(jq -r '.mountPoint // empty' "profiles/$USERNAME/etc/storage.json" 2>/dev/null || echo "")

if [ -z "$MOUNT_POINT" ]; then
  echo "❌ No storage metadata found"
  exit 1
fi

# 3. Check if this is a multi-profile drive
PROFILES_ON_DRIVE=$(find "$MOUNT_POINT" -maxdepth 1 -type d -name "profile-*" 2>/dev/null | wc -l || echo 0)

if [ "$PROFILES_ON_DRIVE" -gt 1 ]; then
  echo "⚠️  WARNING: This drive contains $PROFILES_ON_DRIVE profiles"
  echo "   Only rolling back $USERNAME, other profiles will remain on drive"
  read -p "Continue? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 4. Copy directories back with verification
DIRECTORIES=$(jq -r '.directories[]' "profiles/$USERNAME/etc/storage.json" 2>/dev/null || echo "memory persona logs out etc")

for DIR in $DIRECTORIES; do
  SOURCE="$MOUNT_POINT/$DIR"
  DEST="profiles/$USERNAME/$DIR"

  if [ ! -d "$SOURCE" ]; then
    echo "⚠️  Skipping $DIR (not found on drive)"
    continue
  fi

  echo "Copying $DIR from drive..."

  # Create parent directory if needed
  mkdir -p "$(dirname "$DEST")"

  # Rsync with checksum verification
  if rsync -av --checksum --progress "$SOURCE/" "$DEST/"; then
    echo "✓ Copied $DIR"

    # Optional: Verify with hash comparison
    if [ "$VERIFY" = "--verify" ]; then
      echo "  Verifying checksums..."
      SOURCE_HASH=$(find "$SOURCE" -type f -exec md5sum {} \; | sort -k 2 | md5sum | cut -d' ' -f1)
      DEST_HASH=$(find "$DEST" -type f -exec md5sum {} \; | sort -k 2 | md5sum | cut -d' ' -f1)

      if [ "$SOURCE_HASH" = "$DEST_HASH" ]; then
        echo "  ✓ Verification passed"
      else
        echo "  ❌ Verification failed for $DIR"
        exit 1
      fi
    fi
  else
    echo "❌ Failed to copy $DIR"
    exit 1
  fi
done

# 5. Disable storage metadata
mv "profiles/$USERNAME/etc/storage.json" "profiles/$USERNAME/etc/storage.json.disabled"
echo "✓ Disabled storage metadata"

# 6. Verify profile integrity
echo "Verifying profile integrity..."
REQUIRED_DIRS="memory persona logs out etc"
for DIR in $REQUIRED_DIRS; do
  if [ ! -d "profiles/$USERNAME/$DIR" ]; then
    echo "❌ Missing required directory: $DIR"
    exit 1
  fi
done

echo ""
echo "✅ Rollback complete for $USERNAME"
echo ""
echo "Next steps:"
echo "  1. Unmount the drive if still mounted"
echo "  2. Test the application with local profile data"
echo "  3. To re-enable storage: mv profiles/$USERNAME/etc/storage.json.disabled profiles/$USERNAME/etc/storage.json"
echo "  4. Restore backup if needed: cp $BACKUP_FILE profiles/$USERNAME/etc/storage.json"
```

---

## 5. Hardware Abstraction for Testing

### Problem

Test matrix requires hardware simulation in CI.

### Solution: Pluggable Storage Backend

```typescript
// packages/core/src/storage-backend.ts

/**
 * Storage backend abstraction
 * Allows mocking hardware operations in tests
 */

export interface StorageBackend {
  isDeviceMounted(deviceId: string): Promise<boolean>;
  getMountPoint(deviceId: string): Promise<string | null>;
  mountDevice(deviceId: string, passphrase: string): Promise<void>;
  unmountDevice(deviceId: string): Promise<void>;
  getDeviceHealth(devicePath: string): Promise<HealthStatus>;
}

/**
 * Real hardware backend
 */
export class HardwareStorageBackend implements StorageBackend {
  async isDeviceMounted(deviceId: string): Promise<boolean> {
    // Platform-specific implementation
    if (process.platform === 'linux') {
      const { execSync } = require('node:child_process');
      const mounts = execSync('cat /proc/mounts').toString();
      return mounts.includes(deviceId);
    }
    // ... macOS, Windows
    return false;
  }

  async mountDevice(deviceId: string, passphrase: string): Promise<void> {
    // Platform-specific mount commands
    // ...
  }

  // ... rest of implementation
}

/**
 * Mock backend for testing
 */
export class MockStorageBackend implements StorageBackend {
  private mountedDevices = new Set<string>();
  private deviceFailures = new Map<string, Error>();

  async isDeviceMounted(deviceId: string): Promise<boolean> {
    return this.mountedDevices.has(deviceId);
  }

  async mountDevice(deviceId: string, passphrase: string): Promise<void> {
    const failure = this.deviceFailures.get(deviceId);
    if (failure) {
      throw failure;
    }

    this.mountedDevices.add(deviceId);
  }

  async unmountDevice(deviceId: string): Promise<void> {
    this.mountedDevices.delete(deviceId);
  }

  // Test helpers
  simulateDriveRemoval(deviceId: string): void {
    this.mountedDevices.delete(deviceId);
  }

  simulateMountFailure(deviceId: string, error: Error): void {
    this.deviceFailures.set(deviceId, error);
  }

  reset(): void {
    this.mountedDevices.clear();
    this.deviceFailures.clear();
  }
}

/**
 * Global backend instance
 * Use mock in tests, real in production
 */
let currentBackend: StorageBackend = new HardwareStorageBackend();

export function setStorageBackend(backend: StorageBackend): void {
  currentBackend = backend;
}

export function getStorageBackend(): StorageBackend {
  return currentBackend;
}
```

### Test Usage

```typescript
// tests/storage-failure-tests.ts

import { MockStorageBackend, setStorageBackend } from '@metahuman/core/storage-backend';

describe('Storage Failure Scenarios', () => {
  let mockBackend: MockStorageBackend;

  beforeEach(() => {
    mockBackend = new MockStorageBackend();
    setStorageBackend(mockBackend);
  });

  afterEach(() => {
    mockBackend.reset();
  });

  it('should return 503 when drive removed mid-write', async () => {
    // Mount drive
    await mockBackend.mountDevice('test-device', 'password');

    // Start write
    const writePromise = writeMemory('testuser', { content: 'test' });

    // Simulate removal
    mockBackend.simulateDriveRemoval('test-device');

    // Verify failure
    await expect(writePromise).rejects.toThrow('Storage unavailable');
  });

  it('should handle mount failures gracefully', async () => {
    // Simulate mount failure
    mockBackend.simulateMountFailure('test-device', new Error('Device not found'));

    // Attempt mount
    await expect(mountStorage('testuser')).rejects.toThrow('Device not found');

    // Verify fallback behavior
    const result = await tryResolveProfilePath('memory');
    expect(result.ok).toBe(true); // Falls back to local path
  });
});
```

---

## Summary of Implementation Dependencies

### Must Implement Before Storage (Critical Path)

1. **Profile Key Derivation** ([profile-crypto.ts](profile-crypto.ts))
   - `deriveProfileKey(username, password)`
   - `cacheProfileKeys()` called on login
   - `clearProfileKeys()` called on logout
   - OS keychain integration (macOS/Linux)

2. **Daemon Token Flow** ([storage-daemon-token.ts](storage-daemon-token.ts))
   - `generateDaemonToken()` in API endpoints
   - `validateDaemonToken()` in mh-storaged
   - Update middleware to expose session ID

3. **Storage Backend Abstraction** ([storage-backend.ts](storage-backend.ts))
   - `HardwareStorageBackend` for production
   - `MockStorageBackend` for tests
   - Global backend switching

### Can Implement in Parallel

4. **Remote Access CLI** (extends storage command)
5. **Remote Access UI** (new Settings panel)
6. **Enhanced Rollback Script** (standalone bash script)

### Dependencies Between Components

```
Login Flow
└─> cacheProfileKeys()
    └─> deriveProfileKey()
        └─> getOrCreateProfileSalt()
            └─> OS Keychain (macOS/Linux/Windows)

Mount Request
└─> API: POST /api/storage/mount
    └─> generateDaemonToken()
    └─> requestMount(username, daemonToken)
        └─> mh-storaged via Unix socket
            └─> validateDaemonToken()
            └─> validateSession()
            └─> executeMount()
                └─> StorageBackend.mountDevice()
```

---

## Next Steps

1. Implement `profile-crypto.ts` first (enables metadata encryption)
2. Add `cacheProfileKeys()` to login flow
3. Implement `storage-daemon-token.ts` (enables mh-storaged)
4. Create `storage-backend.ts` abstraction (enables testing)
5. Write tests using `MockStorageBackend`
6. Build remote access CLI/UI on top

All other components in SECURE_STORAGE_SECURITY_ADDENDUM.md can now reference these concrete implementations.
