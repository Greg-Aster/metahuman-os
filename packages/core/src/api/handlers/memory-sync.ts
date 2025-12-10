/**
 * Memory Sync API Handlers
 *
 * Push/pull memories for mobile/offline sync.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { getProfilePaths } from '../../paths.js';

// Dynamic import for audit
let audit: typeof import('../../audit.js').audit | null = null;

async function ensureAudit(): Promise<void> {
  if (!audit) {
    const module = await import('../../audit.js');
    audit = module.audit;
  }
}

interface SyncMemory {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  metadata: Record<string, any>;
  syncStatus?: string;
  localModifiedAt?: string;
  serverModifiedAt?: string;
}

/**
 * GET /api/memory/sync/pull - Pull memories since timestamp
 */
export async function handleMemorySyncPull(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    await ensureAudit();

    if (req.user.role === 'anonymous') {
      return { status: 401, error: 'Authentication required' };
    }

    const profilePaths = getProfilePaths(req.user.username);
    const { query } = req;
    const since = query?.since;
    const limit = parseInt(query?.limit || '100', 10);
    const memoryType = query?.type;

    const sinceDate = since ? new Date(since) : new Date(0);
    const memories: SyncMemory[] = [];

    const episodicDir = profilePaths.episodic;

    if (!existsSync(episodicDir)) {
      return successResponse({
        memories: [],
        serverTimestamp: new Date().toISOString(),
        hasMore: false,
      });
    }

    // Recursive scan for memory files
    const scanDir = (dir: string): void => {
      if (!existsSync(dir)) return;

      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const memory = JSON.parse(content);

            const stats = statSync(fullPath);
            const modifiedAt = new Date(memory.metadata?.syncedAt || stats.mtime);

            if (modifiedAt > sinceDate) {
              if (memoryType && memory.type !== memoryType) {
                return;
              }

              memories.push({
                id: memory.id || path.basename(fullPath, '.json'),
                type: memory.type || 'unknown',
                content: memory.content || '',
                timestamp: memory.timestamp || stats.mtime.toISOString(),
                metadata: memory.metadata || {},
              });
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    };

    scanDir(episodicDir);

    // Sort by timestamp (newest first)
    memories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit
    const hasMore = memories.length > limit;
    const limitedMemories = memories.slice(0, limit);

    if (audit) {
      audit({
        event: 'memory_sync_pull',
        category: 'data_change',
        level: 'info',
        actor: req.user.username,
        details: {
          since,
          count: limitedMemories.length,
          hasMore,
        },
      });
    }

    return successResponse({
      memories: limitedMemories,
      serverTimestamp: new Date().toISOString(),
      hasMore,
    });
  } catch (error) {
    console.error('[memory-sync] Pull failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/memory/sync/push - Create new memory from sync
 */
export async function handleMemorySyncPushCreate(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    await ensureAudit();

    if (req.user.role === 'anonymous') {
      return { status: 401, error: 'Authentication required' };
    }

    const profilePaths = getProfilePaths(req.user.username);
    const { memory } = req.body || {};

    if (!memory || !memory.id || !memory.type || !memory.content) {
      return { status: 400, error: 'Invalid memory data' };
    }

    // Determine storage path based on memory type
    let storagePath: string;
    const timestamp = new Date(memory.timestamp);
    const year = timestamp.getFullYear().toString();

    switch (memory.type) {
      case 'episodic':
      case 'observation':
      case 'conversation': {
        const yearDir = path.join(profilePaths.episodic, year);
        if (!existsSync(yearDir)) {
          mkdirSync(yearDir, { recursive: true });
        }
        const dateStr = timestamp.toISOString().slice(0, 10);
        storagePath = path.join(yearDir, `${dateStr}-${memory.id}.json`);
        break;
      }

      case 'inner_dialogue':
      case 'reflection': {
        const reflectionDir = path.join(profilePaths.episodic, year);
        if (!existsSync(reflectionDir)) {
          mkdirSync(reflectionDir, { recursive: true });
        }
        storagePath = path.join(reflectionDir, `${memory.id}.json`);
        break;
      }

      default:
        storagePath = path.join(profilePaths.episodic, year, `${memory.id}.json`);
        const dir = path.dirname(storagePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
    }

    // Prepare memory for storage
    const serverMemory = {
      id: memory.id,
      type: memory.type,
      content: memory.content,
      timestamp: memory.timestamp,
      metadata: {
        ...memory.metadata,
        syncedAt: new Date().toISOString(),
        syncSource: 'mobile',
      },
    };

    // Check if file already exists (conflict detection)
    if (existsSync(storagePath)) {
      return {
        status: 409,
        error: 'Memory already exists',
        data: {
          code: 'CONFLICT',
          existingTimestamp: JSON.parse(readFileSync(storagePath, 'utf-8')).timestamp,
        },
      };
    }

    // Save memory
    writeFileSync(storagePath, JSON.stringify(serverMemory, null, 2));

    if (audit) {
      audit({
        event: 'memory_sync_push',
        category: 'data_change',
        level: 'info',
        actor: req.user.username,
        details: {
          memoryId: memory.id,
          type: memory.type,
          action: 'create',
          path: storagePath,
        },
      });
    }

    return {
      status: 201,
      data: {
        success: true,
        serverTimestamp: serverMemory.metadata.syncedAt,
      },
    };
  } catch (error) {
    console.error('[memory-sync] Push create failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/memory/sync/push - Update existing memory from sync
 */
export async function handleMemorySyncPushUpdate(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    await ensureAudit();

    if (req.user.role === 'anonymous') {
      return { status: 401, error: 'Authentication required' };
    }

    const profilePaths = getProfilePaths(req.user.username);
    const { memory } = req.body || {};

    if (!memory || !memory.id) {
      return { status: 400, error: 'Invalid memory data' };
    }

    // Find existing memory file
    const episodicDir = profilePaths.episodic;

    const findFile = (dir: string): string | null => {
      if (!existsSync(dir)) return null;

      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findFile(fullPath);
          if (found) return found;
        } else if (entry.name.includes(memory.id)) {
          return fullPath;
        }
      }
      return null;
    };

    const existingPath = findFile(episodicDir);

    if (!existingPath) {
      return {
        status: 404,
        error: 'Memory not found',
        data: { code: 'NOT_FOUND' },
      };
    }

    // Load existing and merge
    const existing = JSON.parse(readFileSync(existingPath, 'utf-8'));

    const updatedMemory = {
      ...existing,
      content: memory.content,
      metadata: {
        ...existing.metadata,
        ...memory.metadata,
        syncedAt: new Date().toISOString(),
        lastModifiedBy: 'mobile_sync',
      },
    };

    // Save updated memory
    writeFileSync(existingPath, JSON.stringify(updatedMemory, null, 2));

    if (audit) {
      audit({
        event: 'memory_sync_push',
        category: 'data_change',
        level: 'info',
        actor: req.user.username,
        details: {
          memoryId: memory.id,
          type: memory.type,
          action: 'update',
          path: existingPath,
        },
      });
    }

    return successResponse({
      success: true,
      serverTimestamp: updatedMemory.metadata.syncedAt,
    });
  } catch (error) {
    console.error('[memory-sync] Push update failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
