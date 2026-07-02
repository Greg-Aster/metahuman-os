import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { audit } from '../../audit.js';
import { getProfilePaths } from '../../path-builder.js';

function findMemoryFile(dir: string, id: string): string | null {
  if (!fs.existsSync(dir)) {
    return null;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMemoryFile(fullPath, id);
      if (found) {
        return found;
      }
    } else if (entry.name.includes(id)) {
      return fullPath;
    }
  }

  return null;
}

export const handleGetMemorySyncItem: UnifiedHandler = async (req) => {
  try {
    const id = req.params?.id;
    if (!id) {
      return { status: 400, data: { error: 'Memory ID required' } };
    }

    const profilePaths = getProfilePaths(req.user.username);
    const filePath = findMemoryFile(profilePaths.episodic, id);

    if (!filePath) {
      return { status: 200, data: { exists: false } };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const memory = JSON.parse(content);
    const stats = fs.statSync(filePath);

    return {
      status: 200,
      data: {
        exists: true,
        memory: {
          id: memory.id || id,
          type: memory.type,
          timestamp: memory.timestamp,
          modifiedAt: stats.mtime.toISOString(),
        },
      },
    };
  } catch (error) {
    console.error('[api/memory-sync-item] get error:', error);
    return {
      status: 500,
      data: { error: error instanceof Error ? error.message : 'Internal server error' },
    };
  }
};

export const handleDeleteMemorySyncItem: UnifiedHandler = async (req) => {
  try {
    const id = req.params?.id;
    if (!id) {
      return { status: 400, data: { error: 'Memory ID required' } };
    }

    const profilePaths = getProfilePaths(req.user.username);
    const filePath = findMemoryFile(profilePaths.episodic, id);

    if (!filePath) {
      return {
        status: 404,
        data: {
          error: 'Memory not found',
          code: 'NOT_FOUND',
        },
      };
    }

    const archiveDir = path.join(profilePaths.root, 'memory', 'archive');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const archivePath = path.join(archiveDir, `${Date.now()}-${path.basename(filePath)}`);
    fs.renameSync(filePath, archivePath);

    audit({
      event: 'memory_sync_delete',
      category: 'data_change',
      level: 'info',
      actor: req.user.username,
      details: {
        memoryId: id,
        originalPath: filePath,
        archivePath,
      },
    });

    return {
      status: 200,
      data: {
        success: true,
        archived: true,
      },
    };
  } catch (error) {
    console.error('[api/memory-sync-item] delete error:', error);
    return {
      status: 500,
      data: { error: error instanceof Error ? error.message : 'Internal server error' },
    };
  }
};
