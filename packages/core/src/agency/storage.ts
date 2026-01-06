/**
 * Agency Storage Helpers
 *
 * Provides convenient methods for reading/writing agency data
 * using the centralized storage router.
 */

import { storageClient } from '../storage-client.js';
import type {
  Desire,
  DesireStatus,
  DesirePlan,
  DesireReview,
  AgencyConfig,
  AgencyMetrics,
  DesireScratchpadEntry,
  DesireScratchpadEntryType,
  DesireOutcomeReview,
  DesireExecution,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

// Desires are stored under persona/desires/ (identity-related)
// Accessible via both config/desires and memory/agency routes
const CATEGORY = 'config' as const;
const SUBCATEGORY = 'desires' as const;

// Folder-based storage: each desire has its own folder at folders/{id}/
const FOLDER_BASE = 'folders';

// ============================================================================
// Desire Storage (Folder-Based)
// ============================================================================

/**
 * Get the folder path for a desire.
 */
export function getDesireFolderPath(desireId: string): string {
  return `${FOLDER_BASE}/${desireId}`;
}

/**
 * Ensure desire folder exists.
 */
async function ensureDesireFolder(desireId: string, username?: string): Promise<void> {
  const folderPath = getDesireFolderPath(desireId);
  const subdirs = ['scratchpad', 'plans', 'reviews', 'executions'];

  for (const subdir of subdirs) {
    await storageClient.write({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `${folderPath}/${subdir}/.gitkeep`,
      data: '',
      encoding: 'utf8',
    });
  }
}

/**
 * Save a desire to storage.
 * Uses folder-based storage: folders/{id}/manifest.json
 */
export async function saveDesire(desire: Desire, username?: string): Promise<void> {
  const folderPath = getDesireFolderPath(desire.id);

  // Ensure folder exists
  await ensureDesireFolder(desire.id, username);

  // Save manifest
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/manifest.json`,
    data: JSON.stringify(desire, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Load a desire by ID.
 * Loads from folder-based storage: folders/{id}/manifest.json
 */
export async function loadDesire(desireId: string, username?: string): Promise<Desire | null> {
  const folderPath = getDesireFolderPath(desireId);

  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/manifest.json`,
    encoding: 'utf8',
  });

  if (result.success && result.data) {
    return JSON.parse(result.data as string) as Desire;
  }

  return null;
}

/**
 * Delete a desire from storage.
 * Removes from both folder-based and legacy status-based storage.
 */
export async function deleteDesire(desire: Desire, username?: string): Promise<void> {
  const folderPath = getDesireFolderPath(desire.id);

  // Delete manifest from folder-based storage
  await storageClient.delete({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/manifest.json`,
  });

  // Also delete from legacy status directories if present
  // These are old storage format files at <status>/<desire.id>.json
  const legacyStatuses = [
    'nascent', 'pending', 'evaluating', 'planning', 'reviewing',
    'approved', 'awaiting_approval', 'executing', 'awaiting_review',
    'completed', 'rejected', 'abandoned', 'failed', 'active', 'executed',
  ];

  for (const status of legacyStatuses) {
    try {
      await storageClient.delete({
        username,
        category: CATEGORY,
        subcategory: SUBCATEGORY,
        relativePath: `${status}/${desire.id}.json`,
      });
    } catch {
      // File might not exist in this status directory - that's fine
    }
  }

  // Also clean up from nested desires/pending directory (legacy location)
  // This is read by listDesiresFromLegacyDirectories and would resurrect deleted desires
  for (const status of legacyStatuses) {
    try {
      await storageClient.delete({
        username,
        category: CATEGORY,
        subcategory: SUBCATEGORY,
        relativePath: `desires/${status}/${desire.id}.json`,
      });
    } catch {
      // File might not exist - that's fine
    }
  }

  // Note: Subdirectories and their contents in folder-based storage remain for audit trail
}

/**
 * Move a desire to a new status.
 * With folder-based storage, this just updates the manifest - no file moving needed.
 */
export async function moveDesire(
  desire: Desire,
  _oldStatus: DesireStatus,
  _newStatus: DesireStatus,
  username?: string
): Promise<void> {
  // With folder-based storage, status is just a field in the manifest
  // No file moving needed - just save the updated desire
  await saveDesire(desire, username);
}

/**
 * List desires by status.
 * Uses folder-based storage only.
 */
export async function listDesiresByStatus(
  status: DesireStatus,
  username?: string
): Promise<Desire[]> {
  // Get all desires from folders, filter by status
  const allDesires = await listAllDesires(username);
  return allDesires.filter(d => d.status === status);
}

/**
 * List all active desires (in evaluation, planning, reviewing, etc.).
 * Uses folder-based storage only.
 */
export async function listActiveDesires(username?: string): Promise<Desire[]> {
  const activeStatuses: DesireStatus[] = ['evaluating', 'planning', 'reviewing', 'approved', 'executing', 'awaiting_review'];
  const allDesires = await listDesiresFromFolders(username);
  return allDesires.filter(d => activeStatuses.includes(d.status));
}

/**
 * List all pending desires (waiting for threshold).
 */
export async function listPendingDesires(username?: string): Promise<Desire[]> {
  return listDesiresByStatus('pending', username);
}

/**
 * List all nascent desires (just generated).
 */
export async function listNascentDesires(username?: string): Promise<Desire[]> {
  return listDesiresByStatus('nascent', username);
}

/**
 * List all desires awaiting user approval.
 * Uses folder-based storage only.
 */
export async function listDesiresPendingApproval(username?: string): Promise<Desire[]> {
  const approvalStatuses: DesireStatus[] = ['awaiting_approval', 'reviewing'];
  const allDesires = await listDesiresFromFolders(username);
  return allDesires.filter(d => approvalStatuses.includes(d.status));
}

/**
 * Get count of desires by status.
 */
export async function getDesireCount(status: DesireStatus, username?: string): Promise<number> {
  const desires = await listDesiresByStatus(status, username);
  return desires.length;
}

// ============================================================================
// Plan Storage
// ============================================================================

/**
 * Save a plan to storage.
 */
export async function savePlan(plan: DesirePlan, username?: string): Promise<void> {
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `plans/${plan.id}.json`,
    data: JSON.stringify(plan, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Load a plan by ID.
 */
export async function loadPlan(planId: string, username?: string): Promise<DesirePlan | null> {
  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `plans/${planId}.json`,
    encoding: 'utf8',
  });

  if (!result.success || !result.data) {
    return null;
  }

  return JSON.parse(result.data as string) as DesirePlan;
}

// ============================================================================
// Review Storage
// ============================================================================

/**
 * Save a review to storage.
 */
export async function saveReview(review: DesireReview, username?: string): Promise<void> {
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `reviews/${review.id}.json`,
    data: JSON.stringify(review, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Load a review by ID.
 */
export async function loadReview(reviewId: string, username?: string): Promise<DesireReview | null> {
  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `reviews/${reviewId}.json`,
    encoding: 'utf8',
  });

  if (!result.success || !result.data) {
    return null;
  }

  return JSON.parse(result.data as string) as DesireReview;
}

// ============================================================================
// Configuration Storage
// ============================================================================

/**
 * Load agency configuration.
 * First checks user profile, then falls back to system config.
 */
export async function loadAgencyConfig(username?: string): Promise<AgencyConfig | null> {
  // Try user-specific config first
  if (username) {
    const userResult = await storageClient.read({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: 'config.json',
      encoding: 'utf8',
    });

    if (userResult.success && userResult.data) {
      return JSON.parse(userResult.data as string) as AgencyConfig;
    }
  }

  // Fall back to system config (etc/agency.json)
  // This is handled by the config module
  return null;
}

/**
 * Save agency configuration override for a user.
 */
export async function saveAgencyConfig(config: AgencyConfig, username?: string): Promise<void> {
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: 'config.json',
    data: JSON.stringify(config, null, 2),
    encoding: 'utf8',
  });
}

// ============================================================================
// Metrics Storage
// ============================================================================

/**
 * Load agency metrics.
 */
export async function loadMetrics(username?: string): Promise<AgencyMetrics | null> {
  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: 'metrics/agency-stats.json',
    encoding: 'utf8',
  });

  if (!result.success || !result.data) {
    return null;
  }

  return JSON.parse(result.data as string) as AgencyMetrics;
}

/**
 * Save agency metrics.
 */
export async function saveMetrics(metrics: AgencyMetrics, username?: string): Promise<void> {
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: 'metrics/agency-stats.json',
    data: JSON.stringify(metrics, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Initialize metrics if they don't exist.
 */
export async function initializeMetrics(username?: string): Promise<AgencyMetrics> {
  const existing = await loadMetrics(username);
  if (existing) {
    return existing;
  }

  const initial: AgencyMetrics = {
    totalGenerated: 0,
    totalCompleted: 0,
    totalRejected: 0,
    totalAbandoned: 0,
    totalFailed: 0,
    completedToday: 0,
    avgActivationStrength: 0,
    avgTimeToCompletion: 0,
    successRate: 0,
    updatedAt: new Date().toISOString(),
  };

  await saveMetrics(initial, username);
  return initial;
}

/** Numeric metric keys for type safety */
type NumericMetricKey = Exclude<keyof AgencyMetrics, 'updatedAt'>;

/**
 * Update a specific numeric metric.
 */
export async function updateMetric(
  key: NumericMetricKey,
  value: number,
  username?: string
): Promise<void> {
  const metrics = await loadMetrics(username) || await initializeMetrics(username);

  // Create updated metrics object
  const updated: AgencyMetrics = {
    ...metrics,
    [key]: value,
    updatedAt: new Date().toISOString(),
  };

  await saveMetrics(updated, username);
}

/**
 * Increment a counter metric.
 */
export async function incrementMetric(
  key: NumericMetricKey,
  amount: number = 1,
  username?: string
): Promise<void> {
  const metrics = await loadMetrics(username) || await initializeMetrics(username);

  const current = metrics[key] || 0;
  const updated: AgencyMetrics = {
    ...metrics,
    [key]: current + amount,
    updatedAt: new Date().toISOString(),
  };

  await saveMetrics(updated, username);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if agency storage exists for a user.
 */
export function agencyStorageExists(username?: string): boolean {
  return storageClient.exists({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
  });
}

/**
 * Initialize agency storage directories.
 * Creates folder-based storage structure under persona/desires/folders/
 *
 * NOTE: Legacy status-based directories (nascent/, pending/, active/, etc.)
 * are no longer created. All desires now use folder-based storage at:
 *   folders/<desire-id>/manifest.json
 */
export async function initializeAgencyStorage(username?: string): Promise<void> {
  // Only create folder-based storage structure
  const dirs = [
    'folders',   // Main folder-based storage
    'metrics',   // Global metrics
  ];

  // Create a placeholder file in each directory to ensure they exist
  for (const dir of dirs) {
    const placeholderPath = `${dir}/.gitkeep`;
    if (!storageClient.exists({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: placeholderPath,
    })) {
      await storageClient.write({
        username,
        category: CATEGORY,
        subcategory: SUBCATEGORY,
        relativePath: placeholderPath,
        data: '',
        encoding: 'utf8',
      });
    }
  }
}

/**
 * Get all desires (across all statuses).
 * Uses folder-based storage with fallback to legacy status directories.
 * Also attempts to repair/migrate desires found in legacy locations.
 */
export async function listAllDesires(username?: string): Promise<Desire[]> {
  // First get desires from folder-based storage
  const folderDesires = await listDesiresFromFolders(username);
  const folderIds = new Set(folderDesires.map(d => d.id));

  // Then check legacy status directories for any not in folders
  const legacyDesires = await listDesiresFromLegacyDirectories(username);
  const missingDesires = legacyDesires.filter(d => !folderIds.has(d.id));

  if (missingDesires.length > 0) {
    console.log(`[agency-storage] Found ${missingDesires.length} desires in legacy directories not in folders`);

    // Auto-migrate legacy desires to folder storage
    for (const desire of missingDesires) {
      try {
        await migrateDesireToFolderStorage(desire, username);
        console.log(`[agency-storage] Migrated legacy desire ${desire.id} to folder storage`);
      } catch (error) {
        console.warn(`[agency-storage] Failed to migrate desire ${desire.id}:`, error);
      }
    }
  }

  return [...folderDesires, ...missingDesires];
}

/**
 * List desires from legacy status-based directories.
 * These are the old storage format where desires were stored in directories
 * named after their status (pending/, active/, etc.).
 */
async function listDesiresFromLegacyDirectories(username?: string): Promise<Desire[]> {
  // Note: 'active' is not a valid DesireStatus but exists as a legacy directory
  const legacyStatuses: string[] = [
    'nascent', 'pending', 'evaluating', 'planning', 'reviewing',
    'approved', 'awaiting_approval', 'executing', 'awaiting_review',
    'completed', 'rejected', 'abandoned', 'failed', 'active',
  ];

  const desires: Desire[] = [];

  for (const status of legacyStatuses) {
    try {
      const result = await storageClient.list({
        username,
        category: CATEGORY,
        subcategory: SUBCATEGORY,
        relativePath: status,
      });

      if (!result.success || !result.files) continue;

      for (const file of result.files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await storageClient.read({
            username,
            category: CATEGORY,
            subcategory: SUBCATEGORY,
            relativePath: `${status}/${file}`,
            encoding: 'utf8',
          });

          if (content.success && content.data) {
            const desire = JSON.parse(content.data as string) as Desire;
            desires.push(desire);
          }
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  // Also check nested desires/pending directory (known legacy location)
  try {
    const nestedResult = await storageClient.list({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: 'desires/pending',
    });

    if (nestedResult.success && nestedResult.files) {
      for (const file of nestedResult.files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await storageClient.read({
            username,
            category: CATEGORY,
            subcategory: SUBCATEGORY,
            relativePath: `desires/pending/${file}`,
            encoding: 'utf8',
          });

          if (content.success && content.data) {
            const desire = JSON.parse(content.data as string) as Desire;
            desires.push(desire);
          }
        } catch {
          // Skip malformed files
        }
      }
    }
  } catch {
    // Nested directory might not exist
  }

  return desires;
}

/**
 * Migrate a desire from legacy storage to folder-based storage.
 * Creates the folder structure and saves the manifest.
 */
async function migrateDesireToFolderStorage(desire: Desire, username?: string): Promise<void> {
  const folderPath = getDesireFolderPath(desire.id);

  // Ensure folder exists
  await createDesireFolder(desire.id, username);

  // Update desire with folder path
  desire.folderPath = folderPath;

  // Save manifest
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/manifest.json`,
    data: JSON.stringify(desire, null, 2),
    encoding: 'utf8',
  });
}

// ============================================================================
// Folder-Based Desire Storage (New Architecture)
// ============================================================================
// Each desire gets its own folder with structure:
//   desires/folders/<desire-id>/
//     manifest.json       - Core desire data (minimal, fast to load)
//     scratchpad/         - Individual event files
//       0001-origin.json
//       0002-reinforcement.json
//     plans/              - Versioned plans
//       v1.json
//       v2.json
//     reviews/            - Outcome reviews
//       outcome-001.json
//     executions/         - Execution attempts
//       attempt-001.json
// ============================================================================

import {
  getScratchpadEntryFilename,
  updateScratchpadSummary,
  initializeScratchpadSummary,
} from './types.js';

/**
 * Create desire folder structure
 */
export async function createDesireFolder(desireId: string, username?: string): Promise<string> {
  const folderPath = getDesireFolderPath(desireId);
  const subdirs = ['scratchpad', 'plans', 'reviews', 'executions'];

  for (const subdir of subdirs) {
    await storageClient.write({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `${folderPath}/${subdir}/.gitkeep`,
      data: '',
      encoding: 'utf8',
    });
  }

  return folderPath;
}

/**
 * Save desire manifest (core data only, references other files)
 */
export async function saveDesireManifest(desire: Desire, username?: string): Promise<void> {
  const folderPath = desire.folderPath || getDesireFolderPath(desire.id);

  // Ensure folder exists
  await createDesireFolder(desire.id, username);

  // Save manifest
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/manifest.json`,
    data: JSON.stringify({ ...desire, folderPath }, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Load desire from folder (manifest only)
 */
export async function loadDesireFromFolder(desireId: string, username?: string): Promise<Desire | null> {
  const folderPath = getDesireFolderPath(desireId);

  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/manifest.json`,
    encoding: 'utf8',
  });

  if (!result.success || !result.data) {
    return null;
  }

  return JSON.parse(result.data as string) as Desire;
}

/**
 * Add a scratchpad entry to a desire's folder.
 * If the desire exists in file-based storage but not folder-based,
 * it will be migrated to folder-based storage first.
 */
export async function addScratchpadEntryToFolder(
  desireId: string,
  entry: DesireScratchpadEntry,
  username?: string
): Promise<void> {
  const folderPath = getDesireFolderPath(desireId);

  // Load current manifest to get scratchpad summary
  let desire = await loadDesireFromFolder(desireId, username);

  // If not found in folder-based storage, check file-based storage and migrate
  if (!desire) {
    const fileBased = await loadDesire(desireId, username);
    if (fileBased) {
      // Migrate to folder-based storage
      console.log(`[agency:storage] Migrating desire ${desireId} to folder-based storage`);
      await createDesireFolder(desireId, username);
      await saveDesireManifest(fileBased, username);
      desire = fileBased;
    } else {
      throw new Error(`Desire ${desireId} not found`);
    }
  }

  // Update scratchpad summary
  const summary = desire.scratchpad || initializeScratchpadSummary();
  const entryNumber = summary.lastEntryNumber + 1;
  const filename = getScratchpadEntryFilename(entryNumber, entry.type as DesireScratchpadEntryType);

  // Save the entry file
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/scratchpad/${filename}`,
    data: JSON.stringify(entry, null, 2),
    encoding: 'utf8',
  });

  // Update manifest with new summary
  desire.scratchpad = updateScratchpadSummary(summary, entry);
  await saveDesireManifest(desire, username);
}

/**
 * List scratchpad entries for a desire
 */
export async function listScratchpadEntries(desireId: string, username?: string): Promise<string[]> {
  const folderPath = getDesireFolderPath(desireId);

  const result = await storageClient.list({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/scratchpad`,
  });

  if (!result.success || !result.files) {
    return [];
  }

  return result.files.filter(f => f.endsWith('.json')).sort();
}

/**
 * Load a specific scratchpad entry
 */
export async function loadScratchpadEntry(
  desireId: string,
  filename: string,
  username?: string
): Promise<DesireScratchpadEntry | null> {
  const folderPath = getDesireFolderPath(desireId);

  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/scratchpad/${filename}`,
    encoding: 'utf8',
  });

  if (!result.success || !result.data) {
    return null;
  }

  return JSON.parse(result.data as string) as DesireScratchpadEntry;
}

/**
 * Load all scratchpad entries for a desire (paginated)
 */
export async function loadScratchpadEntriesPaginated(
  desireId: string,
  offset: number = 0,
  limit: number = 10,
  username?: string
): Promise<{ entries: DesireScratchpadEntry[]; total: number }> {
  const files = await listScratchpadEntries(desireId, username);
  const total = files.length;

  // Get subset of files (most recent first)
  const reversed = files.slice().reverse();
  const subset = reversed.slice(offset, offset + limit);

  const entries: DesireScratchpadEntry[] = [];
  for (const filename of subset) {
    const entry = await loadScratchpadEntry(desireId, filename, username);
    if (entry) {
      entries.push(entry);
    }
  }

  return { entries, total };
}

/**
 * Save a plan to desire folder
 */
export async function savePlanToFolder(
  desireId: string,
  plan: DesirePlan,
  username?: string
): Promise<void> {
  const folderPath = getDesireFolderPath(desireId);

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/plans/v${plan.version}.json`,
    data: JSON.stringify(plan, null, 2),
    encoding: 'utf8',
  });

  // Update manifest metrics
  const desire = await loadDesireFromFolder(desireId, username);
  if (desire && desire.metrics) {
    desire.metrics.planVersionCount++;
    await saveDesireManifest(desire, username);
  }
}

/**
 * List all plan versions for a desire
 */
export async function listPlanVersions(desireId: string, username?: string): Promise<string[]> {
  const folderPath = getDesireFolderPath(desireId);

  const result = await storageClient.list({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/plans`,
  });

  if (!result.success || !result.files) {
    return [];
  }

  return result.files.filter(f => f.endsWith('.json')).sort();
}

/**
 * Load a specific plan version
 */
export async function loadPlanFromFolder(
  desireId: string,
  version: number,
  username?: string
): Promise<DesirePlan | null> {
  const folderPath = getDesireFolderPath(desireId);

  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/plans/v${version}.json`,
    encoding: 'utf8',
  });

  if (!result.success || !result.data) {
    return null;
  }

  return JSON.parse(result.data as string) as DesirePlan;
}

/**
 * Save an outcome review to desire folder
 */
export async function saveOutcomeReviewToFolder(
  desireId: string,
  review: DesireOutcomeReview,
  username?: string
): Promise<void> {
  const folderPath = getDesireFolderPath(desireId);

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/reviews/${review.id}.json`,
    data: JSON.stringify(review, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Save an execution attempt to desire folder
 */
export async function saveExecutionToFolder(
  desireId: string,
  execution: DesireExecution,
  attemptNumber: number,
  username?: string
): Promise<void> {
  const folderPath = getDesireFolderPath(desireId);

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${folderPath}/executions/attempt-${String(attemptNumber).padStart(3, '0')}.json`,
    data: JSON.stringify(execution, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Get folder size (rough metric of processing effort)
 */
export async function getDesireFolderSize(desireId: string, username?: string): Promise<number> {
  const folderPath = getDesireFolderPath(desireId);
  let totalSize = 0;

  const subdirs = ['scratchpad', 'plans', 'reviews', 'executions'];

  for (const subdir of subdirs) {
    const result = await storageClient.list({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `${folderPath}/${subdir}`,
    });

    if (result.success && result.files) {
      // Approximate: count files * average size estimate
      totalSize += result.files.filter(f => f.endsWith('.json')).length * 500; // ~500 bytes per file
    }
  }

  return totalSize;
}

/**
 * List all desire folders
 */
export async function listDesireFolders(username?: string): Promise<string[]> {
  const result = await storageClient.list({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: FOLDER_BASE,
  });

  if (!result.success || !result.files) {
    return [];
  }

  // Filter to directories (those that don't have extensions)
  return result.files.filter(f => !f.includes('.'));
}

/**
 * Load all desires from folders
 */
export async function listDesiresFromFolders(username?: string): Promise<Desire[]> {
  const folderIds = await listDesireFolders(username);
  const desires: Desire[] = [];

  for (const folderId of folderIds) {
    const desire = await loadDesireFromFolder(folderId, username);
    if (desire) {
      desires.push(desire);
    }
  }

  return desires;
}

// ============================================================================
// Generator Scratchpad - Tracks Memory Analysis Progress
// ============================================================================
// The generator scratchpad is a global tracking file (not per-desire) that
// records which memories have been analyzed for potential desires.
// This prevents the same memories from being analyzed multiple times.

interface GeneratorScratchpad {
  /** Last time the generator ran */
  lastRunAt: string;
  /** Total number of memories analyzed */
  totalMemoriesAnalyzed: number;
  /** IDs/paths of memories that have been analyzed */
  analyzedMemoryIds: string[];
  /** Maximum number of IDs to keep (rolling window) */
  maxTrackedIds: number;
  /** Last memory timestamp analyzed (for incremental analysis) */
  lastMemoryTimestamp?: string;
}

const GENERATOR_SCRATCHPAD_PATH = 'generator-scratchpad.json';

/**
 * Load the generator scratchpad
 */
export async function loadGeneratorScratchpad(username?: string): Promise<GeneratorScratchpad> {
  const result = await storageClient.read({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: GENERATOR_SCRATCHPAD_PATH,
    encoding: 'utf8',
  });

  if (result.success && result.data) {
    return JSON.parse(result.data as string) as GeneratorScratchpad;
  }

  // Return default scratchpad
  return {
    lastRunAt: new Date().toISOString(),
    totalMemoriesAnalyzed: 0,
    analyzedMemoryIds: [],
    maxTrackedIds: 1000,
  };
}

/**
 * Save the generator scratchpad
 */
export async function saveGeneratorScratchpad(
  scratchpad: GeneratorScratchpad,
  username?: string
): Promise<void> {
  // Trim to max size if needed
  if (scratchpad.analyzedMemoryIds.length > scratchpad.maxTrackedIds) {
    scratchpad.analyzedMemoryIds = scratchpad.analyzedMemoryIds.slice(-scratchpad.maxTrackedIds);
  }

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: GENERATOR_SCRATCHPAD_PATH,
    data: JSON.stringify(scratchpad, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Mark memories as analyzed in the generator scratchpad
 */
export async function markMemoriesAsAnalyzed(
  memoryIds: string[],
  username?: string
): Promise<void> {
  const scratchpad = await loadGeneratorScratchpad(username);

  // Add new IDs (avoiding duplicates)
  const existingSet = new Set(scratchpad.analyzedMemoryIds);
  for (const id of memoryIds) {
    if (!existingSet.has(id)) {
      scratchpad.analyzedMemoryIds.push(id);
    }
  }

  scratchpad.totalMemoriesAnalyzed += memoryIds.length;
  scratchpad.lastRunAt = new Date().toISOString();

  await saveGeneratorScratchpad(scratchpad, username);
}

/**
 * Check if a memory has already been analyzed
 */
export async function isMemoryAnalyzed(
  memoryId: string,
  username?: string
): Promise<boolean> {
  const scratchpad = await loadGeneratorScratchpad(username);
  return scratchpad.analyzedMemoryIds.includes(memoryId);
}

/**
 * Filter out already-analyzed memories from a list
 */
export async function filterUnanalyzedMemories(
  memoryIds: string[],
  username?: string
): Promise<string[]> {
  const scratchpad = await loadGeneratorScratchpad(username);
  const analyzedSet = new Set(scratchpad.analyzedMemoryIds);
  return memoryIds.filter(id => !analyzedSet.has(id));
}

// ============================================================================
// Similar Desire Detection
// ============================================================================
// Helps detect and upgrade similar desires instead of creating duplicates

/**
 * Calculate simple word overlap similarity between two strings.
 * Returns a score between 0 and 1.
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  // Jaccard similarity: intersection / union
  const union = new Set([...words1, ...words2]).size;
  return overlap / union;
}

/**
 * Find existing desires similar to a new potential desire.
 * Used to determine if we should upgrade an existing desire vs create new.
 */
export async function findSimilarDesires(
  title: string,
  description: string,
  username?: string,
  options?: {
    minSimilarity?: number;
    excludeStatuses?: DesireStatus[];
    limit?: number;
  }
): Promise<Array<{ desire: Desire; similarity: number }>> {
  const minSimilarity = options?.minSimilarity ?? 0.4;
  const excludeStatuses = options?.excludeStatuses ?? ['completed', 'rejected', 'abandoned', 'failed'];
  const limit = options?.limit ?? 5;

  const allDesires = await listDesiresFromFolders(username);

  const candidates: Array<{ desire: Desire; similarity: number }> = [];
  const searchText = `${title} ${description}`.toLowerCase();

  for (const desire of allDesires) {
    // Skip excluded statuses
    if (excludeStatuses.includes(desire.status)) continue;

    const desireText = `${desire.title} ${desire.description}`.toLowerCase();
    const similarity = calculateSimilarity(searchText, desireText);

    if (similarity >= minSimilarity) {
      candidates.push({ desire, similarity });
    }
  }

  // Sort by similarity descending and limit
  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, limit);
}

/**
 * Reinforce an existing desire's strength.
 * Called when similar content is detected that supports an existing desire.
 */
export async function reinforceDesire(
  desireId: string,
  reinforcementData: {
    boost: number;
    reason: string;
    sourceInput?: string;
  },
  username?: string
): Promise<Desire | null> {
  const desire = await loadDesireFromFolder(desireId, username);
  if (!desire) return null;

  const now = new Date().toISOString();
  const oldStrength = desire.strength;
  const newStrength = Math.min(1.0, desire.strength + reinforcementData.boost);

  // Update desire
  desire.strength = newStrength;
  desire.reinforcements = (desire.reinforcements || 0) + 1;
  desire.updatedAt = now;

  // Update metrics
  if (desire.metrics) {
    desire.metrics.reinforcementCount++;
    desire.metrics.netReinforcement++;
    desire.metrics.lastActivityAt = now;
    if (newStrength > desire.metrics.peakStrength) {
      desire.metrics.peakStrength = newStrength;
    }
  }

  // Save manifest
  await saveDesireManifest(desire, username);

  // Add scratchpad entry
  await addScratchpadEntryToFolder(desireId, {
    timestamp: now,
    type: 'reinforcement',
    description: `Strength reinforced: ${oldStrength.toFixed(2)} → ${newStrength.toFixed(2)}. ${reinforcementData.reason}`,
    actor: 'system',
    data: {
      oldStrength,
      newStrength,
      boost: reinforcementData.boost,
      reason: reinforcementData.reason,
      sourceInput: reinforcementData.sourceInput,
    },
  }, username);

  return desire;
}

/**
 * Depreciate a desire's strength.
 * Called when context changes suggest the desire is no longer relevant.
 */
export async function depreciateDesire(
  desireId: string,
  depreciationData: {
    reduction: number;
    reason: string;
    markAbandoned?: boolean;
  },
  username?: string
): Promise<Desire | null> {
  const desire = await loadDesireFromFolder(desireId, username);
  if (!desire) return null;

  const now = new Date().toISOString();
  const oldStrength = desire.strength;
  const newStrength = Math.max(0, desire.strength - depreciationData.reduction);

  // Update desire
  desire.strength = newStrength;
  desire.updatedAt = now;

  // Update metrics
  if (desire.metrics) {
    desire.metrics.decayCount++;
    desire.metrics.netReinforcement--;
    desire.metrics.lastActivityAt = now;
    if (newStrength < desire.metrics.troughStrength) {
      desire.metrics.troughStrength = newStrength;
    }
  }

  // Mark as abandoned if requested or strength is 0
  if (depreciationData.markAbandoned || newStrength <= 0) {
    desire.status = 'abandoned';
    desire.completedAt = now;
  }

  // Save manifest
  await saveDesireManifest(desire, username);

  // Add scratchpad entry
  await addScratchpadEntryToFolder(desireId, {
    timestamp: now,
    type: 'decay',
    description: `Strength depreciated: ${oldStrength.toFixed(2)} → ${newStrength.toFixed(2)}. ${depreciationData.reason}`,
    actor: 'system',
    data: {
      oldStrength,
      newStrength,
      reduction: depreciationData.reduction,
      reason: depreciationData.reason,
      abandoned: depreciationData.markAbandoned || newStrength <= 0,
    },
  }, username);

  return desire;
}
