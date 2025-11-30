# Implementation Plan: User-Configurable Profile Directory Location

**Date:** 2025-11-28
**Status:** Planning
**Priority:** Security Enhancement

---

## Overview

Enable users to configure a custom filesystem location for their profile data, supporting external drives, encrypted volumes, and other secure storage options.

## Goals

1. **Data sovereignty** - Users control where their data lives
2. **External drive support** - USB drives, encrypted volumes
3. **Security** - Protect against path-based attacks
4. **Graceful degradation** - Handle unavailable storage safely
5. **Backward compatibility** - Existing profiles work unchanged

---

## Implementation Phases

### Phase 1: Core Path Override

**Objective:** Enable custom profile paths with minimal code changes.

#### 1.1 Extend User Schema

**File:** `packages/core/src/users.ts`

```typescript
// Add to User metadata interface
metadata?: {
  displayName?: string;
  email?: string;
  onboardingState?: OnboardingState;
  profileVisibility?: 'private' | 'public';
  profilePath?: string;  // NEW: Custom profile directory (absolute path)
};

// Add helper function
export function getUserMetadata(username: string): User['metadata'] | undefined {
  const store = loadUsers();
  const user = store.users.find((u) => u.username === username);
  return user?.metadata;
}
```

#### 1.2 Modify Path Resolution

**File:** `packages/core/src/path-builder.ts`

```typescript
import { getUserMetadata } from './users.js';

export function getProfilePaths(username: string) {
  let profileRoot: string;

  // Check for custom profile path
  try {
    const metadata = getUserMetadata(username);
    if (metadata?.profilePath) {
      // Basic validation: absolute, exists, writable
      if (path.isAbsolute(metadata.profilePath) &&
          fs.existsSync(metadata.profilePath)) {
        profileRoot = metadata.profilePath;
      } else {
        console.warn(`Custom profilePath for ${username} invalid, using default`);
        profileRoot = path.join(ROOT, 'profiles', username);
      }
    } else {
      profileRoot = path.join(ROOT, 'profiles', username);
    }
  } catch {
    // Fallback if users.ts not available (bootstrap)
    profileRoot = path.join(ROOT, 'profiles', username);
  }

  return {
    root: profileRoot,
    persona: path.join(profileRoot, 'persona'),
    memory: path.join(profileRoot, 'memory'),
    // ... rest unchanged
  };
}
```

**Files changed:** 2
**Risk:** Low

---

### Phase 2: Security Hardening

**Objective:** Protect against path-based attacks and handle edge cases.

#### 2.1 Path Security Module

**New File:** `packages/core/src/path-security.ts`

```typescript
export interface PathValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resolvedPath: string;
}

// Forbidden system directories
const FORBIDDEN_PATHS = [
  '/etc', '/var', '/usr', '/bin', '/sbin', '/root',
  '/proc', '/sys', '/dev', '/boot', '/lib', '/lib64'
];

// MetaHuman internal directories
const INTERNAL_PATHS = [
  'brain/', 'packages/', 'apps/', 'bin/', 'node_modules/'
];

export function validateProfilePath(inputPath: string): PathValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let resolvedPath = inputPath;

  // 1. Must be absolute
  if (!path.isAbsolute(inputPath)) {
    errors.push('Path must be absolute');
    return { valid: false, errors, warnings, resolvedPath };
  }

  // 2. No path traversal
  if (inputPath.includes('..')) {
    errors.push('Path cannot contain parent directory references (..)');
  }

  // 3. Resolve symlinks and validate
  try {
    resolvedPath = fs.realpathSync(inputPath);
  } catch (e) {
    errors.push('Path does not exist or is not accessible');
    return { valid: false, errors, warnings, resolvedPath };
  }

  // 4. Check forbidden system directories
  for (const forbidden of FORBIDDEN_PATHS) {
    if (resolvedPath === forbidden || resolvedPath.startsWith(forbidden + '/')) {
      errors.push(`Cannot use system directory: ${forbidden}`);
    }
  }

  // 5. Check MetaHuman internals
  for (const internal of INTERNAL_PATHS) {
    if (resolvedPath.includes(`/${internal}`)) {
      errors.push('Cannot use MetaHuman internal directory');
    }
  }

  // 6. Check writability
  try {
    fs.accessSync(resolvedPath, fs.constants.W_OK);
  } catch {
    errors.push('Directory is not writable');
  }

  // 7. Check if it's a directory
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      errors.push('Path must be a directory');
    }

    // Permission warning
    const mode = stat.mode & 0o777;
    if (mode & 0o007) {
      warnings.push('Directory is world-accessible (consider chmod 700)');
    }
  } catch {
    errors.push('Cannot read directory information');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedPath,
  };
}

export function isValidProfilePath(inputPath: string): boolean {
  return validateProfilePath(inputPath).valid;
}
```

#### 2.2 Graceful Fallback

Update `path-builder.ts` to handle unavailable storage:

```typescript
interface ProfilePathResolution {
  root: string;
  fallback: boolean;
  error?: string;
}

function resolveProfileRoot(username: string): ProfilePathResolution {
  const metadata = getUserMetadataSafe(username);

  if (metadata?.profilePath) {
    const validation = validateProfilePath(metadata.profilePath);

    if (validation.valid) {
      return { root: validation.resolvedPath, fallback: false };
    }

    // Log the fallback event
    console.warn(`[path-builder] Custom path unavailable for ${username}: ${validation.errors.join(', ')}`);

    return {
      root: path.join(ROOT, 'profiles', username),
      fallback: true,
      error: validation.errors.join(', '),
    };
  }

  return { root: path.join(ROOT, 'profiles', username), fallback: false };
}
```

#### 2.3 Audit Events

**File:** `packages/core/src/audit.ts`

Add new event types:

```typescript
// Profile path events
'profile_path_changed'           // Path configuration updated
'profile_path_validation_failed' // Security check failed
'profile_path_fallback'          // Using fallback due to unavailable storage
'profile_migration_started'      // Moving profile to new location
'profile_migration_completed'    // Migration finished successfully
'profile_migration_failed'       // Migration encountered error
```

**Files changed:** 3 (path-builder.ts, new path-security.ts, audit.ts)
**Risk:** Low-Medium

---

### Phase 3: API & UI

**Objective:** User-facing interface for path management.

#### 3.1 API Endpoint

**New File:** `apps/site/src/pages/api/profile-path.ts`

```typescript
import type { APIRoute } from 'astro';
import { getAuthenticatedUser, updateUserMetadata, audit } from '@metahuman/core';
import { validateProfilePath } from '@metahuman/core/path-security';

// GET /api/profile-path - Current configuration
export const GET: APIRoute = async ({ cookies }) => {
  const user = getAuthenticatedUser(cookies);

  return new Response(JSON.stringify({
    currentPath: user.metadata?.profilePath || null,
    defaultPath: `profiles/${user.username}`,
    usingDefault: !user.metadata?.profilePath,
  }));
};

// POST /api/profile-path - Update path (owner only)
export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);

  if (user.role !== 'owner') {
    return new Response(JSON.stringify({
      error: 'Only owners can change profile paths'
    }), { status: 403 });
  }

  const { profilePath } = await request.json();

  // Validate the new path
  if (profilePath) {
    const validation = validateProfilePath(profilePath);
    if (!validation.valid) {
      audit({
        level: 'warn',
        category: 'security',
        event: 'profile_path_validation_failed',
        details: { userId: user.id, attemptedPath: profilePath, errors: validation.errors },
        actor: user.id,
      });
      return new Response(JSON.stringify({
        error: 'Invalid path',
        details: validation.errors,
        warnings: validation.warnings,
      }), { status: 400 });
    }
  }

  // Update metadata
  updateUserMetadata(user.id, { profilePath: profilePath || undefined });

  audit({
    level: 'info',
    category: 'data_change',
    event: 'profile_path_changed',
    details: { userId: user.id, newPath: profilePath },
    actor: user.id,
  });

  return new Response(JSON.stringify({ success: true }));
};

// POST /api/profile-path/validate - Test a path without saving
export const validatePath: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);
  const { path: testPath } = await request.json();

  const validation = validateProfilePath(testPath);

  return new Response(JSON.stringify(validation));
};
```

#### 3.2 Migration API

**New File:** `apps/site/src/pages/api/profile-path/migrate.ts`

```typescript
// POST /api/profile-path/migrate
// Streams progress via SSE
// Body: { destination: string, keepSource: boolean }
export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getAuthenticatedUser(cookies);

  if (user.role !== 'owner') {
    return new Response('Forbidden', { status: 403 });
  }

  const { destination, keepSource = true } = await request.json();

  // Return SSE stream with progress
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      for await (const progress of migrateProfile(user.username, destination, { keepSource })) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    }
  });
};
```

#### 3.3 Settings UI Component

**New File:** `apps/site/src/components/ProfilePathSettings.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let currentPath = '';
  let defaultPath = '';
  let newPath = '';
  let validation = null;
  let migrating = false;
  let progress = 0;

  onMount(async () => {
    const res = await fetch('/api/profile-path');
    const data = await res.json();
    currentPath = data.currentPath || data.defaultPath;
    defaultPath = data.defaultPath;
  });

  async function validatePath() {
    const res = await fetch('/api/profile-path/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath })
    });
    validation = await res.json();
  }

  async function migrate() {
    migrating = true;
    // SSE progress handling...
  }
</script>

<div class="profile-path-settings">
  <h3>Profile Location</h3>

  <div class="current-path">
    <label>Current Location</label>
    <code>{currentPath}</code>
  </div>

  <div class="change-path">
    <label>New Location</label>
    <input type="text" bind:value={newPath} on:blur={validatePath} />

    {#if validation}
      {#if validation.valid}
        <span class="valid">Path is valid</span>
      {:else}
        <span class="invalid">{validation.errors.join(', ')}</span>
      {/if}
      {#if validation.warnings.length}
        <span class="warning">{validation.warnings.join(', ')}</span>
      {/if}
    {/if}
  </div>

  <button on:click={migrate} disabled={!validation?.valid || migrating}>
    {migrating ? `Migrating... ${progress}%` : 'Migrate Profile'}
  </button>
</div>
```

**Files changed:** 3 new files
**Risk:** Medium

---

### Phase 4: Migration Logic

**Objective:** Safe profile data migration.

#### 4.1 Migration Module

**New File:** `packages/core/src/profile-migration.ts`

```typescript
export interface MigrationProgress {
  step: string;
  status: 'running' | 'completed' | 'failed';
  progress?: number;
  message: string;
  error?: string;
}

export async function* migrateProfile(
  username: string,
  destination: string,
  options: { keepSource: boolean; validateIntegrity?: boolean }
): AsyncGenerator<MigrationProgress> {
  const sourcePaths = getProfilePaths(username);

  // Step 1: Validate destination
  yield { step: 'validate', status: 'running', message: 'Validating destination...' };
  const validation = validateProfilePath(destination);
  if (!validation.valid) {
    yield { step: 'validate', status: 'failed', message: 'Validation failed', error: validation.errors.join(', ') };
    return;
  }
  yield { step: 'validate', status: 'completed', message: 'Destination validated' };

  // Step 2: Create directory structure
  yield { step: 'create', status: 'running', message: 'Creating directories...' };
  const dirs = ['persona', 'memory', 'memory/episodic', 'memory/tasks', 'etc', 'logs', 'out'];
  for (const dir of dirs) {
    await fs.mkdir(path.join(destination, dir), { recursive: true });
  }
  yield { step: 'create', status: 'completed', message: 'Directory structure created' };

  // Step 3: Copy files
  yield { step: 'copy', status: 'running', progress: 0, message: 'Copying files...' };
  const files = await getAllFiles(sourcePaths.root);
  let copied = 0;
  for (const file of files) {
    const relative = path.relative(sourcePaths.root, file);
    const destFile = path.join(destination, relative);
    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await fs.copyFile(file, destFile);
    copied++;
    yield { step: 'copy', status: 'running', progress: (copied / files.length) * 100, message: `Copying ${relative}...` };
  }
  yield { step: 'copy', status: 'completed', progress: 100, message: `Copied ${files.length} files` };

  // Step 4: Verify integrity (optional)
  if (options.validateIntegrity) {
    yield { step: 'verify', status: 'running', message: 'Verifying integrity...' };
    // Compare file hashes
    yield { step: 'verify', status: 'completed', message: 'Integrity verified' };
  }

  // Step 5: Update configuration
  yield { step: 'config', status: 'running', message: 'Updating configuration...' };
  await updateUserMetadata(username, { profilePath: destination });
  yield { step: 'config', status: 'completed', message: 'Configuration updated' };

  // Step 6: Cleanup (if not keeping source)
  if (!options.keepSource) {
    yield { step: 'cleanup', status: 'running', message: 'Removing source files...' };
    await fs.rm(sourcePaths.root, { recursive: true });
    yield { step: 'cleanup', status: 'completed', message: 'Source removed' };
  }

  // Done
  yield { step: 'complete', status: 'completed', message: 'Migration complete!' };

  // Audit
  audit({
    level: 'info',
    category: 'data_change',
    event: 'profile_migration_completed',
    details: { username, source: sourcePaths.root, destination, keepSource: options.keepSource },
    actor: username,
  });
}
```

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `packages/core/src/path-security.ts` | Path validation and security checks |
| `packages/core/src/profile-migration.ts` | Safe profile migration |
| `apps/site/src/pages/api/profile-path.ts` | Path management API |
| `apps/site/src/pages/api/profile-path/migrate.ts` | Migration API |
| `apps/site/src/components/ProfilePathSettings.svelte` | Settings UI |

### Modified Files

| File | Changes |
|------|---------|
| `packages/core/src/users.ts` | Add `profilePath` field, `getUserMetadata()` |
| `packages/core/src/path-builder.ts` | Check for custom path in `getProfilePaths()` |
| `packages/core/src/audit.ts` | Add profile path event types |
| `packages/core/src/index.ts` | Export new modules |

### Unchanged Files

- All 50+ API endpoints (use `getProfilePaths()`)
- All 19+ agents (use context-aware paths)
- Session/auth system
- CLI commands
- Existing profile structure

---

## Security Checklist

- [ ] Path traversal prevention (`..` blocked)
- [ ] Symlink resolution and validation
- [ ] Forbidden system directories blocked
- [ ] MetaHuman internals protected
- [ ] Writability verification
- [ ] Permission warnings for world-readable
- [ ] Owner-only path changes
- [ ] Full audit logging
- [ ] Graceful fallback on unavailable storage

---

## Testing Plan

### Unit Tests

1. `validateProfilePath()` with valid paths
2. `validateProfilePath()` with attack vectors (`..`, symlinks, system dirs)
3. `resolveProfileRoot()` fallback behavior
4. `migrateProfile()` data integrity

### Integration Tests

1. Set custom path → verify all APIs use new location
2. External drive disconnect → verify fallback
3. Multi-user with mixed paths → verify isolation

### Manual Tests

1. USB drive workflow (connect, set path, disconnect, reconnect)
2. Large profile migration (>1GB)
3. Permission denied scenarios

---

## Rollout Plan

1. **Phase 1:** Core implementation (owner-only, local paths)
2. **Phase 2:** Security hardening (validation, fallback)
3. **Phase 3:** UI and migration tools
4. **Phase 4:** External drive detection (optional)
5. **Phase 5:** Extend to standard users (optional)

---

## Requirements (Confirmed)

- **Storage types**: Both external drives AND local filesystem paths supported
- **User scope**: Available to ALL users immediately
- **Configuration**: Via User Settings UI, default is `profiles/{username}`
- **Migration**: Files moved IMMEDIATELY when settings change (automatic)
- **Interface**: Both Web UI AND CLI command
- **Encryption**: OS-level detection only (LUKS, FileVault, BitLocker)

## Additional Components Required

### External Storage Detection

**New file:** `packages/core/src/external-storage.ts`

```typescript
export interface StorageDevice {
  id: string;           // UUID or device label
  path: string;         // Current mount point
  type: 'internal' | 'usb' | 'network' | 'encrypted';
  label?: string;
  mounted: boolean;
  writable: boolean;
  freeSpace?: number;
}

export async function detectStorageDevices(): Promise<StorageDevice[]>;
export function isExternalStorage(path: string): boolean;
export function watchStorageChanges(callback: (event: StorageEvent) => void): () => void;
```

**Linux implementation:**
- Parse `/proc/mounts` for mounted filesystems
- Use `lsblk -J -o UUID,MOUNTPOINT,FSTYPE,TYPE,SIZE,FSAVAIL,LABEL`
- Detect USB via mount under `/media/`, `/mnt/`, `/run/media/`
- Detect LUKS via `cryptsetup status`

### CLI Commands

**New file:** `packages/cli/src/commands/profile.ts`

```bash
mh profile path                              # Show current location
mh profile path set /path/to/location        # Set new location (triggers migration)
mh profile devices                           # List available storage
mh profile path validate /some/path          # Validate a path
mh profile migrate status                    # Show migration progress
```

### Complete File List

**New Files (7):**
| File | Purpose |
|------|---------|
| `packages/core/src/path-security.ts` | Path validation |
| `packages/core/src/external-storage.ts` | Storage device detection |
| `packages/core/src/profile-migration.ts` | Migration with progress |
| `apps/site/src/pages/api/profile-path.ts` | Path API |
| `apps/site/src/pages/api/profile-path/devices.ts` | Devices API |
| `apps/site/src/components/settings/ProfileLocation.svelte` | Settings UI |
| `packages/cli/src/commands/profile.ts` | CLI commands |

**Modified Files (4):**
| File | Changes |
|------|---------|
| `packages/core/src/users.ts` | Add `profilePath` to metadata |
| `packages/core/src/path-builder.ts` | Custom path resolution |
| `packages/core/src/audit.ts` | Profile path events |
| `packages/core/src/index.ts` | Export new modules |
