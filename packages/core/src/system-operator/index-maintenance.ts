/**
 * Index Maintenance Skill
 *
 * Maintains and optimizes vector indexes for semantic search.
 * Part of Phase 5: System Operator
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths } from '../paths.js';
import { getIndexStatus, indexFilePath, loadIndex } from '../vector-index.js';
import { submitMemoryIndexRefresh } from '../queue/index.js';
import { audit } from '../audit.js';
import type { IndexMaintenanceResult } from './types.js';

export interface IndexMaintenanceOptions {
  username: string;
  forceRebuild?: boolean;
  rebuildThreshold?: number; // Rebuild if stale % exceeds this
  dryRun?: boolean;
}

interface IndexHealthCheck {
  totalMemories: number;
  indexedMemories: number;
  missingFromIndex: number;
  orphanedEntries: number;
  stalePercentage: number;
  lastUpdated: string | null;
  needsRebuild: boolean;
}

function listJsonFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(entryPath);
    }
  };
  visit(root);
  return files.sort();
}

function readMemoryId(filePath: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { id?: unknown };
    return typeof value.id === 'string' && value.id ? value.id : null;
  } catch {
    return null;
  }
}

/**
 * Check the health of the index.
 */
export function checkIndexHealth(
  username: string,
  model?: string,
  rebuildThreshold = 20,
): IndexHealthCheck {
  const profilePaths = getProfilePaths(username);

  const memoryFiles = listJsonFiles(profilePaths.episodic);
  const memoryIds = new Set(memoryFiles.map(readMemoryId).filter((id): id is string => Boolean(id)));

  // Load the current index
  const index = loadIndex(model, username);

  if (!index) {
    return {
      totalMemories: memoryIds.size,
      indexedMemories: 0,
      missingFromIndex: memoryIds.size,
      orphanedEntries: 0,
      stalePercentage: 100,
      lastUpdated: null,
      needsRebuild: memoryIds.size > 0,
    };
  }

  const indexedIds = new Set(index.data
    .filter(item => item.path.startsWith(`${profilePaths.episodic}${path.sep}`))
    .map(item => item.id));
  const missingFromIndex = [...memoryIds].filter(id => !indexedIds.has(id)).length;
  const orphanedEntries = index.data.filter(item => Boolean(item.path) && !fs.existsSync(item.path)).length;

  const stalePercentage = memoryIds.size > 0
    ? Math.round((missingFromIndex / memoryIds.size) * 100)
    : 0;

  return {
    totalMemories: memoryIds.size,
    indexedMemories: Math.max(0, memoryIds.size - missingFromIndex),
    missingFromIndex,
    orphanedEntries,
    stalePercentage,
    lastUpdated: index.meta?.createdAt || null,
    needsRebuild: stalePercentage > rebuildThreshold || orphanedEntries > 0,
  };
}

/**
 * Run index maintenance.
 */
export async function runIndexMaintenance(
  options: IndexMaintenanceOptions
): Promise<IndexMaintenanceResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  const {
    username,
    forceRebuild = false,
    rebuildThreshold = 20,
    dryRun = false,
  } = options;

  if (!Number.isFinite(rebuildThreshold) || rebuildThreshold < 0 || rebuildThreshold > 100) {
    throw new Error('rebuildThreshold must be a number from 0 to 100');
  }

  const health = checkIndexHealth(username, undefined, rebuildThreshold);
  let taskId: string | undefined;
  let rebuildQueued = false;

  // Decide if rebuild is needed
  const shouldRebuild = forceRebuild ||
    health.needsRebuild ||
    health.stalePercentage > rebuildThreshold;

  if (shouldRebuild && !dryRun) {
    try {
      const task = await submitMemoryIndexRefresh({
        username,
        force: true,
        source: 'system',
        metadata: { producer: 'system-operator-index-maintenance' },
      });
      taskId = task.id;
      rebuildQueued = true;
      audit({
        category: 'action',
        level: 'info',
        event: 'index_maintenance_queued',
        actor: 'system-operator',
        details: { username, taskId, forceRebuild, missingFromIndex: health.missingFromIndex, orphanedEntries: health.orphanedEntries },
      });
    } catch (error) {
      errors.push(`Index rebuild queue error: ${(error as Error).message}`);
    }
  }

  const status = getIndexStatus(undefined, username);
  const indexSize = status.exists ? status.items : 0;

  return {
    success: errors.length === 0,
    operation: 'index_maintenance',
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    details: {
      rebuildNeeded: shouldRebuild,
      rebuildQueued,
      taskId,
      missingFromIndex: health.missingFromIndex,
      orphanedEntries: health.orphanedEntries,
      indexSize,
    },
    errors,
    warnings,
  };
}

/**
 * Get index statistics for all users.
 */
export function getIndexStatistics(username: string, model?: string): {
  totalItems: number;
  uniqueItems: number;
  averageVectorDimension: number;
  lastUpdated: string | null;
  fileSizeBytes: number;
} {
  const status = getIndexStatus(model, username);

  // Get file size
  const indexPath = indexFilePath(model, username);

  let fileSizeBytes = 0;
  if (fs.existsSync(indexPath)) {
    fileSizeBytes = fs.statSync(indexPath).size;
  }

  // Load index for detailed stats
  const index = loadIndex(model, username);
  const uniqueItems = index ? new Set(index.data.map(i => i.id)).size : 0;
  const avgDimension = index && index.data.length > 0
    ? Math.round(index.data.reduce((sum, i) => sum + (i.vector?.length || 0), 0) / index.data.length)
    : 0;

  return {
    totalItems: status.exists ? status.items : 0,
    uniqueItems,
    averageVectorDimension: avgDimension,
    lastUpdated: status.exists ? status.createdAt : null,
    fileSizeBytes,
  };
}
