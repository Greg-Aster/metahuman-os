/**
 * Conversation Buffer Locking System
 * 
 * Provides atomic operations on conversation buffers to prevent race conditions
 * when multiple windows/tabs are accessing the same user's conversation data.
 */

import fs from 'fs';
import path from 'path';
import { systemPaths } from './path-builder.js';
import { generateUUID } from './uuid.js';
import { audit } from './audit.js';

/**
 * Buffer lock information
 */
export interface BufferLock {
  lockId: string;           // Unique lock identifier
  username: string;         // User whose buffer is locked
  mode: 'conversation' | 'inner'; // Buffer mode being locked
  windowId?: string;        // Window that owns the lock
  acquiredAt: string;       // When lock was acquired
  expiresAt: string;        // When lock expires
  operation: string;        // Description of operation (for debugging)
}

/**
 * Lock registry storage
 */
interface LockStore {
  locks: BufferLock[];
  version: number;
}

// Lock timeout (30 seconds - should be enough for any buffer operation)
const LOCK_TIMEOUT = 30 * 1000;

// Maximum lock wait time (10 seconds)
const MAX_LOCK_WAIT = 10 * 1000;

/**
 * Get the path to the buffer locks file
 */
function getBufferLocksFilePath(): string {
  return path.join(systemPaths.run, 'buffer-locks.json');
}

/**
 * Load buffer locks from file
 */
function loadLocks(): LockStore {
  if (!fs.existsSync(getBufferLocksFilePath())) {
    return { locks: [], version: 1 };
  }

  try {
    const raw = fs.readFileSync(getBufferLocksFilePath(), 'utf-8');
    return JSON.parse(raw) as LockStore;
  } catch (error) {
    console.error('[buffer-locks] Failed to load locks:', error);
    return { locks: [], version: 1 };
  }
}

/**
 * Save buffer locks to file
 */
function saveLocks(store: LockStore): void {
  try {
    const dir = path.dirname(getBufferLocksFilePath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getBufferLocksFilePath(), JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    console.error('[buffer-locks] Failed to save locks:', error);
    throw error;
  }
}

/**
 * Clean up expired locks
 */
function cleanupExpiredLocks(): void {
  const store = loadLocks();
  const now = new Date();
  const before = store.locks.length;

  store.locks = store.locks.filter(lock => {
    const expiresAt = new Date(lock.expiresAt);
    return expiresAt > now;
  });

  if (store.locks.length < before) {
    saveLocks(store);
  }
}

/**
 * Check if a buffer is currently locked
 */
function isBufferLocked(username: string, mode: 'conversation' | 'inner'): BufferLock | null {
  cleanupExpiredLocks();
  const store = loadLocks();
  
  return store.locks.find(lock => 
    lock.username === username && 
    lock.mode === mode &&
    new Date(lock.expiresAt) > new Date()
  ) || null;
}

/**
 * Acquire a lock on a conversation buffer
 */
export function acquireBufferLock(
  username: string,
  mode: 'conversation' | 'inner',
  operation: string,
  windowId?: string
): BufferLock | null {
  cleanupExpiredLocks();
  
  const existing = isBufferLocked(username, mode);
  if (existing) {
    console.warn(`[buffer-locks] Buffer ${username}:${mode} already locked by ${existing.windowId || 'unknown'}`);
    return null;
  }

  const store = loadLocks();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TIMEOUT);

  const lock: BufferLock = {
    lockId: generateUUID(),
    username,
    mode,
    windowId,
    acquiredAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    operation,
  };

  store.locks.push(lock);
  saveLocks(store);

  audit({
    level: 'info',
    category: 'system',
    event: 'buffer_lock_acquired',
    details: {
      lockId: lock.lockId,
      username,
      mode,
      operation,
      windowId,
    },
    actor: username,
  });

  return lock;
}

/**
 * Release a buffer lock
 */
export function releaseBufferLock(lockId: string): boolean {
  const store = loadLocks();
  const lock = store.locks.find(l => l.lockId === lockId);

  if (!lock) {
    return false;
  }

  store.locks = store.locks.filter(l => l.lockId !== lockId);
  saveLocks(store);

  audit({
    level: 'info',
    category: 'system',
    event: 'buffer_lock_released',
    details: {
      lockId,
      username: lock.username,
      mode: lock.mode,
      operation: lock.operation,
    },
    actor: lock.username,
  });

  return true;
}

/**
 * Wait for a buffer lock to become available and acquire it
 */
export async function waitForBufferLock(
  username: string,
  mode: 'conversation' | 'inner',
  operation: string,
  windowId?: string,
  maxWait: number = MAX_LOCK_WAIT
): Promise<BufferLock | null> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWait) {
    const lock = acquireBufferLock(username, mode, operation, windowId);
    if (lock) {
      return lock;
    }

    // Wait 100ms before retrying
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.warn(`[buffer-locks] Timeout waiting for lock on ${username}:${mode}`);
  return null;
}

/**
 * Execute an operation with a buffer lock (auto-acquire and release)
 */
export async function withBufferLock<T>(
  username: string,
  mode: 'conversation' | 'inner',
  operation: string,
  fn: () => Promise<T> | T,
  windowId?: string
): Promise<T | null> {
  const lock = await waitForBufferLock(username, mode, operation, windowId);
  if (!lock) {
    console.error(`[buffer-locks] Failed to acquire lock for ${username}:${mode}`);
    return null;
  }

  try {
    return await fn();
  } finally {
    releaseBufferLock(lock.lockId);
  }
}

/**
 * Force release all locks for a user (emergency cleanup)
 */
export function forceReleaseUserLocks(username: string): number {
  const store = loadLocks();
  const userLocks = store.locks.filter(l => l.username === username);
  const count = userLocks.length;

  store.locks = store.locks.filter(l => l.username !== username);
  saveLocks(store);

  if (count > 0) {
    audit({
      level: 'warn',
      category: 'system',
      event: 'buffer_locks_force_released',
      details: { username, count },
      actor: 'system',
    });
  }

  return count;
}

/**
 * List all active locks (for debugging)
 */
export function listActiveLocks(): BufferLock[] {
  cleanupExpiredLocks();
  return loadLocks().locks;
}

/**
 * Get lock statistics
 */
export function getLockStats(): {
  total: number;
  byUser: Record<string, number>;
  byMode: Record<string, number>;
  oldestLock: string | null;
} {
  const locks = listActiveLocks();

  const byUser: Record<string, number> = {};
  const byMode: Record<string, number> = {};

  for (const lock of locks) {
    byUser[lock.username] = (byUser[lock.username] || 0) + 1;
    byMode[lock.mode] = (byMode[lock.mode] || 0) + 1;
  }

  const oldestLock = locks.length > 0 
    ? locks.sort((a, b) => new Date(a.acquiredAt).getTime() - new Date(b.acquiredAt).getTime())[0].acquiredAt
    : null;

  return {
    total: locks.length,
    byUser,
    byMode,
    oldestLock,
  };
}