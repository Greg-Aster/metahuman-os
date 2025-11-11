# Encryption System Implementation Plan

**Created**: 2025-11-11
**Status**: Planning
**Priority**: High (Security Feature)
**Estimated Time**: 4-6 hours

## Overview

Add transparent AES-256-GCM encryption to MetaHuman OS to protect sensitive user data at rest. This will give all future users confidence that their memories, persona, and audit logs are secure even if someone gains file system access.

---

## Goals

1. **Protect Sensitive Data**: Encrypt `memory/`, `persona/`, and optionally `logs/audit/`
2. **Zero-Knowledge Design**: Keys derived from passwords, never stored
3. **Transparent Integration**: Existing code works without changes
4. **Per-User Encryption**: Each user's data encrypted with their own key
5. **Migration Support**: Tool to encrypt existing plaintext data
6. **Optional Feature**: Users can opt-in during setup or later

---

## Architecture

### What Gets Encrypted

**Always Encrypted** (when feature enabled):
- `memory/episodic/` - Personal memories
- `memory/semantic/` - Knowledge graph
- `memory/tasks/` - Task data
- `persona/` - Identity and personality files

**Optionally Encrypted** (configurable):
- `logs/audit/` - Audit trail (useful for compliance)

**Never Encrypted**:
- `etc/` - Configuration (needs to be readable before authentication)
- `brain/` - Code and skills (not user data)
- `apps/`, `packages/`, `bin/` - Application code
- `out/` - Temporary outputs
- `memory/inbox/` - Unprocessed files (encrypted after ingestion)

### Encryption Method

- **Algorithm**: AES-256-GCM (authenticated encryption, industry standard)
- **Key Derivation**: PBKDF2-SHA256 with 100,000 iterations (OWASP recommendation)
- **Key Length**: 256 bits
- **IV**: 128-bit random initialization vector (per file)
- **Salt**: 256-bit random salt (per file)
- **Auth Tag**: 128-bit authentication tag (prevents tampering)

### Key Management

**Key Derivation**:
```
User Password → PBKDF2-SHA256 (100k iterations, random salt) → 256-bit encryption key
```

**Key Caching**:
- Keys cached in memory during active session
- Cleared on logout
- Never written to disk
- Each user has separate cached key

**Key Rotation**:
- Password change triggers re-encryption of all user's files
- Old key decrypts, new key encrypts
- Atomic operation with rollback on failure

### File Format

**Encrypted File Structure**:
```json
{
  "metadata": {
    "version": 1,
    "salt": "base64-encoded-salt",
    "iv": "base64-encoded-iv",
    "authTag": "base64-encoded-auth-tag",
    "algorithm": "aes-256-gcm",
    "timestamp": "2025-11-11T12:00:00.000Z"
  },
  "data": "base64-encoded-encrypted-data"
}
```

**File Extension**: `.enc` appended to original filename
- Example: `memory/episodic/2025/2025-11-11-abc123.json.enc`

**Transition Period**: Keep both plaintext and encrypted versions during migration for safety

---

## Implementation Steps

### Phase 1: Core Encryption Service (2 hours)

**File**: `packages/core/src/encryption.ts`

**Functions to Implement**:

1. **Configuration Management**:
   ```typescript
   loadEncryptionConfig(): EncryptionConfig
   saveEncryptionConfig(config: EncryptionConfig): void
   enableEncryption(userId: string): void
   disableEncryption(userId: string): void
   isEncryptionEnabled(): boolean
   ```

2. **Key Management**:
   ```typescript
   deriveKey(password: string, salt: Buffer): Buffer
   getCachedKey(userId: string): Buffer | null
   cacheKey(userId: string, key: Buffer): void
   clearCachedKey(userId: string): void
   clearAllCachedKeys(): void
   ```

3. **Encryption/Decryption**:
   ```typescript
   encryptData(data: string | Buffer, key: Buffer): { encrypted: Buffer, metadata: EncryptionMetadata }
   decryptData(encrypted: Buffer, key: Buffer, metadata: EncryptionMetadata): Buffer
   encryptFile(filePath: string, key: Buffer): void
   decryptFile(encryptedPath: string, key: Buffer): Buffer
   ```

4. **Utility Functions**:
   ```typescript
   shouldEncrypt(filePath: string): boolean
   isEncrypted(filePath: string): boolean
   getEncryptedPath(filePath: string): string
   getDecryptedPath(encryptedPath: string): string
   readFileDecrypted(filePath: string, key: Buffer): string
   writeFileEncrypted(filePath: string, data: string, key: Buffer): void
   testEncryption(password: string): boolean
   ```

**Configuration File**: `etc/encryption.json`
```json
{
  "enabled": false,
  "encryptedPaths": [
    "memory/episodic",
    "memory/semantic",
    "memory/tasks",
    "persona"
  ],
  "excludedPaths": [
    "etc",
    "brain",
    "apps",
    "packages",
    "bin",
    "out",
    "memory/inbox",
    "memory/index"
  ],
  "encryptAuditLogs": false
}
```

**Testing**:
- Unit test key derivation (same password + salt = same key)
- Unit test encryption/decryption round-trip
- Test file encryption/decryption
- Test metadata parsing

---

### Phase 2: Integration with Existing Systems (1.5 hours)

#### 2.1 Update Session Management

**File**: `packages/core/src/sessions.ts`

**Changes**:
```typescript
import { cacheKey, deriveKey, clearCachedKey } from './encryption.js';

// On login/registration, derive and cache encryption key
export function createSession(userId: string, role: string, password: string, metadata?: SessionMetadata): Session {
  // ... existing session creation ...

  // Derive and cache encryption key if encryption is enabled
  if (isEncryptionEnabled()) {
    const salt = getUserSalt(userId); // Get user's salt from users.json
    const key = deriveKey(password, salt);
    cacheKey(userId, key);
  }

  return session;
}

// On logout, clear cached key
export function deleteSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    clearCachedKey(session.userId);
  }
  // ... existing deletion ...
}
```

#### 2.2 Update User Management

**File**: `packages/core/src/users.ts`

**Changes**:
```typescript
import { randomBytes } from 'crypto';

export interface UserRecord {
  // ... existing fields ...
  encryptionSalt?: string; // Base64-encoded salt for key derivation
}

// On user creation, generate encryption salt
export async function createUser(username: string, password: string, role: UserRole, metadata?: UserMetadata): Promise<UserRecord> {
  // ... existing validation ...

  const user: UserRecord = {
    // ... existing fields ...
    encryptionSalt: randomBytes(32).toString('base64'), // Generate unique salt per user
  };

  // ... rest of creation ...
}

// On password change, re-encrypt all user's files
export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  // ... existing password change ...

  if (isEncryptionEnabled()) {
    await reencryptUserData(userId, oldPassword, newPassword);
  }
}
```

#### 2.3 Update Memory System

**File**: `packages/core/src/memory.ts`

**Changes**:
```typescript
import { readFileDecrypted, writeFileEncrypted, getCachedKey } from './encryption.js';

// Update file read operations
function readMemoryFile(filePath: string, userId: string): any {
  const key = getCachedKey(userId);
  if (!key) {
    throw new Error('Encryption key not available. Please re-authenticate.');
  }

  const content = readFileDecrypted(filePath, key);
  return JSON.parse(content);
}

// Update file write operations
function writeMemoryFile(filePath: string, data: any, userId: string): void {
  const key = getCachedKey(userId);
  if (!key) {
    throw new Error('Encryption key not available. Please re-authenticate.');
  }

  const content = JSON.stringify(data, null, 2);
  writeFileEncrypted(filePath, content, key);
}
```

#### 2.4 Update Identity System

**File**: `packages/core/src/identity.ts`

**Changes**: Same pattern as memory system - use `readFileDecrypted` and `writeFileEncrypted`

#### 2.5 Update Audit System

**File**: `packages/core/src/audit.ts`

**Changes** (if audit log encryption is enabled):
```typescript
import { writeFileEncrypted, getCachedKey } from './encryption.js';

export function audit(category: string, level: string, subsystem: string, message: string, details?: any): void {
  // ... existing audit logic ...

  if (isEncryptionEnabled() && config.encryptAuditLogs) {
    // Use system owner's key for audit logs (not user-specific)
    const ownerKey = getCachedKey('owner');
    if (ownerKey) {
      // Encrypt audit log writes
      writeFileEncrypted(logPath, entry, ownerKey);
    }
  }
}
```

---

### Phase 3: CLI Commands (1 hour)

**File**: `packages/cli/src/commands/encryption.ts`

**Commands to Add**:

```bash
# Enable encryption (prompts for owner password)
./bin/mh encryption enable

# Disable encryption (decrypts all files back to plaintext)
./bin/mh encryption disable

# Check encryption status
./bin/mh encryption status

# Migrate existing data to encrypted format
./bin/mh encryption migrate

# Test encryption (verify it's working)
./bin/mh encryption test

# Re-encrypt all data (after password change)
./bin/mh encryption rekey

# View encryption statistics
./bin/mh encryption stats
```

**Example Implementation** (`encryption enable`):
```typescript
async function enableEncryption() {
  // Check if already enabled
  if (isEncryptionEnabled()) {
    console.log('Encryption is already enabled.');
    return;
  }

  // Prompt for owner password
  const password = await promptPassword('Enter owner password: ');

  // Verify owner password
  const owner = getOwnerUser();
  const valid = await authenticateUser(owner.username, password);
  if (!valid) {
    console.error('Invalid password.');
    return;
  }

  // Enable encryption
  enableEncryption(owner.id);

  // Derive and cache key
  const salt = Buffer.from(owner.encryptionSalt, 'base64');
  const key = deriveKey(password, salt);
  cacheKey(owner.id, key);

  console.log('Encryption enabled. Run `mh encryption migrate` to encrypt existing data.');
}
```

**Migration Tool**:
```typescript
async function migrateToEncryption() {
  const config = loadEncryptionConfig();

  if (!config.enabled) {
    console.error('Encryption is not enabled. Run `mh encryption enable` first.');
    return;
  }

  const owner = getOwnerUser();
  const key = getCachedKey(owner.id);

  if (!key) {
    console.error('Encryption key not cached. Please re-authenticate.');
    return;
  }

  // Find all files in encrypted paths
  const filesToEncrypt = findFilesToEncrypt(config.encryptedPaths);

  console.log(`Found ${filesToEncrypt.length} files to encrypt.`);

  let encrypted = 0;
  let failed = 0;

  for (const filePath of filesToEncrypt) {
    try {
      // Skip if already encrypted
      if (isEncrypted(filePath)) {
        continue;
      }

      encryptFile(filePath, key);
      encrypted++;

      if (encrypted % 100 === 0) {
        console.log(`Encrypted ${encrypted}/${filesToEncrypt.length} files...`);
      }
    } catch (error) {
      console.error(`Failed to encrypt ${filePath}:`, error.message);
      failed++;
    }
  }

  console.log(`\nEncryption complete:`);
  console.log(`  Encrypted: ${encrypted} files`);
  console.log(`  Failed: ${failed} files`);
}
```

---

### Phase 4: Web UI Integration (1 hour)

#### 4.1 Add Encryption Settings Page

**File**: `apps/site/src/components/EncryptionSettings.svelte`

**Features**:
- Show encryption status (enabled/disabled)
- Show encrypted paths
- Show statistics (# of encrypted files, total size)
- Enable/disable encryption button
- Migrate data button
- Test encryption button
- Warning messages about password recovery

**UI Layout**:
```
┌──────────────────────────────────────────┐
│ Encryption Settings                      │
├──────────────────────────────────────────┤
│ Status: [Enabled] / [Disabled]           │
│                                          │
│ Protected Directories:                   │
│  ✓ memory/episodic                       │
│  ✓ memory/tasks                          │
│  ✓ persona                               │
│                                          │
│ Statistics:                              │
│  • 1,234 files encrypted                 │
│  • 45.2 MB protected                     │
│                                          │
│ [Enable Encryption]                      │
│ [Migrate Existing Data]                  │
│ [Test Encryption]                        │
│                                          │
│ ⚠️ WARNING: If you forget your password, │
│    encrypted data CANNOT be recovered.   │
│    Make sure to backup your password in  │
│    a secure location.                    │
└──────────────────────────────────────────┘
```

#### 4.2 Add to Settings/System Tab

**File**: `apps/site/src/components/RightSidebar.svelte`

Add "Encryption" section to System tab:
```svelte
<div class="setting-section">
  <h3>Encryption</h3>
  <EncryptionSettings />
</div>
```

#### 4.3 Add API Endpoints

**Files**: `apps/site/src/pages/api/encryption/*.ts`

```typescript
// GET /api/encryption/status
export async function GET({ locals }) {
  const config = loadEncryptionConfig();
  const stats = await getEncryptionStats();

  return new Response(JSON.stringify({
    enabled: config.enabled,
    encryptedPaths: config.encryptedPaths,
    stats
  }));
}

// POST /api/encryption/enable
export async function POST({ request, locals }) {
  // Require owner role
  if (locals.user.role !== 'owner') {
    return new Response('Forbidden', { status: 403 });
  }

  const { password } = await request.json();

  // Verify password
  const valid = await authenticateUser(locals.user.username, password);
  if (!valid) {
    return new Response('Invalid password', { status: 401 });
  }

  // Enable encryption
  enableEncryption(locals.user.id);

  return new Response(JSON.stringify({ success: true }));
}

// POST /api/encryption/migrate
// POST /api/encryption/test
// etc.
```

---

### Phase 5: Onboarding Integration (30 minutes)

#### 5.1 Add Encryption Step to First-Time Setup

**File**: `packages/cli/src/mh-new.ts` (init command)

**Changes**:
```typescript
async function initMetaHuman() {
  // ... existing init steps ...

  // Ask about encryption
  console.log('\n📁 Data Encryption');
  console.log('MetaHuman OS can encrypt sensitive data (memories, persona, tasks)');
  console.log('to protect your privacy. This requires your password to access data.\n');

  const enableEncrypt = await promptYesNo('Enable encryption? (recommended)');

  if (enableEncrypt) {
    enableEncryption('owner');
    console.log('✓ Encryption enabled.');
    console.log('  Your data will be automatically encrypted when saved.');
  }
}
```

#### 5.2 Add to Web UI Onboarding

**File**: `apps/site/src/pages/onboarding.astro`

Add encryption step to onboarding flow with explanation and toggle.

---

### Phase 6: Documentation (30 minutes)

#### 6.1 User Guide

**File**: `docs/user-guide/security-encryption.md`

**Contents**:
- What is encryption and why use it
- How MetaHuman OS encryption works
- How to enable/disable encryption
- How to migrate existing data
- Password management best practices
- What happens if you forget your password
- Performance considerations

#### 6.2 Update README

**File**: `README.md`

Add encryption to features list:
```markdown
## Security Features

- **Data Encryption**: AES-256-GCM encryption for memories, persona, and audit logs
- **Zero-Knowledge Design**: Encryption keys derived from passwords, never stored
- **Per-User Encryption**: Each user's data encrypted with their own key
```

#### 6.3 Update ARCHITECTURE.md

**File**: `ARCHITECTURE.md`

Add encryption subsystem documentation.

---

## Testing Strategy

### Unit Tests

**File**: `packages/core/src/encryption.test.ts`

Tests to write:
1. Key derivation (same password + salt = same key)
2. Key derivation (different salt = different key)
3. Encryption/decryption round-trip (string data)
4. Encryption/decryption round-trip (binary data)
5. File encryption/decryption
6. Metadata parsing
7. shouldEncrypt() path matching
8. Cache operations

### Integration Tests

**File**: `tests/test-encryption.mjs`

Tests to write:
1. Enable encryption via CLI
2. Create memory with encryption enabled (verify .enc file created)
3. Read memory with encryption enabled (verify decryption works)
4. Migrate plaintext data to encrypted
5. Disable encryption (verify decryption back to plaintext)
6. Password change triggers re-encryption
7. Logout clears cached keys
8. Multiple users with different keys

### Manual Testing

- [ ] Enable encryption via CLI
- [ ] Create new memory (verify .enc file)
- [ ] Read memory (verify content is correct)
- [ ] Restart server (verify keys cleared, re-authentication needed)
- [ ] Change password (verify re-encryption works)
- [ ] Disable encryption (verify plaintext restored)
- [ ] Enable via Web UI
- [ ] Migrate existing data
- [ ] View encryption stats

---

## Security Considerations

### Threats Mitigated

✅ **File System Access**: Encrypted files unreadable without password
✅ **Data Breach**: Stolen files are useless without keys
✅ **Unauthorized Access**: Keys tied to user passwords
✅ **Tampering**: GCM authentication tag prevents modification

### Threats NOT Mitigated

❌ **Memory Dumps**: Keys cached in memory during session
❌ **Keyloggers**: Password entry can be captured
❌ **Malicious Code**: Root access can intercept decrypted data
❌ **Weak Passwords**: Short passwords easier to brute-force

### Best Practices for Users

1. **Use Strong Passwords**: 12+ characters, mixed case, numbers, symbols
2. **Backup Password Securely**: Password manager or secure vault
3. **Don't Share Passwords**: Each user should have their own account
4. **Enable Encryption Early**: Easier to enable before lots of data
5. **Regular Backups**: Encrypted backups to separate location

### Implementation Security Notes

- Use `crypto.timingSafeEqual()` for password comparisons (already done in users.ts)
- Clear key cache on logout/shutdown (prevents leaked keys)
- Use authenticated encryption (GCM mode prevents tampering)
- High iteration count for PBKDF2 (100k iterations, OWASP recommendation)
- Random IV per file (prevents pattern analysis)
- Random salt per user (prevents rainbow table attacks)

---

## Performance Considerations

### Overhead

- **Encryption**: ~1-2ms per 1MB file (negligible for JSON files)
- **Key Derivation**: ~100ms per login (PBKDF2 with 100k iterations)
- **Key Caching**: Zero overhead after initial derivation

### Optimization Strategies

1. **Cache Keys**: Derive once per session, cache in memory
2. **Lazy Decryption**: Only decrypt files when accessed
3. **Batch Operations**: Encrypt multiple files in single pass during migration
4. **Async Operations**: Use async file I/O for large files

### Expected Impact

- Memory read/write: +1-5ms per operation (unnoticeable)
- Login: +100ms (one-time per session)
- Migration: ~1-2 seconds per 1000 files

---

## Migration Path

### For New Users

1. Enable encryption during onboarding (recommended)
2. All new data automatically encrypted
3. Zero manual steps

### For Existing Users

1. Enable encryption: `./bin/mh encryption enable`
2. Migrate data: `./bin/mh encryption migrate`
3. Verify: `./bin/mh encryption test`
4. Optional: Remove plaintext backups after verification

### Rollback Plan

If encryption causes issues:
1. `./bin/mh encryption disable`
2. All `.enc` files decrypted back to plaintext
3. Original file structure restored

---

## Future Enhancements

**Phase 2 Features** (not in initial implementation):

1. **Hardware Key Support**: YubiKey, TPM integration
2. **Key Escrow**: Optional recovery key for enterprise
3. **Selective Decryption**: Decrypt specific folders, not all
4. **Key Rotation**: Periodic automatic re-encryption
5. **Compression**: Compress before encrypt (reduce size)
6. **Streaming Encryption**: For large files (>10MB)
7. **Multi-Device Sync**: Encrypted sync between devices
8. **Encrypted Backups**: Export encrypted archives

---

## Dependencies

**New Dependencies**:
- None! Uses Node.js built-in `crypto` module

**Updated Dependencies**:
- `@types/node` - Already installed (for TypeScript types)

---

## Files to Create

1. `packages/core/src/encryption.ts` - Core encryption service
2. `packages/core/src/encryption.test.ts` - Unit tests
3. `packages/cli/src/commands/encryption.ts` - CLI commands
4. `apps/site/src/components/EncryptionSettings.svelte` - Web UI settings
5. `apps/site/src/pages/api/encryption/status.ts` - API endpoints
6. `apps/site/src/pages/api/encryption/enable.ts`
7. `apps/site/src/pages/api/encryption/migrate.ts`
8. `apps/site/src/pages/api/encryption/test.ts`
9. `docs/user-guide/security-encryption.md` - User documentation
10. `tests/test-encryption.mjs` - Integration tests
11. `etc/encryption.json` - Configuration file (created on first enable)

## Files to Modify

1. `packages/core/src/index.ts` - Export encryption functions
2. `packages/core/src/sessions.ts` - Cache keys on login
3. `packages/core/src/users.ts` - Add encryption salt, re-encrypt on password change
4. `packages/core/src/memory.ts` - Use encrypted read/write
5. `packages/core/src/identity.ts` - Use encrypted read/write
6. `packages/core/src/audit.ts` - Optionally encrypt audit logs
7. `packages/cli/src/mh-new.ts` - Add encryption commands, onboarding step
8. `apps/site/src/components/RightSidebar.svelte` - Add encryption settings
9. `README.md` - Add encryption to features
10. `ARCHITECTURE.md` - Document encryption subsystem

---

## Estimated Timeline

| Phase | Time | Description |
|-------|------|-------------|
| Phase 1 | 2h | Core encryption service |
| Phase 2 | 1.5h | Integration with existing systems |
| Phase 3 | 1h | CLI commands |
| Phase 4 | 1h | Web UI integration |
| Phase 5 | 30m | Onboarding integration |
| Phase 6 | 30m | Documentation |
| Testing | 1h | Unit + integration tests |
| **Total** | **7.5h** | Full implementation |

---

## Success Criteria

- [ ] Encryption can be enabled via CLI and Web UI
- [ ] Memory files automatically encrypted when saved
- [ ] Persona files automatically encrypted when saved
- [ ] Encrypted files can be read transparently
- [ ] Migration tool successfully encrypts existing data
- [ ] Password change triggers re-encryption
- [ ] Logout clears encryption keys from cache
- [ ] Multiple users can have different encryption keys
- [ ] Encryption can be disabled (rollback to plaintext)
- [ ] All operations audited to logs
- [ ] Documentation complete
- [ ] Tests pass

---

## Notes

- Start with Phase 1 (core service) and test thoroughly before integrating
- Keep plaintext files during transition period for safety
- Add prominent warnings about password recovery
- Consider adding a "recovery key" feature in future for enterprise users
- Encryption is opt-in by default to avoid breaking existing installations
