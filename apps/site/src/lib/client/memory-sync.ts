/**
 * Memory Sync Protocol
 *
 * Enables bi-directional sync between offline/local storage and the server.
 * Key features:
 * - Local-first: All changes saved locally first
 * - Offline queue: Changes queued when server unavailable
 * - Conflict resolution: Server wins by default, with merge support
 * - Incremental sync: Only syncs changes since last sync
 *
 * Sync flow:
 * 1. User creates memory → Saved locally with syncStatus: 'pending'
 * 2. Background sync checks for pending items
 * 3. When online, push pending to server
 * 4. Pull server changes since lastSyncTimestamp
 * 5. Apply server changes locally (with conflict resolution)
 */

import { writable, derived, type Readable, type Writable } from 'svelte/store';
import { isCapacitorNative } from './api-config';
import { healthStatus } from './server-health';

// ============================================================================
// Types
// ============================================================================

export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';

export interface SyncableMemory {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  metadata: Record<string, any>;
  syncStatus: SyncStatus;
  localModifiedAt: string;
  serverModifiedAt?: string;
  syncError?: string;
}

export interface SyncQueueItem {
  id: string;
  action: 'create' | 'update' | 'delete';
  memory: SyncableMemory;
  queuedAt: string;
  attempts: number;
  lastAttempt?: string;
  error?: string;
}

export interface SyncState {
  lastSyncTimestamp: string | null;
  pendingCount: number;
  conflictCount: number;
  isSyncing: boolean;
  lastSyncError?: string;
  lastSuccessfulSync?: string;
}

export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

export interface ConflictResolution {
  memoryId: string;
  resolution: 'keep-local' | 'keep-server' | 'merge';
  mergedContent?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SYNC_INTERVAL_MS = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;
const STORAGE_KEY_QUEUE = 'mh_sync_queue';
const STORAGE_KEY_STATE = 'mh_sync_state';
const STORAGE_KEY_LOCAL_MEMORIES = 'mh_local_memories';

// ============================================================================
// Stores
// ============================================================================

export const syncState: Writable<SyncState> = writable({
  lastSyncTimestamp: null,
  pendingCount: 0,
  conflictCount: 0,
  isSyncing: false,
});

export const syncQueue: Writable<SyncQueueItem[]> = writable([]);

export const localMemories: Writable<Map<string, SyncableMemory>> = writable(new Map());

// Derived stores
export const hasPendingChanges: Readable<boolean> = derived(
  syncState,
  $state => $state.pendingCount > 0
);

export const hasConflicts: Readable<boolean> = derived(
  syncState,
  $state => $state.conflictCount > 0
);

// ============================================================================
// Local Storage Operations
// ============================================================================

async function loadFromStorage<T>(key: string, defaultValue: T): Promise<T> {
  if (!isCapacitorNative()) {
    // Use localStorage for web
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key });
    return value ? JSON.parse(value) : defaultValue;
  } catch {
    return defaultValue;
  }
}

async function saveToStorage(key: string, value: any): Promise<void> {
  const json = JSON.stringify(value);

  if (!isCapacitorNative()) {
    localStorage.setItem(key, json);
    return;
  }

  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value: json });
  } catch (e) {
    console.error('[memory-sync] Failed to save to storage:', e);
  }
}

// ============================================================================
// Queue Management
// ============================================================================

export async function addToQueue(action: SyncQueueItem['action'], memory: SyncableMemory): Promise<void> {
  let queue: SyncQueueItem[] = [];
  syncQueue.subscribe(q => queue = q)();

  // Check if already in queue (update existing entry)
  const existingIndex = queue.findIndex(item => item.id === memory.id);

  const queueItem: SyncQueueItem = {
    id: memory.id,
    action,
    memory,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };

  if (existingIndex >= 0) {
    // Merge actions: create + update = create, create + delete = remove from queue
    const existing = queue[existingIndex];
    if (existing.action === 'create' && action === 'delete') {
      // Never synced, just remove from queue
      queue = queue.filter(item => item.id !== memory.id);
    } else if (existing.action === 'create' && action === 'update') {
      // Keep as create with updated content
      queue[existingIndex] = { ...queueItem, action: 'create' };
    } else {
      queue[existingIndex] = queueItem;
    }
  } else {
    queue.push(queueItem);
  }

  syncQueue.set(queue);
  await saveToStorage(STORAGE_KEY_QUEUE, queue);

  // Update pending count
  syncState.update(state => ({
    ...state,
    pendingCount: queue.length,
  }));
}

export async function removeFromQueue(id: string): Promise<void> {
  let queue: SyncQueueItem[] = [];
  syncQueue.subscribe(q => queue = q)();

  queue = queue.filter(item => item.id !== id);
  syncQueue.set(queue);
  await saveToStorage(STORAGE_KEY_QUEUE, queue);

  syncState.update(state => ({
    ...state,
    pendingCount: queue.length,
  }));
}

// ============================================================================
// Local Memory Operations
// ============================================================================

export async function saveMemoryLocally(memory: Omit<SyncableMemory, 'syncStatus' | 'localModifiedAt'>): Promise<SyncableMemory> {
  const fullMemory: SyncableMemory = {
    ...memory,
    syncStatus: 'pending',
    localModifiedAt: new Date().toISOString(),
  };

  let memories: Map<string, SyncableMemory> = new Map();
  localMemories.subscribe(m => memories = m)();

  memories.set(memory.id, fullMemory);
  localMemories.set(memories);

  // Save to persistent storage
  await saveToStorage(STORAGE_KEY_LOCAL_MEMORIES, Array.from(memories.entries()));

  // Add to sync queue
  await addToQueue('create', fullMemory);

  return fullMemory;
}

export async function updateMemoryLocally(id: string, updates: Partial<SyncableMemory>): Promise<SyncableMemory | null> {
  let memories: Map<string, SyncableMemory> = new Map();
  localMemories.subscribe(m => memories = m)();

  const existing = memories.get(id);
  if (!existing) return null;

  const updated: SyncableMemory = {
    ...existing,
    ...updates,
    syncStatus: 'pending',
    localModifiedAt: new Date().toISOString(),
  };

  memories.set(id, updated);
  localMemories.set(memories);

  await saveToStorage(STORAGE_KEY_LOCAL_MEMORIES, Array.from(memories.entries()));
  await addToQueue('update', updated);

  return updated;
}

export async function deleteMemoryLocally(id: string): Promise<boolean> {
  let memories: Map<string, SyncableMemory> = new Map();
  localMemories.subscribe(m => memories = m)();

  const existing = memories.get(id);
  if (!existing) return false;

  // Mark for deletion but keep in map until synced
  const deleted: SyncableMemory = {
    ...existing,
    syncStatus: 'pending',
    localModifiedAt: new Date().toISOString(),
  };

  memories.set(id, deleted);
  localMemories.set(memories);

  await saveToStorage(STORAGE_KEY_LOCAL_MEMORIES, Array.from(memories.entries()));
  await addToQueue('delete', deleted);

  return true;
}

export async function getLocalMemory(id: string): Promise<SyncableMemory | null> {
  let memories: Map<string, SyncableMemory> = new Map();
  localMemories.subscribe(m => memories = m)();
  return memories.get(id) || null;
}

export async function getLocalMemories(filter?: { type?: string; since?: string }): Promise<SyncableMemory[]> {
  let memories: Map<string, SyncableMemory> = new Map();
  localMemories.subscribe(m => memories = m)();

  let result = Array.from(memories.values());

  if (filter?.type) {
    result = result.filter(m => m.type === filter.type);
  }

  if (filter?.since) {
    result = result.filter(m => m.timestamp >= filter.since!);
  }

  return result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ============================================================================
// Sync Operations
// ============================================================================

async function pushToServer(item: SyncQueueItem): Promise<{ success: boolean; error?: string }> {
  try {
    const { apiFetch } = await import('./api-config');

    let endpoint: string;
    let method: string;
    let body: any;

    switch (item.action) {
      case 'create':
        endpoint = '/api/memory/sync/push';
        method = 'POST';
        body = { memory: item.memory };
        break;
      case 'update':
        endpoint = '/api/memory/sync/push';
        method = 'PUT';
        body = { memory: item.memory };
        break;
      case 'delete':
        endpoint = `/api/memory/sync/${item.id}`;
        method = 'DELETE';
        body = undefined;
        break;
    }

    const response = await apiFetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Server returned ${response.status}: ${error}` };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

async function pullFromServer(since: string | null): Promise<{ memories: SyncableMemory[]; error?: string }> {
  try {
    const { apiFetch } = await import('./api-config');

    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await apiFetch(`/api/memory/sync/pull${params}`);

    if (!response.ok) {
      return { memories: [], error: `Server returned ${response.status}` };
    }

    const data = await response.json();
    return { memories: data.memories || [] };
  } catch (e) {
    return { memories: [], error: e instanceof Error ? e.message : 'Network error' };
  }
}

function detectConflict(local: SyncableMemory, server: SyncableMemory): boolean {
  // Conflict if both modified after last sync and content differs
  if (local.serverModifiedAt && server.timestamp > local.serverModifiedAt) {
    if (local.localModifiedAt > local.serverModifiedAt) {
      // Both modified since last known server state
      return local.content !== server.content;
    }
  }
  return false;
}

async function resolveConflicts(
  local: SyncableMemory,
  server: SyncableMemory,
  strategy: 'server-wins' | 'local-wins' | 'manual' = 'server-wins'
): Promise<SyncableMemory> {
  switch (strategy) {
    case 'server-wins':
      return {
        ...server,
        syncStatus: 'synced',
        localModifiedAt: server.timestamp,
        serverModifiedAt: server.timestamp,
      };

    case 'local-wins':
      // Keep local, mark for re-push
      return {
        ...local,
        syncStatus: 'pending',
      };

    case 'manual':
      // Mark as conflict for user resolution
      return {
        ...local,
        syncStatus: 'conflict',
        serverModifiedAt: server.timestamp,
      };
  }
}

export async function performSync(): Promise<SyncResult> {
  // Check if already syncing
  let state: SyncState = { lastSyncTimestamp: null, pendingCount: 0, conflictCount: 0, isSyncing: false };
  syncState.subscribe(s => state = s)();

  if (state.isSyncing) {
    return { success: false, pushed: 0, pulled: 0, conflicts: 0, errors: ['Sync already in progress'] };
  }

  // Check connectivity
  let isConnected = false;
  healthStatus.subscribe(h => isConnected = h.connected)();

  if (!isConnected) {
    return { success: false, pushed: 0, pulled: 0, conflicts: 0, errors: ['Server not connected'] };
  }

  syncState.update(s => ({ ...s, isSyncing: true }));

  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    errors: [],
  };

  try {
    // Phase 1: Push pending changes
    let queue: SyncQueueItem[] = [];
    syncQueue.subscribe(q => queue = q)();

    for (const item of queue) {
      if (item.attempts >= MAX_RETRY_ATTEMPTS) {
        result.errors.push(`Max retries exceeded for ${item.id}`);
        continue;
      }

      const pushResult = await pushToServer(item);

      if (pushResult.success) {
        await removeFromQueue(item.id);

        // Update local memory sync status
        let memories: Map<string, SyncableMemory> = new Map();
        localMemories.subscribe(m => memories = m)();

        const memory = memories.get(item.id);
        if (memory && item.action !== 'delete') {
          memories.set(item.id, {
            ...memory,
            syncStatus: 'synced',
            serverModifiedAt: new Date().toISOString(),
          });
          localMemories.set(memories);
        } else if (item.action === 'delete') {
          memories.delete(item.id);
          localMemories.set(memories);
        }

        result.pushed++;
      } else {
        // Update retry count
        let updatedQueue: SyncQueueItem[] = [];
        syncQueue.subscribe(q => updatedQueue = q)();

        const idx = updatedQueue.findIndex(q => q.id === item.id);
        if (idx >= 0) {
          updatedQueue[idx] = {
            ...item,
            attempts: item.attempts + 1,
            lastAttempt: new Date().toISOString(),
            error: pushResult.error,
          };
          syncQueue.set(updatedQueue);
          await saveToStorage(STORAGE_KEY_QUEUE, updatedQueue);
        }

        result.errors.push(`Failed to push ${item.id}: ${pushResult.error}`);
      }
    }

    // Phase 2: Pull server changes
    const pullResult = await pullFromServer(state.lastSyncTimestamp);

    if (pullResult.error) {
      result.errors.push(`Failed to pull: ${pullResult.error}`);
    } else {
      let memories: Map<string, SyncableMemory> = new Map();
      localMemories.subscribe(m => memories = m)();

      for (const serverMemory of pullResult.memories) {
        const localMemory = memories.get(serverMemory.id);

        if (localMemory) {
          // Check for conflict
          if (detectConflict(localMemory, serverMemory)) {
            const resolved = await resolveConflicts(localMemory, serverMemory, 'server-wins');
            memories.set(serverMemory.id, resolved);

            if (resolved.syncStatus === 'conflict') {
              result.conflicts++;
            }
          } else {
            // No conflict, apply server version
            memories.set(serverMemory.id, {
              ...serverMemory,
              syncStatus: 'synced',
              localModifiedAt: serverMemory.timestamp,
              serverModifiedAt: serverMemory.timestamp,
            });
          }
        } else {
          // New memory from server
          memories.set(serverMemory.id, {
            ...serverMemory,
            syncStatus: 'synced',
            localModifiedAt: serverMemory.timestamp,
            serverModifiedAt: serverMemory.timestamp,
          });
        }

        result.pulled++;
      }

      localMemories.set(memories);
      await saveToStorage(STORAGE_KEY_LOCAL_MEMORIES, Array.from(memories.entries()));
    }

    // Update sync state
    const now = new Date().toISOString();
    syncState.update(s => ({
      ...s,
      lastSyncTimestamp: now,
      lastSuccessfulSync: result.errors.length === 0 ? now : s.lastSuccessfulSync,
      conflictCount: result.conflicts,
      isSyncing: false,
    }));

    await saveToStorage(STORAGE_KEY_STATE, {
      lastSyncTimestamp: now,
      lastSuccessfulSync: result.errors.length === 0 ? now : state.lastSuccessfulSync,
    });

    result.success = result.errors.length === 0;
  } catch (e) {
    result.success = false;
    result.errors.push(e instanceof Error ? e.message : 'Unknown sync error');

    syncState.update(s => ({
      ...s,
      isSyncing: false,
      lastSyncError: result.errors.join('; '),
    }));
  }

  return result;
}

// ============================================================================
// Conflict Resolution UI Support
// ============================================================================

export async function getConflicts(): Promise<SyncableMemory[]> {
  let memories: Map<string, SyncableMemory> = new Map();
  localMemories.subscribe(m => memories = m)();

  return Array.from(memories.values()).filter(m => m.syncStatus === 'conflict');
}

export async function resolveConflict(resolution: ConflictResolution): Promise<boolean> {
  let memories: Map<string, SyncableMemory> = new Map();
  localMemories.subscribe(m => memories = m)();

  const memory = memories.get(resolution.memoryId);
  if (!memory || memory.syncStatus !== 'conflict') {
    return false;
  }

  switch (resolution.resolution) {
    case 'keep-local':
      // Re-queue for push
      memories.set(resolution.memoryId, {
        ...memory,
        syncStatus: 'pending',
      });
      await addToQueue('update', memories.get(resolution.memoryId)!);
      break;

    case 'keep-server':
      // Mark as synced (server version already applied)
      memories.set(resolution.memoryId, {
        ...memory,
        syncStatus: 'synced',
      });
      break;

    case 'merge':
      if (resolution.mergedContent) {
        memories.set(resolution.memoryId, {
          ...memory,
          content: resolution.mergedContent,
          syncStatus: 'pending',
          localModifiedAt: new Date().toISOString(),
        });
        await addToQueue('update', memories.get(resolution.memoryId)!);
      }
      break;
  }

  localMemories.set(memories);
  await saveToStorage(STORAGE_KEY_LOCAL_MEMORIES, Array.from(memories.entries()));

  // Update conflict count
  const remainingConflicts = Array.from(memories.values()).filter(m => m.syncStatus === 'conflict').length;
  syncState.update(s => ({ ...s, conflictCount: remainingConflicts }));

  return true;
}

// ============================================================================
// Initialization & Background Sync
// ============================================================================

let syncInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;

export async function initMemorySync(): Promise<void> {
  if (initialized) return;

  // Load persisted state
  const savedState = await loadFromStorage<Partial<SyncState>>(STORAGE_KEY_STATE, {});
  syncState.update(s => ({ ...s, ...savedState }));

  // Load queue
  const savedQueue = await loadFromStorage<SyncQueueItem[]>(STORAGE_KEY_QUEUE, []);
  syncQueue.set(savedQueue);

  // Load local memories
  const savedMemories = await loadFromStorage<[string, SyncableMemory][]>(STORAGE_KEY_LOCAL_MEMORIES, []);
  localMemories.set(new Map(savedMemories));

  // Update pending count
  syncState.update(s => ({
    ...s,
    pendingCount: savedQueue.length,
    conflictCount: savedMemories.filter(([_, m]) => m.syncStatus === 'conflict').length,
  }));

  // Start background sync
  startBackgroundSync();

  // Listen for online/offline events
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      console.log('[memory-sync] Online - triggering sync');
      performSync();
    });
  }

  initialized = true;
}

export function startBackgroundSync(): void {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    let isConnected = false;
    healthStatus.subscribe(h => isConnected = h.connected)();

    let pendingCount = 0;
    syncState.subscribe(s => pendingCount = s.pendingCount)();

    // Only sync if connected and have pending changes
    if (isConnected && pendingCount > 0) {
      await performSync();
    }
  }, SYNC_INTERVAL_MS);
}

export function stopBackgroundSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

export async function forceSync(): Promise<SyncResult> {
  return performSync();
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getSyncStatusIcon(status: SyncStatus): string {
  switch (status) {
    case 'synced': return '✓';
    case 'pending': return '↻';
    case 'conflict': return '⚠';
    case 'error': return '✗';
  }
}

export function getSyncStatusColor(status: SyncStatus): string {
  switch (status) {
    case 'synced': return '#22c55e';
    case 'pending': return '#f59e0b';
    case 'conflict': return '#ef4444';
    case 'error': return '#dc2626';
  }
}

export function getSyncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case 'synced': return 'Synced';
    case 'pending': return 'Pending sync';
    case 'conflict': return 'Conflict';
    case 'error': return 'Sync error';
  }
}
