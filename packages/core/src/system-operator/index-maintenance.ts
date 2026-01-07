/**
 * Index Maintenance Skill
 *
 * Maintains and optimizes vector indexes for semantic search.
 * Part of Phase 5: System Operator
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths } from '../paths.js';
import { listEpisodicFiles } from '../memory.js';
import { buildMemoryIndex, getIndexStatus, loadIndex, clearIndexCache } from '../vector-index.js';
import { audit } from '../audit.js';
import type { IndexMaintenanceResult } from './types.js';

export interface IndexMaintenanceOptions {
  username: string;
  model?: string;
  forceRebuild?: boolean;
  rebuildThreshold?: number; // Rebuild if stale % exceeds this
  removeOrphans?: boolean;
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

/**
 * Check the health of the index.
 */
export function checkIndexHealth(
  username: string,
  model?: string
): IndexHealthCheck {
  const profilePaths = getProfilePaths(username);

  // Get all episodic memory files (uses storage router internally)
  const memoryFiles = listEpisodicFiles();
  const memoryIds = new Set(memoryFiles.map(f => path.basename(f, '.json')));

  // Load the current index
  const index = loadIndex(model, username);

  if (!index) {
    return {
      totalMemories: memoryFiles.length,
      indexedMemories: 0,
      missingFromIndex: memoryFiles.length,
      orphanedEntries: 0,
      stalePercentage: 100,
      lastUpdated: null,
      needsRebuild: memoryFiles.length > 0,
    };
  }

  // Check which memories are indexed
  const indexedIds = new Set(index.data.map(item => item.id));
  const missingFromIndex = [...memoryIds].filter(id => !indexedIds.has(id)).length;
  const orphanedEntries = [...indexedIds].filter(id => !memoryIds.has(id)).length;

  const stalePercentage = memoryIds.size > 0
    ? Math.round((missingFromIndex / memoryIds.size) * 100)
    : 0;

  return {
    totalMemories: memoryFiles.length,
    indexedMemories: index.data.length,
    missingFromIndex,
    orphanedEntries,
    stalePercentage,
    lastUpdated: index.meta?.createdAt || null,
    needsRebuild: stalePercentage > 20 || orphanedEntries > 10,
  };
}

/**
 * Remove orphaned entries from the index (entries without corresponding memories).
 */
function removeOrphanedEntries(
  username: string,
  model?: string,
  dryRun = true
): { removed: number; ids: string[] } {
  const profilePaths = getProfilePaths(username);
  const memoryFiles = listEpisodicFiles();
  const memoryIds = new Set(memoryFiles.map(f => path.basename(f, '.json')));

  const index = loadIndex(model, username);
  if (!index) {
    return { removed: 0, ids: [] };
  }

  const orphanedIds: string[] = [];
  const validItems = index.data.filter(item => {
    if (memoryIds.has(item.id)) {
      return true;
    }
    orphanedIds.push(item.id);
    return false;
  });

  if (!dryRun && orphanedIds.length > 0) {
    // Update the index file
    index.data = validItems;
    const indexPath = path.join(
      profilePaths.root,
      'memory',
      'index',
      `${model || 'default'}-index.json`
    );

    if (fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
      clearIndexCache();
    }
  }

  return {
    removed: orphanedIds.length,
    ids: orphanedIds,
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
    model,
    forceRebuild = false,
    rebuildThreshold = 20,
    removeOrphans = true,
    dryRun = false,
  } = options;

  // Check index health
  const health = checkIndexHealth(username, model);
  const indexesRebuilt: string[] = [];
  let memoriesReindexed = 0;
  let orphanedEntriesRemoved = 0;

  // Decide if rebuild is needed
  const shouldRebuild = forceRebuild ||
    health.needsRebuild ||
    health.stalePercentage > rebuildThreshold;

  if (shouldRebuild && !dryRun) {
    try {
      // Rebuild the index - returns path on success, throws on failure
      await buildMemoryIndex({
        username,
        force: true,
      });

      indexesRebuilt.push(model || 'default');
      // Get count from the rebuilt index
      const newStatus = getIndexStatus(model, username);
      memoriesReindexed = newStatus.items || 0;
    } catch (error) {
      errors.push(`Index rebuild error: ${(error as Error).message}`);
    }
  } else if (shouldRebuild && dryRun) {
    // Dry run - would rebuild
    indexesRebuilt.push(model || 'default');
    memoriesReindexed = health.missingFromIndex;
  }

  // Remove orphaned entries if not rebuilding
  if (removeOrphans && !shouldRebuild) {
    const orphanResult = removeOrphanedEntries(username, model, dryRun);
    orphanedEntriesRemoved = orphanResult.removed;

    if (orphanResult.removed > 0 && !dryRun) {
      audit({
        category: 'action',
        level: 'info',
        event: 'index_orphans_removed',
        actor: 'system-operator',
        details: {
          username,
          model: model || 'default',
          removed: orphanResult.removed,
        },
      });
    }
  }

  // Get final index size
  const status = getIndexStatus(model, username);
  const indexSize = status.items || 0;

  if (!dryRun && (indexesRebuilt.length > 0 || orphanedEntriesRemoved > 0)) {
    audit({
      category: 'action',
      level: 'info',
      event: 'index_maintenance_completed',
      actor: 'system-operator',
      details: {
        username,
        indexesRebuilt,
        memoriesReindexed,
        orphanedEntriesRemoved,
        indexSize,
      },
    });
  }

  return {
    success: errors.length === 0,
    operation: 'index_maintenance',
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    details: {
      indexesRebuild: indexesRebuilt,
      memoriesReindexed,
      orphanedEntriesRemoved,
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
  const profilePaths = getProfilePaths(username);

  // Get file size
  const indexPath = path.join(
    profilePaths.root,
    'memory',
    'index',
    `${model || 'default'}-index.json`
  );

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
    totalItems: status.items || 0,
    uniqueItems,
    averageVectorDimension: avgDimension,
    lastUpdated: status.createdAt || null,
    fileSizeBytes,
  };
}
