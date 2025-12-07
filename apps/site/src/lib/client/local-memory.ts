/**
 * Local Memory Database
 *
 * IndexedDB-based local storage for complete offline operation.
 * All data is stored locally first, then synced to server when connected.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// Conversation buffer types
export type MessageRole = 'user' | 'assistant' | 'system' | 'reflection' | 'dream' | 'reasoning';
export type BufferMode = 'conversation' | 'inner';

export interface BufferMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
  meta?: Record<string, any>;
}

export interface ConversationBuffer {
  mode: BufferMode;
  messages: BufferMessage[];
  lastUpdated: string;
  messageLimit: number;
}

// Database schema
interface LocalMemoryDB extends DBSchema {
  memories: {
    key: string;  // UUID
    value: {
      id: string;
      type: string;
      content: string;
      timestamp: string;
      metadata: Record<string, any>;
      synced: boolean;
      syncedAt?: string;
      localModifiedAt: string;
      serverModifiedAt?: string;
      deleted?: boolean;
    };
    indexes: {
      'by-timestamp': string;
      'by-type': string;
      'by-synced': boolean;
      'by-deleted': boolean;
    };
  };
  // Conversation buffers for offline chat
  conversationBuffers: {
    key: string;  // 'conversation' or 'inner'
    value: ConversationBuffer;
  };
  persona: {
    key: string;
    value: {
      key: string;  // 'core', 'relationships', 'routines', 'decision-rules'
      data: Record<string, any>;
      syncedAt?: string;
      localModifiedAt: string;
    };
  };
  tasks: {
    key: string;
    value: {
      id: string;
      title: string;
      status: 'pending' | 'active' | 'completed' | 'cancelled';
      priority: number;
      tags: string[];
      createdAt: string;
      updatedAt: string;
      synced: boolean;
      deleted?: boolean;
    };
    indexes: {
      'by-status': string;
      'by-synced': boolean;
    };
  };
  settings: {
    key: string;
    value: {
      key: string;
      value: any;
      updatedAt: string;
    };
  };
  syncMeta: {
    key: string;
    value: {
      key: string;  // 'lastSync', 'serverUrl', etc.
      value: string;
      updatedAt: string;
    };
  };
  // Local user accounts for offline authentication
  users: {
    key: string;  // username
    value: {
      username: string;
      displayName: string;
      passwordHash: string;  // SHA-256 hash for local validation
      profileType: 'local' | 'server';  // Where profile data lives
      profilePath?: string;  // Filesystem path for local profiles
      encrypted: boolean;
      encryptionType?: 'none' | 'aes256';
      serverUrl?: string;  // Which server this user syncs with
      createdAt: string;
      lastLoginAt?: string;
      syncedAt?: string;  // Last sync with server
      pendingVerification?: boolean;  // True if credentials haven't been verified with server
      verificationFailed?: boolean;   // True if server rejected the credentials
    };
    indexes: {
      'by-profileType': string;
    };
  };
}

// Exported types
export type LocalUser = LocalMemoryDB['users']['value'];

export type LocalMemory = LocalMemoryDB['memories']['value'];
export type LocalPersona = LocalMemoryDB['persona']['value'];
export type LocalTask = LocalMemoryDB['tasks']['value'];

const DB_NAME = 'metahuman-local';
const DB_VERSION = 3;  // Bumped for conversationBuffers store

const DEFAULT_MESSAGE_LIMIT = 50;

let dbInstance: IDBPDatabase<LocalMemoryDB> | null = null;

/**
 * Initialize and get the database instance
 */
export async function getDB(): Promise<IDBPDatabase<LocalMemoryDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<LocalMemoryDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Memories store
      if (!db.objectStoreNames.contains('memories')) {
        const memoryStore = db.createObjectStore('memories', { keyPath: 'id' });
        memoryStore.createIndex('by-timestamp', 'timestamp');
        memoryStore.createIndex('by-type', 'type');
        memoryStore.createIndex('by-synced', 'synced');
        memoryStore.createIndex('by-deleted', 'deleted');
      }

      // Persona store
      if (!db.objectStoreNames.contains('persona')) {
        db.createObjectStore('persona', { keyPath: 'key' });
      }

      // Tasks store
      if (!db.objectStoreNames.contains('tasks')) {
        const taskStore = db.createObjectStore('tasks', { keyPath: 'id' });
        taskStore.createIndex('by-status', 'status');
        taskStore.createIndex('by-synced', 'synced');
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Sync metadata store
      if (!db.objectStoreNames.contains('syncMeta')) {
        db.createObjectStore('syncMeta', { keyPath: 'key' });
      }

      // Users store for local authentication
      if (!db.objectStoreNames.contains('users')) {
        const userStore = db.createObjectStore('users', { keyPath: 'username' });
        userStore.createIndex('by-profileType', 'profileType');
      }

      // Conversation buffers store for offline chat
      if (!db.objectStoreNames.contains('conversationBuffers')) {
        db.createObjectStore('conversationBuffers', { keyPath: 'mode' });
      }
    },
  });

  return dbInstance;
}

/**
 * Close the database connection
 */
export async function closeDB(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ============ Memory Operations ============

/**
 * Save a memory to local database
 */
export async function saveMemory(memory: Omit<LocalMemory, 'synced' | 'localModifiedAt'>): Promise<LocalMemory> {
  const db = await getDB();
  const now = new Date().toISOString();

  const localMemory: LocalMemory = {
    ...memory,
    synced: false,
    localModifiedAt: now,
  };

  await db.put('memories', localMemory);
  return localMemory;
}

/**
 * Get a memory by ID
 */
export async function getMemory(id: string): Promise<LocalMemory | undefined> {
  const db = await getDB();
  return db.get('memories', id);
}

/**
 * Get recent memories
 */
export async function getRecentMemories(limit = 50): Promise<LocalMemory[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('memories', 'by-timestamp');
  // Filter out deleted, get most recent
  return all
    .filter(m => !m.deleted)
    .slice(-limit)
    .reverse();
}

/**
 * Get memories by type
 */
export async function getMemoriesByType(type: string, limit = 100): Promise<LocalMemory[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('memories', 'by-type', type);
  return all
    .filter(m => !m.deleted)
    .slice(-limit)
    .reverse();
}

/**
 * Get all unsynced memories
 */
export async function getUnsyncedMemories(): Promise<LocalMemory[]> {
  const db = await getDB();
  return db.getAllFromIndex('memories', 'by-synced', false);
}

/**
 * Mark memories as synced
 */
export async function markMemoriesSynced(ids: string[], serverTimestamp: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('memories', 'readwrite');

  for (const id of ids) {
    const memory = await tx.store.get(id);
    if (memory) {
      memory.synced = true;
      memory.syncedAt = serverTimestamp;
      memory.serverModifiedAt = serverTimestamp;
      await tx.store.put(memory);
    }
  }

  await tx.done;
}

/**
 * Update a memory
 */
export async function updateMemory(id: string, updates: Partial<LocalMemory>): Promise<LocalMemory | undefined> {
  const db = await getDB();
  const existing = await db.get('memories', id);

  if (!existing) return undefined;

  const updated: LocalMemory = {
    ...existing,
    ...updates,
    synced: false,
    localModifiedAt: new Date().toISOString(),
  };

  await db.put('memories', updated);
  return updated;
}

/**
 * Soft-delete a memory
 */
export async function deleteMemory(id: string): Promise<void> {
  const db = await getDB();
  const existing = await db.get('memories', id);

  if (existing) {
    existing.deleted = true;
    existing.synced = false;
    existing.localModifiedAt = new Date().toISOString();
    await db.put('memories', existing);
  }
}

/**
 * Search memories by content
 */
export async function searchMemories(query: string, limit = 20): Promise<LocalMemory[]> {
  const db = await getDB();
  const all = await db.getAll('memories');
  const queryLower = query.toLowerCase();

  return all
    .filter(m => !m.deleted && m.content.toLowerCase().includes(queryLower))
    .slice(0, limit);
}

/**
 * Import memories from server (during sync)
 */
export async function importMemories(memories: LocalMemory[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('memories', 'readwrite');

  for (const memory of memories) {
    const existing = await tx.store.get(memory.id);

    if (!existing) {
      // New memory from server
      await tx.store.put({
        ...memory,
        synced: true,
        syncedAt: new Date().toISOString(),
      });
    } else if (existing.synced && memory.serverModifiedAt &&
               (!existing.serverModifiedAt || memory.serverModifiedAt > existing.serverModifiedAt)) {
      // Server has newer version and local hasn't been modified
      await tx.store.put({
        ...memory,
        synced: true,
        syncedAt: new Date().toISOString(),
      });
    }
    // If local has unsynced changes, keep local version (conflict)
  }

  await tx.done;
}

// ============ Persona Operations ============

/**
 * Get persona data by key
 */
export async function getPersona(key: string = 'core'): Promise<LocalPersona | undefined> {
  const db = await getDB();
  return db.get('persona', key);
}

/**
 * Get all persona data
 */
export async function getAllPersona(): Promise<LocalPersona[]> {
  const db = await getDB();
  return db.getAll('persona');
}

/**
 * Save persona data
 */
export async function savePersona(key: string, data: Record<string, any>): Promise<LocalPersona> {
  const db = await getDB();
  const now = new Date().toISOString();

  const persona: LocalPersona = {
    key,
    data,
    localModifiedAt: now,
  };

  await db.put('persona', persona);
  return persona;
}

/**
 * Import persona from server
 */
export async function importPersona(key: string, data: Record<string, any>, serverTimestamp: string): Promise<void> {
  const db = await getDB();
  const existing = await db.get('persona', key);

  // Only update if we don't have local changes or server is newer
  if (!existing || existing.syncedAt) {
    await db.put('persona', {
      key,
      data,
      syncedAt: serverTimestamp,
      localModifiedAt: serverTimestamp,
    });
  }
}

// ============ Task Operations ============

/**
 * Save a task
 */
export async function saveTask(task: Omit<LocalTask, 'synced'>): Promise<LocalTask> {
  const db = await getDB();

  const localTask: LocalTask = {
    ...task,
    synced: false,
  };

  await db.put('tasks', localTask);
  return localTask;
}

/**
 * Get all tasks by status
 */
export async function getTasksByStatus(status: LocalTask['status']): Promise<LocalTask[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('tasks', 'by-status', status);
  return all.filter(t => !t.deleted);
}

/**
 * Get all active tasks
 */
export async function getActiveTasks(): Promise<LocalTask[]> {
  const db = await getDB();
  const all = await db.getAll('tasks');
  return all.filter(t => !t.deleted && (t.status === 'pending' || t.status === 'active'));
}

/**
 * Update task status
 */
export async function updateTaskStatus(id: string, status: LocalTask['status']): Promise<LocalTask | undefined> {
  const db = await getDB();
  const existing = await db.get('tasks', id);

  if (!existing) return undefined;

  const updated: LocalTask = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    synced: false,
  };

  await db.put('tasks', updated);
  return updated;
}

// ============ Settings Operations ============

/**
 * Get a setting value
 */
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const db = await getDB();
  const setting = await db.get('settings', key);
  return setting?.value ?? defaultValue;
}

/**
 * Set a setting value
 */
export async function setSetting(key: string, value: any): Promise<void> {
  const db = await getDB();
  await db.put('settings', {
    key,
    value,
    updatedAt: new Date().toISOString(),
  });
}

// ============ Sync Metadata Operations ============

/**
 * Get last sync timestamp
 */
export async function getLastSyncTimestamp(): Promise<string | null> {
  const db = await getDB();
  const meta = await db.get('syncMeta', 'lastSync');
  return meta?.value ?? null;
}

/**
 * Set last sync timestamp
 */
export async function setLastSyncTimestamp(timestamp: string): Promise<void> {
  const db = await getDB();
  await db.put('syncMeta', {
    key: 'lastSync',
    value: timestamp,
    updatedAt: new Date().toISOString(),
  });
}

// ============ Utility Functions ============

/**
 * Get database statistics
 */
export async function getStats(): Promise<{
  memories: number;
  unsyncedMemories: number;
  tasks: number;
  personaKeys: number;
}> {
  const db = await getDB();

  const memories = await db.count('memories');
  const unsyncedMemories = await db.countFromIndex('memories', 'by-synced', false);
  const tasks = await db.count('tasks');
  const personaKeys = await db.count('persona');

  return {
    memories,
    unsyncedMemories,
    tasks,
    personaKeys,
  };
}

/**
 * Clear all local data (use with caution!)
 */
export async function clearAllData(): Promise<void> {
  const db = await getDB();

  const tx = db.transaction(['memories', 'persona', 'tasks', 'settings', 'syncMeta'], 'readwrite');

  await tx.objectStore('memories').clear();
  await tx.objectStore('persona').clear();
  await tx.objectStore('tasks').clear();
  await tx.objectStore('settings').clear();
  await tx.objectStore('syncMeta').clear();

  await tx.done;
}

/**
 * Export all data (for backup)
 */
export async function exportAllData(): Promise<{
  memories: LocalMemory[];
  persona: LocalPersona[];
  tasks: LocalTask[];
}> {
  const db = await getDB();

  return {
    memories: await db.getAll('memories'),
    persona: await db.getAll('persona'),
    tasks: await db.getAll('tasks'),
  };
}

// ============ User Authentication ============

/**
 * Hash a password using SHA-256 (for local validation only)
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Register a new local user
 */
export async function registerLocalUser(
  username: string,
  password: string,
  options: {
    displayName?: string;
    profileType: 'local' | 'server';
    profilePath?: string;
    encrypted?: boolean;
    encryptionType?: 'none' | 'aes256';
    serverUrl?: string;
  }
): Promise<LocalUser> {
  const db = await getDB();

  // Check if user already exists
  const existing = await db.get('users', username);
  if (existing) {
    throw new Error('Username already exists');
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  const user: LocalUser = {
    username,
    displayName: options.displayName || username,
    passwordHash,
    profileType: options.profileType,
    profilePath: options.profilePath,
    encrypted: options.encrypted || false,
    encryptionType: options.encryptionType || 'none',
    serverUrl: options.serverUrl,
    createdAt: now,
  };

  await db.put('users', user);
  return user;
}

/**
 * Validate local user credentials
 */
export async function validateLocalUser(
  username: string,
  password: string
): Promise<LocalUser | null> {
  const db = await getDB();
  const user = await db.get('users', username);

  if (!user) {
    return null;
  }

  const passwordHash = await hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    return null;
  }

  // Update last login time
  user.lastLoginAt = new Date().toISOString();
  await db.put('users', user);

  return user;
}

/**
 * Get a local user by username (without password validation)
 */
export async function getLocalUser(username: string): Promise<LocalUser | undefined> {
  const db = await getDB();
  return db.get('users', username);
}

/**
 * Get all registered local users
 */
export async function getAllLocalUsers(): Promise<LocalUser[]> {
  const db = await getDB();
  return db.getAll('users');
}

/**
 * Check if any local users exist
 */
export async function hasLocalUsers(): Promise<boolean> {
  const db = await getDB();
  const users = await db.getAll('users');
  return users.length > 0;
}

/**
 * Update local user (for syncing server data, changing password, etc.)
 */
export async function updateLocalUser(
  username: string,
  updates: Partial<Omit<LocalUser, 'username' | 'createdAt'>>
): Promise<LocalUser | null> {
  const db = await getDB();
  const user = await db.get('users', username);

  if (!user) {
    return null;
  }

  const updatedUser: LocalUser = {
    ...user,
    ...updates,
  };

  // If password is being updated, hash it
  if (updates.passwordHash && updates.passwordHash !== user.passwordHash) {
    // Assume it's a plain password that needs hashing
    updatedUser.passwordHash = await hashPassword(updates.passwordHash);
  }

  await db.put('users', updatedUser);
  return updatedUser;
}

/**
 * Delete a local user
 */
export async function deleteLocalUser(username: string): Promise<boolean> {
  const db = await getDB();
  const user = await db.get('users', username);

  if (!user) {
    return false;
  }

  await db.delete('users', username);
  return true;
}

/**
 * Cache a server user locally (after successful server login)
 */
export async function cacheServerUser(
  username: string,
  password: string,
  serverUrl: string,
  displayName?: string
): Promise<LocalUser> {
  const db = await getDB();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  // Check if user already exists
  const existing = await db.get('users', username);

  const user: LocalUser = {
    username,
    displayName: displayName || existing?.displayName || username,
    passwordHash,
    profileType: 'server',
    serverUrl,
    encrypted: false,
    createdAt: existing?.createdAt || now,
    lastLoginAt: now,
    syncedAt: now,
    pendingVerification: false,  // Verified since we just logged in successfully
    verificationFailed: false,
  };

  await db.put('users', user);
  return user;
}

/**
 * Create a pending-verification user for offline login
 * This allows login when server is offline, with verification happening later
 */
export async function createPendingUser(
  username: string,
  password: string,
  serverUrl: string,
  displayName?: string
): Promise<LocalUser> {
  const db = await getDB();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  // Check if user already exists
  const existing = await db.get('users', username);
  if (existing && !existing.pendingVerification) {
    // Already have a verified user - don't overwrite
    throw new Error('User already exists and is verified');
  }

  const user: LocalUser = {
    username,
    displayName: displayName || username,
    passwordHash,
    profileType: 'server',
    serverUrl,
    encrypted: false,
    createdAt: existing?.createdAt || now,
    lastLoginAt: now,
    pendingVerification: true,  // Needs server verification
    verificationFailed: false,
  };

  await db.put('users', user);
  return user;
}

/**
 * Mark a pending user as verified (called after successful server login)
 */
export async function markUserVerified(username: string): Promise<LocalUser | null> {
  const db = await getDB();
  const user = await db.get('users', username);

  if (!user) {
    return null;
  }

  const updatedUser: LocalUser = {
    ...user,
    pendingVerification: false,
    verificationFailed: false,
    syncedAt: new Date().toISOString(),
  };

  await db.put('users', updatedUser);
  return updatedUser;
}

/**
 * Mark a pending user's verification as failed
 */
export async function markVerificationFailed(username: string): Promise<LocalUser | null> {
  const db = await getDB();
  const user = await db.get('users', username);

  if (!user) {
    return null;
  }

  const updatedUser: LocalUser = {
    ...user,
    verificationFailed: true,
  };

  await db.put('users', updatedUser);
  return updatedUser;
}

// ============ Conversation Buffer Operations ============

/**
 * Get conversation buffer (local-first for offline support)
 */
export async function getConversationBuffer(mode: BufferMode): Promise<ConversationBuffer> {
  const db = await getDB();
  const buffer = await db.get('conversationBuffers', mode);

  if (!buffer) {
    return {
      mode,
      messages: [],
      lastUpdated: new Date().toISOString(),
      messageLimit: DEFAULT_MESSAGE_LIMIT,
    };
  }

  return buffer;
}

/**
 * Append a message to the conversation buffer
 */
export async function appendToBuffer(
  mode: BufferMode,
  message: Omit<BufferMessage, 'timestamp'> & { timestamp?: number }
): Promise<ConversationBuffer> {
  const db = await getDB();
  let buffer = await db.get('conversationBuffers', mode);

  if (!buffer) {
    buffer = {
      mode,
      messages: [],
      lastUpdated: new Date().toISOString(),
      messageLimit: DEFAULT_MESSAGE_LIMIT,
    };
  }

  // Add timestamp if not present
  const newMessage: BufferMessage = {
    ...message,
    timestamp: message.timestamp || Date.now(),
  };

  buffer.messages.push(newMessage);

  // Auto-prune if over limit
  if (buffer.messages.length > buffer.messageLimit) {
    const excess = buffer.messages.length - buffer.messageLimit;
    buffer.messages = buffer.messages.slice(excess);
  }

  buffer.lastUpdated = new Date().toISOString();
  await db.put('conversationBuffers', buffer);

  return buffer;
}

/**
 * Clear conversation buffer
 */
export async function clearBuffer(mode: BufferMode): Promise<void> {
  const db = await getDB();
  await db.delete('conversationBuffers', mode);
}

/**
 * Replace entire buffer (for syncing from server)
 */
export async function replaceBuffer(buffer: ConversationBuffer): Promise<void> {
  const db = await getDB();
  await db.put('conversationBuffers', buffer);
}

/**
 * Get all buffers (for syncing)
 */
export async function getAllBuffers(): Promise<ConversationBuffer[]> {
  const db = await getDB();
  return db.getAll('conversationBuffers');
}

/**
 * Get buffer messages filtered for display (excludes system messages)
 */
export async function getDisplayMessages(mode: BufferMode): Promise<BufferMessage[]> {
  const buffer = await getConversationBuffer(mode);
  return buffer.messages.filter(
    msg => msg.role !== 'system' && !msg.meta?.summaryMarker
  );
}
