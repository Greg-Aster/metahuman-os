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
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const CATEGORY = 'state' as const;
const SUBCATEGORY = 'agency' as const;

const DESIRE_DIRS: Record<string, string> = {
  nascent: 'desires/nascent',
  pending: 'desires/pending',
  evaluating: 'desires/active',
  planning: 'desires/active',
  reviewing: 'desires/active',
  awaiting_approval: 'desires/active',
  approved: 'desires/active',
  executing: 'desires/active',
  completed: 'desires/completed',
  rejected: 'desires/rejected',
  abandoned: 'desires/abandoned',
  failed: 'desires/completed',
};

// ============================================================================
// Desire Storage
// ============================================================================

/**
 * Get the directory for a desire based on its status.
 */
function getDesireDir(status: DesireStatus): string {
  return DESIRE_DIRS[status] || 'desires/pending';
}

/**
 * Save a desire to storage.
 */
export async function saveDesire(desire: Desire, username?: string): Promise<void> {
  const dir = getDesireDir(desire.status);
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${dir}/${desire.id}.json`,
    data: JSON.stringify(desire, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Load a desire by ID.
 * Searches across all status directories.
 */
export async function loadDesire(desireId: string, username?: string): Promise<Desire | null> {
  // Search in all directories
  const dirs = [...new Set(Object.values(DESIRE_DIRS))];

  for (const dir of dirs) {
    const result = await storageClient.read({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `${dir}/${desireId}.json`,
      encoding: 'utf8',
    });

    if (result.success && result.data) {
      return JSON.parse(result.data as string) as Desire;
    }
  }

  return null;
}

/**
 * Delete a desire from storage.
 */
export async function deleteDesire(desire: Desire, username?: string): Promise<void> {
  const dir = getDesireDir(desire.status);
  await storageClient.delete({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${dir}/${desire.id}.json`,
  });
}

/**
 * Move a desire to a new status directory.
 */
export async function moveDesire(
  desire: Desire,
  oldStatus: DesireStatus,
  newStatus: DesireStatus,
  username?: string
): Promise<void> {
  const oldDir = getDesireDir(oldStatus);
  const newDir = getDesireDir(newStatus);

  // Only move if directories are different
  if (oldDir !== newDir) {
    // Delete from old location
    await storageClient.delete({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `${oldDir}/${desire.id}.json`,
    });
  }

  // Save to new location
  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `${newDir}/${desire.id}.json`,
    data: JSON.stringify(desire, null, 2),
    encoding: 'utf8',
  });
}

/**
 * List desires by status.
 */
export async function listDesiresByStatus(
  status: DesireStatus,
  username?: string
): Promise<Desire[]> {
  const dir = getDesireDir(status);
  const result = await storageClient.list({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: dir,
  });

  if (!result.success || !result.files) {
    return [];
  }

  const desires: Desire[] = [];
  for (const file of result.files) {
    if (!file.endsWith('.json')) continue;

    const readResult = await storageClient.read({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `${dir}/${file}`,
      encoding: 'utf8',
    });

    if (readResult.success && readResult.data) {
      const desire = JSON.parse(readResult.data as string) as Desire;
      // Filter by exact status since multiple statuses share directories
      if (desire.status === status) {
        desires.push(desire);
      }
    }
  }

  return desires;
}

/**
 * List all active desires (in evaluation, planning, reviewing, etc.).
 */
export async function listActiveDesires(username?: string): Promise<Desire[]> {
  const result = await storageClient.list({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: 'desires/active',
  });

  if (!result.success || !result.files) {
    return [];
  }

  const desires: Desire[] = [];
  for (const file of result.files) {
    if (!file.endsWith('.json')) continue;

    const readResult = await storageClient.read({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `desires/active/${file}`,
      encoding: 'utf8',
    });

    if (readResult.success && readResult.data) {
      desires.push(JSON.parse(readResult.data as string) as Desire);
    }
  }

  return desires;
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
 */
export async function initializeAgencyStorage(username?: string): Promise<void> {
  const dirs = [
    'desires/nascent',
    'desires/pending',
    'desires/active',
    'desires/completed',
    'desires/rejected',
    'desires/abandoned',
    'plans',
    'reviews',
    'metrics',
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
 * Get all desires (across all statuses) for cleanup/migration.
 */
export async function listAllDesires(username?: string): Promise<Desire[]> {
  const allDesires: Desire[] = [];
  const dirs = [...new Set(Object.values(DESIRE_DIRS))];

  for (const dir of dirs) {
    const result = await storageClient.list({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: dir,
    });

    if (!result.success || !result.files) continue;

    for (const file of result.files) {
      if (!file.endsWith('.json')) continue;

      const readResult = await storageClient.read({
        username,
        category: CATEGORY,
        subcategory: SUBCATEGORY,
        relativePath: `${dir}/${file}`,
        encoding: 'utf8',
      });

      if (readResult.success && readResult.data) {
        allDesires.push(JSON.parse(readResult.data as string) as Desire);
      }
    }
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  return allDesires.filter(d => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}
