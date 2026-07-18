# Multi-User Profile System - Implementation Plan

**Version:** 1.1
**Date:** 2025-11-06
**Status:** Phase 1 Complete ✅ | Phase 2 In Progress
**Target:** Small number of users (5-10), OS-style user accounts

**Progress:**
- ✅ Phase 1: Foundation - Complete (context, paths, config, middleware, migration script)
- 🔄 Phase 2: Exports - In Progress (core package exports added)
- ⏳ Phase 3: Core Updates - Pending
- ⏳ Phase 4: UI/UX - Pending
- ⏳ Phase 5: Agents - Pending
- ⏳ Phase 6: CLI - Pending
- ⏳ Phase 7: Testing - Pending

---

## Executive Summary

Transform MetaHuman OS from a single-user system into a multi-user platform where each user has their own isolated profile containing memories, persona, and preferences. Think of it like user accounts on an operating system - each user gets their own space, their own data, and their own AI personality.

**Key Principle:** No artificial limits. Each user is a full MetaHuman OS instance within the shared system.

**Simplified Architecture:**
- ✅ No "shared/" directory - existing structure stays intact
- ✅ Only user data moves to `profiles/{username}/`
- ✅ Each user gets their own `etc/` config (models, training, sleep, etc.)
- ✅ System code (`brain/`, `packages/`, `apps/`) stays at root
- ✅ Users can run different base models

---

## 1. Architecture Overview

### Directory Structure

```
metahuman/
├── profiles/
│   ├── greggles/                    # First user (migrated from root)
│   │   ├── memory/                  # Personal memories
│   │   │   ├── episodic/
│   │   │   ├── tasks/
│   │   │   ├── inbox/
│   │   │   ├── index/               # Vector embeddings
│   │   │   └── calendar/
│   │   ├── persona/                 # Identity & personality
│   │   │   ├── core.json
│   │   │   ├── relationships.json
│   │   │   ├── routines.json
│   │   │   ├── decision-rules.json
│   │   │   ├── facets.json
│   │   │   └── facets/
│   │   ├── out/                     # Outputs & LoRA adapters
│   │   │   ├── adapters/
│   │   │   ├── datasets/
│   │   │   └── state/
│   │   ├── logs/                    # User-specific logs
│   │   │   ├── audit/
│   │   │   ├── decisions/
│   │   │   └── actions/
│   │   └── etc/                     # User configuration
│   │       ├── cognitive-mode.json
│   │       ├── models.json          # Base model & LoRA preferences
│   │       ├── training.json        # Training config
│   │       ├── boredom.json         # Reflection interval
│   │       ├── sleep.json           # Sleep schedule
│   │       ├── audio.json           # Audio processing
│   │       ├── ingestor.json        # File ingestion
│   │       └── autonomy.json        # Autonomy settings
│   │
│   └── alice/                       # Additional users
│       └── [same structure]
│
├── brain/                           # Unchanged - agent code
│   ├── agents/
│   ├── skills/
│   └── policies/
├── packages/                        # Unchanged - core libraries
├── apps/                            # Unchanged - web UI
├── bin/                             # Unchanged - CLI scripts
├── logs/                            # System-level logs only
│   └── run/
│       ├── agents/                  # Agent PIDs
│       ├── locks/                   # Process locks
│       └── sessions.json            # Active sessions
└── persona/                         # AUTH ONLY: users.json

```

**Key Changes from Original Plan:**
- ✅ No `shared/` directory - keeps existing structure
- ✅ `brain/`, `packages/`, `apps/`, `bin/` stay at root
- ✅ All user config moved to `profiles/{user}/etc/`
- ✅ Each user can have different base models
- ✅ Simpler migration - less moving parts

### What Stays at Root vs. User Profile

**Root Level** (System Code - Not Moved):
- ✅ `brain/` - Agent code (organizer, reflector, etc.)
- ✅ `packages/` - Core libraries
- ✅ `apps/` - Web UI code
- ✅ `bin/` - CLI scripts
- ✅ `logs/run/` - System logs (PIDs, locks, sessions)
- ✅ `persona/users.json` - User accounts database

**User Profile** (All User Data):
- 🔒 `memory/` - All memories, tasks, inbox
- 🔒 `persona/` - Identity files (core, relationships, routines)
- 🔒 `out/` - LoRA adapters, datasets, generated outputs
- 🔒 `logs/` - Personal audit trail
- 🔒 `etc/` - **ALL configuration** (models, training, boredom, sleep, audio, etc.)

---

## 2. Technical Implementation

### Path Resolution Strategy

**Problem:** Current system has hardcoded paths (`paths.episodic = /memory/episodic/`)

**Solution:** Dynamic path resolution using Node.js AsyncLocalStorage

```typescript
// packages/core/src/context.ts (NEW FILE)

import { AsyncLocalStorage } from 'async_hooks';
import { getProfilePaths } from './paths.js';

interface UserContext {
  userId: string;
  username: string;
  role: 'owner' | 'guest' | 'anonymous';
  profilePaths: ReturnType<typeof getProfilePaths>;
}

const contextStorage = new AsyncLocalStorage<UserContext>();

/**
 * Set user context (deprecated - use withUserContext instead)
 *
 * WARNING: enterWith() can leak context to unrelated async operations.
 * Prefer withUserContext() for guaranteed isolation.
 */
export function setUserContext(userId: string, username: string, role: string) {
  const profilePaths = getProfilePaths(username);
  contextStorage.enterWith({ userId, username, role, profilePaths });
}

/**
 * Clear user context (deprecated - automatic with withUserContext)
 */
export function clearUserContext() {
  // Context is automatically cleared when async context exits with withUserContext
  // This is a no-op but provided for backward compatibility
}

/**
 * Get current user context
 */
export function getUserContext(): UserContext | null {
  return contextStorage.getStore() || null;
}

/**
 * Run function with isolated user context (RECOMMENDED)
 *
 * Automatically manages context lifecycle and prevents leakage to other async operations.
 *
 * @example
 * await withUserContext({ userId: '123', username: 'alice', role: 'guest' }, async () => {
 *   // All code here (and async operations) use alice's context
 *   const memories = await captureEvent('Test');
 * });
 * // Context automatically cleaned up - no leakage to subsequent operations
 */
export function withUserContext<T>(
  user: { userId: string; username: string; role: string },
  fn: () => T | Promise<T>
): Promise<T> {
  const profilePaths = getProfilePaths(user.username);
  const context: UserContext = {
    userId: user.userId,
    username: user.username,
    role: user.role as 'owner' | 'guest' | 'anonymous',
    profilePaths,
  };

  return contextStorage.run(context, fn);
}
```

**Updated paths.ts:**

```typescript
// packages/core/src/paths.ts

import { getUserContext } from './context.js';

// NEW: Get profile-specific paths for a user
export function getProfilePaths(username: string) {
  const profileRoot = path.join(ROOT, 'profiles', username);

  return {
    root: profileRoot,
    persona: path.join(profileRoot, 'persona'),
    memory: path.join(profileRoot, 'memory'),
    episodic: path.join(profileRoot, 'memory', 'episodic'),
    tasks: path.join(profileRoot, 'memory', 'tasks'),
    logs: path.join(profileRoot, 'logs'),
    out: path.join(profileRoot, 'out'),
    etc: path.join(profileRoot, 'etc'),  // User config directory
    // ... all other paths
  };
}

// Backward compatibility: Proxy that resolves based on context
export const paths = new Proxy({} as any, {
  get(target, prop) {
    const ctx = getUserContext();

    if (ctx) {
      // User context available → return profile-scoped paths
      return ctx.profilePaths[prop];
    }

    // No context → return system paths (for CLI, system operations)
    return systemPaths[prop];
  }
});
```

**Benefits:**
- ✅ Existing code (`paths.episodic`) continues to work
- ✅ Thread-safe for concurrent users
- ✅ No massive refactoring required
- ✅ Context is isolated per async request

---

### User Configuration Loading

**New Helper:** `packages/core/src/config.ts`

Since each user now has their own `etc/` directory with config files, we need a helper to load user-specific config:

```typescript
// packages/core/src/config.ts (NEW FILE)

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';  // Use the context-aware paths proxy

/**
 * Load user-specific config file from profiles/{user}/etc/
 * Falls back to default values if file doesn't exist
 *
 * NOTE: Requires user context to be set (via setUserContext)
 */
export function loadUserConfig<T>(filename: string, defaults: T): T {
  const configPath = path.join(paths.etc, filename);  // paths.etc resolves based on context

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[Config] Failed to load ${filename}:`, error);
    return defaults;
  }
}

/**
 * Save user-specific config file to profiles/{user}/etc/
 *
 * NOTE: Requires user context to be set (via setUserContext)
 */
export function saveUserConfig<T>(filename: string, data: T): void {
  const configPath = path.join(paths.etc, filename);  // paths.etc resolves based on context

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
}
```

**Usage Example:**

```typescript
// Load user's model preferences
import { loadUserConfig } from '@metahuman/core/config';

const modelConfig = loadUserConfig('models.json', {
  baseModel: 'qwen3.5:9b',
  activeAdapter: null,
  roles: { /* defaults */ }
});

// Each user can have different base models!
// Alice might use qwen3.5:9b
// Bob might use llama3:8b
```

**Benefits:**
- ✅ Each user gets their own config (models, training, sleep schedule, etc.)
- ✅ Graceful fallback to defaults if config missing
- ✅ Easy to add new config files
- ✅ No shared config conflicts

---

### Authentication Integration

**Current System:** Already have working auth in `packages/core/src/users.ts`

**Enhancement:** Map authenticated user → profile path

```typescript
// apps/site/src/middleware/userContext.ts (NEW FILE)

import { withUserContext as runWithUserContext } from '@metahuman/core/context';
import { validateSession, getUser } from '@metahuman/core';

export function withUserContext(handler: APIRoute): APIRoute {
  return async (context) => {
    const sessionCookie = context.cookies.get('mh_session');

    if (sessionCookie) {
      const session = validateSession(sessionCookie.value);
      if (session) {
        const user = getUser(session.userId);
        if (user) {
          // Run handler with user context (automatic isolation and cleanup)
          return await runWithUserContext(
            { userId: user.id, username: user.username, role: user.role },
            () => handler(context)
          );
        }
      }
    }

    // No session - run without user context
    return await handler(context);
  };
}
```

**Apply to all API endpoints:**

```typescript
// apps/site/src/pages/api/capture.ts

export const POST = withUserContext(requireWriteMode(handler));
```

---

### Agent Multi-User Support

**Strategy:** Agents iterate through all users, processing each profile sequentially

```typescript
// brain/agents/organizer.ts

import { listUsers } from '@metahuman/core/users';
import { withUserContext } from '@metahuman/core/context';

async function runCycle() {
  const users = listUsers();

  for (const user of users) {
    console.log(`[Organizer] Processing user: ${user.username}`);

    try {
      // Use withUserContext for automatic isolation and cleanup
      await withUserContext(
        { userId: user.id, username: user.username, role: user.role },
        async () => {
          // Find and process unprocessed memories
          const memories = findUnprocessedMemories(); // Uses context!
          for (const mem of memories) {
            await processMemory(mem);
          }
        }
      );
      // Context automatically cleaned up - no leakage to next user
    } catch (error) {
      console.error(`[Organizer] Error processing ${user.username}:`, error);
    }
  }

  console.log(`[Organizer] Cycle complete for ${users.length} users`);
}
```

---

## 3. Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Build infrastructure without breaking existing code

**Tasks:**
1. ✅ Create `packages/core/src/context.ts` with AsyncLocalStorage
   - Implement `withUserContext()` for automatic isolation (RECOMMENDED)
   - Implement `setUserContext()` and `clearUserContext()` for backward compatibility
   - Implement `getUserContext()` to retrieve current user
2. ✅ Update `packages/core/src/paths.ts`:
   - Add `getProfilePaths(username)` function (uses username, NOT userId)
   - Add `systemPaths` for non-user operations
   - Replace `export const paths` with Proxy
3. ✅ Create `apps/site/src/middleware/userContext.ts`
4. ✅ Create directory structure:
   ```bash
   mkdir -p profiles/.keep
   ```
5. ✅ Write migration script (don't run yet)

**Deliverables:**
- Context management system (tested in isolation)
- Dynamic path resolution (tested with mock users)
- Migration script (reviewed, not executed)

**Validation:**
- Unit tests for `getProfilePaths()`
- Unit tests for context storage
- No changes to production yet

---

### Phase 2: Migration (Week 1-2)

**Goal:** Move existing data to profile structure

**Migration Script:** `scripts/migrate-to-profiles.ts`

```typescript
#!/usr/bin/env tsx

import fs from 'fs-extra';
import path from 'path';
import { ROOT } from '@metahuman/core/paths';
import { listUsers } from '@metahuman/core/users';

async function migrateToProfiles() {
  console.log('🔄 MetaHuman OS Multi-User Migration');
  console.log('====================================\n');

  // 1. Create backup
  const backupDir = path.join(ROOT, '.backup-before-migration');
  console.log('📦 Creating backup...');
  await fs.copy(ROOT, backupDir, {
    filter: (src) => {
      // Don't backup node_modules, .git, etc.
      const base = path.basename(src);
      return !['node_modules', '.git', '.backup'].includes(base);
    }
  });
  console.log(`✅ Backup created: ${backupDir}\n`);

  // 2. Get primary user (owner)
  const users = listUsers();
  const owner = users.find(u => u.role === 'owner');

  if (!owner) {
    throw new Error('❌ No owner user found. Create one with: mh user create');
  }

  console.log(`👤 Migrating data for user: ${owner.username}\n`);

  // 3. Create profile directory
  const profileDir = path.join(ROOT, 'profiles', owner.username);
  await fs.ensureDir(profileDir);
  console.log(`📁 Created profile directory: profiles/${owner.username}/\n`);

  // 4. Move user-specific directories (BUT PRESERVE CRITICAL ROOT FILES)
  const dirsToMove = [
    { src: 'memory', dest: 'memory' },
    { src: 'out', dest: 'out' },
  ];

  for (const { src, dest } of dirsToMove) {
    const srcPath = path.join(ROOT, src);
    const destPath = path.join(profileDir, dest);

    if (await fs.pathExists(srcPath)) {
      console.log(`📦 Moving ${src}/ → profiles/${owner.username}/${dest}/`);
      await fs.move(srcPath, destPath);
    } else {
      console.log(`⚠️  Skipping ${src}/ (not found)`);
    }
  }

  console.log('');

  // 5. Move config files FIRST (before moving persona directory)
  // This ensures persona/cognitive-mode.json is moved before persona/ tree is relocated
  const etcDir = path.join(profileDir, 'etc');
  await fs.ensureDir(etcDir);

  const configFiles = [
    { src: 'persona/cognitive-mode.json', dest: 'cognitive-mode.json' },
    { src: 'etc/models.json', dest: 'models.json' },
    { src: 'etc/training.json', dest: 'training.json' },
    { src: 'etc/boredom.json', dest: 'boredom.json' },
    { src: 'etc/sleep.json', dest: 'sleep.json' },
    { src: 'etc/audio.json', dest: 'audio.json' },
    { src: 'etc/ingestor.json', dest: 'ingestor.json' },
    { src: 'etc/autonomy.json', dest: 'autonomy.json' },
  ];

  for (const { src, dest } of configFiles) {
    const srcPath = path.join(ROOT, src);
    const destPath = path.join(etcDir, dest);

    if (await fs.pathExists(srcPath)) {
      console.log(`📄 Moving ${src} → etc/${dest}`);
      await fs.move(srcPath, destPath);
    }
  }

  console.log('');

  // 6. Move persona files (EXCEPT users.json which stays at root for auth)
  const personaSrcDir = path.join(ROOT, 'persona');
  const personaDestDir = path.join(profileDir, 'persona');
  await fs.ensureDir(personaDestDir);

  if (await fs.pathExists(personaSrcDir)) {
    const personaFiles = await fs.readdir(personaSrcDir);

    for (const file of personaFiles) {
      // CRITICAL: Skip users.json - it must stay at root for authentication
      if (file === 'users.json') {
        console.log(`🔒 Preserving persona/users.json at root (required for auth)`);
        continue;
      }

      const srcPath = path.join(personaSrcDir, file);
      const destPath = path.join(personaDestDir, file);

      console.log(`📦 Moving persona/${file} → profiles/${owner.username}/persona/${file}`);

      if ((await fs.stat(srcPath)).isDirectory()) {
        await fs.move(srcPath, destPath);
      } else {
        await fs.move(srcPath, destPath);
      }
    }
  }

  console.log('');

  // 7. Move user-specific logs (EXCEPT logs/run/ which stays at root for system)
  const logsSrcDir = path.join(ROOT, 'logs');
  const logsDestDir = path.join(profileDir, 'logs');
  await fs.ensureDir(logsDestDir);

  if (await fs.pathExists(logsSrcDir)) {
    const logDirs = await fs.readdir(logsSrcDir);

    for (const dir of logDirs) {
      // CRITICAL: Skip logs/run/ - it contains system PIDs, locks, sessions
      if (dir === 'run') {
        console.log(`🔒 Preserving logs/run/ at root (contains system PIDs/locks)`);
        continue;
      }

      const srcPath = path.join(logsSrcDir, dir);
      const destPath = path.join(logsDestDir, dir);

      if ((await fs.stat(srcPath)).isDirectory()) {
        console.log(`📦 Moving logs/${dir}/ → profiles/${owner.username}/logs/${dir}/`);
        await fs.move(srcPath, destPath);
      }
    }
  }

  console.log('');

  // 8. Create migration marker
  const markerFile = path.join(ROOT, '.multi-user-migrated');
  await fs.writeJson(markerFile, {
    migratedAt: new Date().toISOString(),
    version: '2.0.0',
    primaryUser: owner.username,
    primaryUserId: owner.id,
    backupLocation: backupDir,
  }, { spaces: 2 });

  console.log('✅ Migration complete!\n');
  console.log('📍 Primary user profile:', `profiles/${owner.username}/`);
  console.log('📍 Root structure:', 'Unchanged (brain/, packages/, apps/, bin/)');
  console.log('📍 Backup location:', backupDir);
  console.log('\n⚠️  Important: Restart all services for changes to take effect');
  console.log('   - Stop any running agents');
  console.log('   - Restart web server');
  console.log('   - Test with: ./bin/mh status');
}

migrateToProfiles().catch((error) => {
  console.error('❌ Migration failed:', error);
  console.error('\n🔄 To rollback, restore from backup:');
  console.error('   - Stop all services');
  console.error('   - Move .backup-before-migration/* back to root');
  process.exit(1);
});
```

**Execution:**

```bash
# 1. Review migration plan
cat docs/MULTI_USER_PLAN.md

# 2. Test migration on copy of data (recommended)
cp -r /home/greggles/metahuman /tmp/metahuman-test
cd /tmp/metahuman-test
tsx scripts/migrate-to-profiles.ts

# 3. Run on production
cd /home/greggles/metahuman
tsx scripts/migrate-to-profiles.ts

# 4. Verify data integrity
./bin/mh status
./bin/mh remember "test"
ls -la profiles/greggles/
```

**Rollback Plan:**

If migration fails:
```bash
# Stop all services
pkill -f "astro dev"
pkill -f "organizer"

# Restore from backup
rm -rf memory persona out logs/audit logs/decisions
cp -r .backup-before-migration/* .

# Restart
pnpm dev
```

---

### Phase 3: Core Library Updates (Week 2-3)

**Goal:** Update core functions to use new path system

**Files to Update:**

1. **packages/core/src/memory.ts**
   - Update `captureEvent()` to use `getPaths()`
   - Add `userId` to memory metadata
   - Update `searchMemory()` to use user context

2. **packages/core/src/identity.ts**
   - Update `loadPersonaCore()` to use `getPaths()`
   - Update all persona file operations

3. **packages/core/src/audit.ts**
   - Include `userId` in all audit entries
   - Add `actor` field (userId or 'system')

4. **packages/core/src/vector-index.ts**
   - Use per-user index directories
   - Update `buildMemoryIndex()` to use user paths

5. **packages/core/src/model-router.ts**
   - Load per-user model preferences from `profiles/{user}/etc/models.json`
   - Each user can specify different base models and LoRA adapters

6. **Configuration Loading** (NEW helper function)
   - Create `packages/core/src/config.ts` to load user-specific config
   - Falls back to default values if file doesn't exist
   - Example: `loadUserConfig('models.json')` → loads from user's etc/

7. **All API Endpoints:**
   - Wrap with `withUserContext()` middleware
   - Validate user permissions

**Example Update:**

```typescript
// packages/core/src/memory.ts (BEFORE)
export function captureEvent(content: string, opts = {}) {
  const filepath = path.join(paths.episodic, year, filename);
  fs.writeFileSync(filepath, JSON.stringify(event, null, 2));
}

// packages/core/src/memory.ts (AFTER)
import { paths } from './paths.js'; // Uses context-aware proxy!
import { getUserContext } from './context.js';

export function captureEvent(content: string, opts = {}) {
  const ctx = getUserContext();

  const event = {
    id: generateId('evt'),
    timestamp: timestamp(),
    content,
    userId: ctx?.userId, // NEW: Track owner
    metadata: {
      cognitiveMode: opts.metadata?.cognitiveMode,
      ...opts.metadata,
    },
    // ... rest of event
  };

  // paths.episodic automatically resolves to the correct user profile
  const filepath = path.join(paths.episodic, year, filename);
  fs.writeFileSync(filepath, JSON.stringify(event, null, 2));

  return filepath;
}
```

**Validation:**

Create test user "alice":
```bash
# Create user
./bin/mh user create alice --role guest

# Capture memory as alice (via API)
curl -X POST http://localhost:4321/api/capture \
  -H "Cookie: mh_session=<alice-session-id>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test memory from Alice"}'

# Verify stored in alice's profile
ls profiles/alice/memory/episodic/2025/

# Verify greggles's memories are separate
ls profiles/greggles/memory/episodic/2025/
```

---

### Phase 4: UI/UX Updates (Week 3)

**Goal:** Add profile selection and user management

**Components to Create:**

1. **ProfileDropdown.svelte** - Profile switcher in header
2. **ProfileIndicator.svelte** - Show active user in sidebar
3. **UserManagement.svelte** - Admin page (owner only)
4. **ProfileSettings.svelte** - User profile settings

**API Endpoints to Create:**

```typescript
// apps/site/src/pages/api/profiles/list.ts
export const GET: APIRoute = async (context) => {
  const session = getSessionFromCookie(context.cookies);
  if (!session || session.role !== 'owner') {
    return json({ error: 'Unauthorized' }, { status: 403 });
  }

  const users = listUsers();
  return json(users);
};

// apps/site/src/pages/api/profiles/switch.ts
export const POST: APIRoute = async (context) => {
  const session = getSessionFromCookie(context.cookies);
  if (!session || session.role !== 'owner') {
    return json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetUserId } = await context.request.json();
  const targetUser = getUser(targetUserId);

  // Create new session for target user
  const newSession = createSession(targetUser.id, targetUser.role);

  context.cookies.set('mh_session', newSession.id, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 86400, // 24 hours
  });

  return json({ success: true, user: targetUser });
};

// apps/site/src/pages/api/users/create.ts
export const POST: APIRoute = async (context) => {
  const session = getSessionFromCookie(context.cookies);
  if (!session || session.role !== 'owner') {
    return json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { username, password, role } = await context.request.json();

  // Create user account
  const user = createUser(username, password, role);

  // Initialize profile directory (use username, not user.id!)
  const profilePath = getProfilePaths(user.username).root;
  await initializeProfile(profilePath);

  audit({
    level: 'info',
    category: 'security',
    event: 'user_created',
    details: { userId: user.id, username, role },
    actor: session.userId,
  });

  return json({ success: true, user });
};
```

**UI Flow:**

1. **Login Screen** - Unchanged (username/password)

2. **Profile Indicator** (Left Sidebar):
   ```
   ┌─────────────────────────┐
   │ 👤 greggles (Owner)     │
   │ 🟢 Online · Dual Mode   │
   └─────────────────────────┘
   ```

3. **Profile Dropdown** (Header - Owner Only):
   ```
   ┌──────────────────────────────┐
   │  👤 greggles (Owner)        │ ← Current
   ├──────────────────────────────┤
   │  Switch Profile:             │
   │  ○ alice (Guest)             │
   │  ○ bob (Guest)               │
   ├──────────────────────────────┤
   │  ➕ Create New User          │
   │  ⚙️ Manage Users             │
   │  🚪 Logout                   │
   └──────────────────────────────┘
   ```

4. **User Management Page** (Owner Only):
   - List all users
   - Create new user (username, password, role)
   - Delete user (with confirmation)
   - Reset password

---

### Phase 5: Agent Updates (Week 3-4)

**Goal:** Agents process all users' data

**Update Pattern:**

```typescript
// brain/agents/organizer.ts

import { listUsers } from '@metahuman/core/users';
import { withUserContext } from '@metahuman/core/context';

async function runCycle() {
  const users = listUsers();
  console.log(`[Organizer] Starting cycle for ${users.length} users`);

  for (const user of users) {
    console.log(`[Organizer] Processing: ${user.username}`);

    try {
      // Use withUserContext for automatic isolation and cleanup
      await withUserContext(
        { userId: user.id, username: user.username, role: user.role },
        async () => {
          // Find unprocessed memories (uses user context!)
          const memories = findUnprocessedMemories();
          console.log(`[Organizer]   Found ${memories.length} unprocessed memories`);

          for (const mem of memories) {
            await processMemory(mem);
          }
        }
      );
      // Context automatically cleaned up - no leakage to next user
    } catch (error) {
      console.error(`[Organizer] Error processing ${user.username}:`, error);
    }
  }

  console.log(`[Organizer] Cycle complete`);
}
```

**Agents to Update:**

1. ✅ **organizer.ts** - Enrich memories
2. ✅ **reflector.ts** - Generate reflections
3. ✅ **dreamer.ts** - Create dreams
4. ✅ **ingestor.ts** - Process inbox files
5. ✅ **boredom-service.ts** - Trigger reflector per user
6. ✅ **sleep-service.ts** - Trigger dreamer per user

**Testing:**

```bash
# Create test user
./bin/mh user create testuser --role guest

# Capture unprocessed memory as testuser
curl -X POST http://localhost:4321/api/capture \
  -H "Cookie: mh_session=<testuser-session>" \
  -d '{"content": "Test memory"}'

# Run organizer
./bin/mh agent run organizer

# Verify memory was processed
cat profiles/testuser/memory/episodic/2025/evt-*.json
# Should show "processed": true
```

---

### Phase 6: CLI Support (Week 4)

**Goal:** CLI can operate on specific profiles

**Add `--user` flag:**

```typescript
// packages/cli/src/mh.ts

import { program } from 'commander';
import { withUserContext } from '@metahuman/core/context';
import { listUsers } from '@metahuman/core/users';

// Store user context for command execution
let cliUser: { userId: string; username: string; role: string } | null = null;

// Global option for all commands
program
  .option('--user <username>', 'Operate as specific user')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.user) {
      // Find user by username
      const users = listUsers();
      const user = users.find(u => u.username === opts.user);

      if (!user) {
        console.error(`Error: User "${opts.user}" not found`);
        process.exit(1);
      }

      // Store user for command execution
      cliUser = { userId: user.id, username: user.username, role: user.role };
      console.log(`[CLI] Operating as user: ${user.username}`);
    }
  });

// Wrap command execution with user context
async function runCommand(fn: () => Promise<void>) {
  if (cliUser) {
    await withUserContext(cliUser, fn);
  } else {
    await fn();
  }
}

// Example command
program
  .command('capture <content>')
  .action(async (content) => {
    await runCommand(async () => {
      // This code runs with correct user context
      const path = captureEvent(content);
      console.log(`Captured: ${path}`);
    });
  });
```

**Usage:**

```bash
# Capture memory as alice
./bin/mh capture --user alice "Meeting with Bob"

# List alice's tasks
./bin/mh task --user alice

# Search alice's memories
./bin/mh remember --user alice "Bob"

# Without --user flag, defaults to first owner user
./bin/mh status
```

**New Commands:**

```bash
# List all users
./bin/mh user list

# Create user
./bin/mh user create <username> --role <owner|guest>

# Delete user
./bin/mh user delete <username>

# Switch default user
./bin/mh user set-default <username>
```

---

### Phase 7: Testing & Hardening (Week 5)

**Goal:** Comprehensive testing and security audit

**Test Scenarios:**

1. **Multi-User Data Isolation:**
   ```bash
   # User A captures memory
   ./bin/mh capture --user alice "Secret message"

   # User B cannot see it
   ./bin/mh remember --user bob "secret"
   # Should return no results

   # Verify file permissions
   ls -la profiles/alice/memory/episodic/
   # Should be owned by correct user
   ```

2. **Concurrent Access:**
   ```bash
   # Open two browser sessions
   # Session 1: Login as alice
   # Session 2: Login as bob
   # Both capture memories simultaneously
   # Verify no collisions
   ```

3. **Agent Processing:**
   ```bash
   # Create memories for multiple users
   ./bin/mh capture --user alice "Unprocessed memory 1"
   ./bin/mh capture --user bob "Unprocessed memory 2"

   # Run organizer
   ./bin/mh agent run organizer

   # Verify both processed
   grep "processed.*true" profiles/alice/memory/episodic/2025/*.json
   grep "processed.*true" profiles/bob/memory/episodic/2025/*.json
   ```

4. **Profile Switching (Owner Only):**
   ```bash
   # Login as owner
   # Switch to alice's profile
   # Verify seeing alice's data
   # Switch back to owner
   # Verify seeing owner's data
   ```

5. **Authorization:**
   ```bash
   # Login as guest user "alice"
   # Attempt to switch to bob's profile
   # Should be denied (403)

   # Attempt to create new user
   # Should be denied (403)
   ```

6. **Security Audit:**
   - Path traversal attempts
   - Cross-profile data access
   - Session hijacking
   - CSRF protection

**Performance Testing:**

```bash
# Create 10 test users
for i in {1..10}; do
  ./bin/mh user create "user$i" --role guest
done

# Capture 100 memories per user
for i in {1..10}; do
  for j in {1..100}; do
    ./bin/mh capture --user "user$i" "Memory $j"
  done
done

# Time organizer cycle
time ./bin/mh agent run organizer

# Should complete in reasonable time (< 5 min for 1000 memories)
```

**Validation Checklist:**

- ✅ All users have isolated directories
- ✅ Audit logs show correct userId
- ✅ Vector indexes are per-user
- ✅ LoRA adapters are per-user
- ✅ Agents process all users correctly
- ✅ UI shows correct profile
- ✅ Profile switching works (owner only)
- ✅ CLI `--user` flag works
- ✅ No path traversal vulnerabilities
- ✅ No data leakage between users

---

## 4. User Experience

### For End Users (Guests)

**What They See:**
- ✅ Login with username/password
- ✅ Their own memories, tasks, and persona
- ✅ Cannot see other users' data
- ✅ Cannot switch profiles
- ✅ Cannot create new users

**Workflow:**
1. Login → Redirected to homepage
2. Use chat, tasks, memory browser normally
3. All data saved to their profile
4. Logout when done

---

### For Owners

**What They See:**
- ✅ All guest user features
- ✅ Profile dropdown in header
- ✅ User management page
- ✅ Can switch between profiles
- ✅ Can create/delete users

**Workflow:**
1. Login as owner
2. View dropdown → See all users
3. Click "Switch to alice"
4. Now viewing alice's profile
5. Switch back to owner profile
6. Go to User Management → Create new user

---

### For the System Owner

MetaHuman OS uses the persisted **owner** role as its single full-system authority.

**Owner Capabilities:**
- ✅ **Edit system code** - Modify files in `brain/`, `packages/`, `apps/`, `bin/`
- ✅ **Access all profiles** - View and edit any user's profile data
- ✅ **Execute dangerous operations** - File system access, code editing
- ✅ **Manage dependencies** - Install packages, modify package.json
- ✅ **System configuration** - Modify root-level config files

**Regular User Restrictions:**
- ❌ Cannot edit system code (brain/, packages/, apps/, bin/)
- ❌ Cannot access other users' profiles
- ❌ Cannot modify root-level configuration
- ✅ **Can only edit files within their own profile** (`profiles/{username}/`)

**Security Enforcement:**

The security policy enforces file access restrictions at multiple levels:

1. **API-level checks** - `policy.requireFileAccess(filePath)` throws SecurityError for unauthorized access
2. **Path validation** - System paths vs. profile paths detected automatically
3. **Owner detection** - The persisted user role is checked directly
4. **Audit logging** - All file operations are logged with username and role

**Example Security Flow:**
```typescript
// Regular user tries to edit system code
const policy = getSecurityPolicy(context);
policy.requireFileAccess('brain/agents/organizer.ts');
// ❌ Throws: "Cannot edit system code - owner role required"

// Owner edits system code
const policy = getSecurityPolicy(context);
policy.requireFileAccess('brain/agents/organizer.ts');
// ✅ Allowed - user has the owner role

// Regular user edits own profile
const policy = getSecurityPolicy(context);
policy.requireFileAccess('profiles/alice/persona/core.json');
// ✅ Allowed - accessing own profile

// Regular user tries to access another profile
const policy = getSecurityPolicy(context);
policy.requireFileAccess('profiles/bob/persona/core.json');
// ❌ Throws: "Cannot access other user profiles - owner role required"
```

**Owner Commands:**
```bash
# Backup all profiles
tar -czf profiles-backup-$(date +%Y%m%d).tar.gz profiles/

# Restore profile
tar -xzf profiles-backup-20251106.tar.gz

# Check disk usage per user
du -sh profiles/*/

# Archive inactive user
mkdir -p profiles/_archive
mv profiles/old-user profiles/_archive/old-user-$(date +%Y%m%d)
```

---

## 5. Security Model

### Authentication Levels

**unauthenticated** → Blocked at the authentication gate
**guest** → Read-only chat access
**standard** → Read/write access to the user's own profile
**owner** → Full system access, can switch profiles and manage users
### Owner Privileges

**What the Owner Can Do:**
- ✅ Edit system code (`brain/`, `packages/`, `apps/`, `bin/`)
- ✅ Access all user profiles (not just own)
- ✅ Modify root-level configuration
- ✅ Execute dangerous operations (file editing, package management)

**What Regular Users CANNOT Do:**
- ❌ Edit system code
- ❌ Access other users' profiles
- ❌ Modify system directories
- ✅ **Can only edit files within `profiles/{username}/`**

**Security Enforcement:**
```typescript
// In SecurityPolicy
policy.requireFileAccess('brain/agents/organizer.ts');
// ✅ Allowed for the owner
// ❌ Throws SecurityError for regular users
```

### Authorization Matrix

| Action | Anonymous | Guest | Standard | Owner |
|--------|-----------|-------|----------|-------|
| View own memories | ❌ | ❌ | ✅ | ✅ |
| Create memories | ❌ | ❌ | ✅ | ✅ |
| View other memories | ❌ | ❌ | ❌ | ✅ |
| Edit own profile | ❌ | ❌ | ✅ | ✅ |
| Edit other profiles | ❌ | ❌ | ❌ | ✅ |
| Edit system code | ❌ | ❌ | ❌ | ✅ |
| Switch profiles | ❌ | ❌ | ❌ | ✅ |
| Create users | ❌ | ❌ | ❌ | ✅ |
| Delete users | ❌ | ❌ | ❌ | ✅ |
| Manage system config | ❌ | ❌ | ❌ | ✅ |

### File Permissions

```bash
# Profile directories
chmod 700 profiles/*/           # Owner only

# Config files
chmod 600 profiles/*/etc/*      # Owner only

# User database
chmod 600 persona/users.json    # Owner only
```

### API Security

```typescript
// All data endpoints validate profile access
export const GET: APIRoute = async (context) => {
  const session = getSessionFromCookie(context.cookies);
  if (!session) return unauthorized();

  // Set user context (ensures correct profile paths)
  setUserContext(session.userId, session.username, session.role);

  // Data operations now use correct profile
  const memories = listMemories(); // Uses session.userId's paths

  return json(memories);
};
```

---

## 6. Rollback Plan

### If Migration Fails

**Immediate Rollback:**

```bash
# 1. Stop all services
pkill -f "astro dev"
pkill -f "agent"

# 2. Restore from backup
cd /home/greggles/metahuman
rm -rf memory persona out logs/audit
cp -r .backup-before-migration/* .

# 3. Remove migration marker
rm .multi-user-migrated

# 4. Restart services
pnpm dev
```

**Validation:**
```bash
./bin/mh status
./bin/mh remember "test"
# Should work as before
```

---

### If Production Issues After Migration

**Partial Rollback (Keep New Structure, Fix Code):**

```bash
# 1. Revert code changes
git log --oneline | grep "multi-user"
git revert <commit-hash>

# 2. Create symlinks for backward compatibility
ln -s profiles/greggles/memory memory
ln -s profiles/greggles/persona persona
ln -s profiles/greggles/out out
ln -s profiles/greggles/logs logs

# 3. Restart
pnpm dev
```

---

## 7. Documentation Updates

### Files to Update

1. **README.md** - Add multi-user setup section
2. **docs/user-guide/17-authentication-setup.md** - User management guide
3. **CLAUDE.md** - Update architecture section
4. **docs/user-guide/01-overview.md** - Mention multi-user support

### New Documentation

1. **docs/user-guide/19-multi-user-system.md** - Complete guide
2. **docs/admin-guide/01-user-management.md** - Admin operations
3. **docs/admin-guide/02-backup-restore.md** - Profile backup guide

---

## 8. Success Criteria

### MVP Must-Haves

✅ Multiple users can login with separate accounts
✅ Each user has isolated memory, persona, tasks
✅ Users cannot access each other's data
✅ Owner can manage all profiles
✅ Agents process all users correctly
✅ Migration from single-user works smoothly
✅ Audit trail shows userId for all operations
✅ No artificial limits (disk quotas, user counts)

### Future Enhancements

🔲 Shared memories (collaborative notes)
🔲 Profile templates (quick setup)
🔲 Profile export/import (JSON backup)
🔲 User groups (beyond owner/guest)
🔲 Profile analytics (usage stats)
🔲 Multi-instance sync (across machines)

---

## 9. Timeline

| Phase | Duration | Target Date |
|-------|----------|-------------|
| Phase 1: Foundation | 1 week | Week 1 |
| Phase 2: Migration | 1 week | Week 2 |
| Phase 3: Core Updates | 2 weeks | Week 3-4 |
| Phase 4: UI/UX | 1 week | Week 4 |
| Phase 5: Agents | 1 week | Week 4-5 |
| Phase 6: CLI | 1 week | Week 5 |
| Phase 7: Testing | 1 week | Week 6 |
| **Total** | **8 weeks** | **TBD** |

**Start Date:** TBD
**Target Completion:** TBD

---

## 10. Next Steps

### Immediate Actions

1. ✅ Review this plan document
2. ⏳ Approve architecture and approach
3. ⏳ Set start date for Phase 1
4. ⏳ Create GitHub issue to track progress
5. ⏳ Begin Phase 1 implementation

### Questions to Resolve

1. **User naming:** Use username or UUID for profile directories?
   - Recommendation: **Username** (easier to navigate, can rename)
2. **CLI default user:** Which user when no `--user` flag?
   - Recommendation: **First owner user** (backward compat)
3. **Migration timing:** Automatic on boot or manual script?
   - Recommendation: **Manual script** (more control)

---

## Appendix A: Key Files Reference

### New Files to Create

```
packages/core/src/context.ts          # User context management
apps/site/src/middleware/userContext.ts   # API middleware
apps/site/src/pages/api/profiles/list.ts  # List profiles
apps/site/src/pages/api/profiles/switch.ts  # Switch profile
apps/site/src/pages/api/users/create.ts   # Create user
apps/site/src/components/ProfileDropdown.svelte  # UI component
scripts/migrate-to-profiles.ts        # Migration script
docs/user-guide/19-multi-user-system.md  # User documentation
docs/admin-guide/01-user-management.md   # Admin documentation
```

### Files to Modify

```
packages/core/src/paths.ts            # Dynamic path resolution
packages/core/src/memory.ts           # Use context-aware paths
packages/core/src/identity.ts         # Use context-aware paths
packages/core/src/audit.ts            # Add userId to logs
packages/core/src/vector-index.ts     # Per-user indexes
packages/core/src/model-router.ts     # Per-user model prefs
brain/agents/organizer.ts             # Multi-user iteration
brain/agents/reflector.ts             # Multi-user iteration
brain/agents/dreamer.ts               # Multi-user iteration
apps/site/src/components/LeftSidebar.svelte  # Profile indicator
CLAUDE.md                              # Architecture docs
README.md                              # Setup instructions
```

---

## Appendix B: Example Commands

```bash
# Migration
tsx scripts/migrate-to-profiles.ts

# User Management
./bin/mh user list
./bin/mh user create alice --role guest
./bin/mh user delete alice

# CLI with --user flag
./bin/mh capture --user alice "Test memory"
./bin/mh task --user alice
./bin/mh remember --user alice "test"

# Agent testing
./bin/mh agent run organizer

# Backup
tar -czf profiles-backup.tar.gz profiles/

# Disk usage
du -sh profiles/*/
```

---

**End of Plan Document**

*This plan is a living document. Update as implementation progresses.*
