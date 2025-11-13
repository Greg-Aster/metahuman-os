/**
 * Memory Metrics Cache
 *
 * Workstream B1-B3 from memory-continuity-performance-directive.md
 *
 * Provides stale-but-fast memory metrics by computing them in background
 * and serving from cache. Avoids expensive filesystem walks on every request.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { paths, getProfilePaths } from './paths.js';
import { audit } from './audit.js';
import { readdirSync, existsSync, readFileSync, statSync } from 'fs';
import { getIndexStatus } from './vector-index.js';

type ProfilePaths = ReturnType<typeof getProfilePaths>;

export interface MemoryMetrics {
  totalMemories: number;
  memoriesByType: Record<string, number>;
  vectorIndexCoverage: number; // Percentage of memories with embeddings
  lastCaptureTimestamp: string;
  conversationSummaries: number;
  recentToolInvocations: number;
  recentFileOperations: number;
  memoryGrowthRate: number; // Memories per day (last 7 days)
  lastUpdated: string;
  computationTimeMs: number;
}

const CACHE_FILE_NAME = 'memory-metrics.json';
const CACHE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

export interface MemoryMetricsOptions {
  forceFresh?: boolean;
  profilePaths?: ProfilePaths;
  profileName?: string;
}

/**
 * Get the cache file path for a user profile
 */
function getCacheFilePath(profilePaths: ProfilePaths): string {
  return path.join(profilePaths.state, CACHE_FILE_NAME);
}

/**
 * B1: Compute memory metrics for a user profile
 * Walks filesystem to count events by type and calculate coverage metrics
 */
export async function computeMemoryMetrics(
  profilePaths: ProfilePaths,
  profileName: string
): Promise<MemoryMetrics> {
  const startTime = Date.now();

  const profilePath = profilePaths.root;
  const episodicPath = profilePaths.episodic;
  const indexStatus = getIndexStatus();

  let totalMemories = 0;
  const memoriesByType: Record<string, number> = {
    conversation: 0,
    chat: 0,
    inner_dialogue: 0,
    reflection: 0,
    observation: 0,
    dream: 0,
    action: 0,
    journal: 0,
    summary: 0,
    tool_invocation: 0,
    file_read: 0,
    file_write: 0,
    unknown: 0,
  };
  let lastCaptureTimestamp = '';
  let recentToolInvocations = 0;
  let recentFileOperations = 0;
  let conversationSummaries = 0;
  const memoryTimestamps: string[] = [];

  // Scan episodic directory
  if (existsSync(episodicPath)) {
    try {
      const yearDirs = readdirSync(episodicPath);

      for (const year of yearDirs) {
        const yearPath = path.join(episodicPath, year);
        const stats = statSync(yearPath);

        if (!stats.isDirectory()) continue;

        const files = readdirSync(yearPath).filter(f => f.endsWith('.json'));

        for (const file of files) {
          const filepath = path.join(yearPath, file);
          try {
            const content = readFileSync(filepath, 'utf-8');
            const event = JSON.parse(content);

            totalMemories++;

            // Count by type
            const type = event.type || 'unknown';
            memoriesByType[type] = (memoriesByType[type] || 0) + 1;

            // Count summaries
            if (type === 'summary') {
              conversationSummaries++;
            }

            // Track timestamps
            if (event.timestamp) {
              memoryTimestamps.push(event.timestamp);

              // Recent tool invocations (last 24 hours)
              const ageMs = Date.now() - new Date(event.timestamp).getTime();
              if (type === 'tool_invocation' && ageMs < 86400000) {
                recentToolInvocations++;
              }

              // Recent file operations (last 24 hours)
              if ((type === 'file_read' || type === 'file_write') && ageMs < 86400000) {
                recentFileOperations++;
              }

              // Update last capture
              if (!lastCaptureTimestamp || event.timestamp > lastCaptureTimestamp) {
                lastCaptureTimestamp = event.timestamp;
              }
            }
          } catch (error) {
            // Skip malformed files
            continue;
          }
        }
      }
    } catch (error) {
      audit({
        level: 'warn',
        category: 'system',
        event: 'memory_metrics_episodic_scan_failed',
        details: { profile: profileName, error: (error as Error).message },
        actor: 'system',
      });
    }
  }

  // Calculate vector index coverage
  const indexedItems = (indexStatus as any).items ?? (indexStatus as any).count ?? 0;
  const vectorIndexCoverage = indexStatus.exists && totalMemories > 0
    ? Math.round((indexedItems / totalMemories) * 100)
    : 0;

  // Calculate memory growth rate (last 7 days)
  const sevenDaysAgo = Date.now() - (7 * 86400000);
  const recentMemories = memoryTimestamps.filter(ts => {
    try {
      return new Date(ts).getTime() > sevenDaysAgo;
    } catch {
      return false;
    }
  });
  const memoryGrowthRate = Math.round(recentMemories.length / 7 * 10) / 10; // Per day

  const computationTimeMs = Date.now() - startTime;

  const metrics: MemoryMetrics = {
    totalMemories,
    memoriesByType,
    vectorIndexCoverage,
    lastCaptureTimestamp,
    conversationSummaries,
    recentToolInvocations,
    recentFileOperations,
    memoryGrowthRate,
    lastUpdated: new Date().toISOString(),
    computationTimeMs,
  };

  return metrics;
}

/**
 * B2: Write metrics to cache file (async, non-blocking)
 */
export async function writeMetricsToCache(
  profilePaths: ProfilePaths,
  profileName: string,
  metrics: MemoryMetrics
): Promise<void> {
  try {
    const cacheFile = getCacheFilePath(profilePaths);
    const cacheDir = path.dirname(cacheFile);

    // Ensure state directory exists
    await fs.mkdir(cacheDir, { recursive: true });

    // Write cache file
    await fs.writeFile(cacheFile, JSON.stringify(metrics, null, 2));

    audit({
      level: 'info',
      category: 'system',
      event: 'memory_metrics_cache_updated',
      details: {
        profile: profileName,
        metrics,
      },
      actor: 'system',
    });
  } catch (error) {
    audit({
      level: 'warn',
      category: 'system',
      event: 'memory_metrics_cache_write_failed',
      details: {
        profile: profileName,
        error: (error as Error).message,
      },
      actor: 'system',
    });
  }
}

/**
 * B3: Read metrics from cache (stale-but-fast)
 * Returns cached metrics if available, otherwise computes fresh metrics
 */
export async function readMetricsFromCache(
  profilePaths: ProfilePaths,
  profileName: string
): Promise<MemoryMetrics | null> {
  const cacheFile = getCacheFilePath(profilePaths);

  try {
    const exists = fsSync.existsSync(cacheFile);
    if (!exists) {
      // Cache miss - return null to trigger fresh computation
      audit({
        level: 'info',
        category: 'system',
        event: 'memory_metrics_cache_miss',
        details: { profile: profileName, reason: 'cache_file_not_found' },
        actor: 'system',
      });
      return null;
    }

    const content = await fs.readFile(cacheFile, 'utf-8');
    const metrics = JSON.parse(content) as MemoryMetrics;

    return metrics;
  } catch (error) {
    audit({
      level: 'warn',
      category: 'system',
      event: 'memory_metrics_cache_read_failed',
      details: {
        profile: profileName,
        error: (error as Error).message,
      },
      actor: 'system',
    });
    return null;
  }
}

/**
 * B2: Update cache in background for a user
 * (Can be called from a background service or cron job)
 */
export async function updateMetricsCache(
  username: string,
  options: { profilePaths?: ProfilePaths; profileName?: string } = {}
): Promise<void> {
  try {
    const profilePaths = options.profilePaths ?? getProfilePaths(username);
    const profileName = options.profileName ?? path.basename(profilePaths.root);
    const metrics = await computeMemoryMetrics(profilePaths, profileName);
    await writeMetricsToCache(profilePaths, profileName, metrics);
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'memory_metrics_cache_update_failed',
      details: {
        profile: options.profileName ?? username,
        error: (error as Error).message,
      },
      actor: 'system',
    });
  }
}

/**
 * B3: Get memory metrics with cache-first strategy
 * Returns cached metrics if fresh (< 5 minutes old), otherwise recomputes
 */
export async function getMemoryMetrics(
  username: string,
  options: MemoryMetricsOptions = {}
): Promise<MemoryMetrics> {
  const profilePaths = options.profilePaths ?? getProfilePaths(username);
  const profileName = options.profileName ?? path.basename(profilePaths.root);

  // Check cache first (unless forceFresh)
  if (!options.forceFresh) {
    const cached = await readMetricsFromCache(profilePaths, profileName);
    if (cached) {
      const cacheAge = Date.now() - new Date(cached.lastUpdated).getTime();

      // Serve from cache if < 5 minutes old
      if (cacheAge < CACHE_UPDATE_INTERVAL) {
        return cached;
      }
    }
  }

  // Cache miss or stale - compute fresh metrics
  const metrics = await computeMemoryMetrics(profilePaths, profileName);

  // Update cache in background (fire-and-forget)
  void writeMetricsToCache(profilePaths, profileName, metrics).catch(() => {});

  return metrics;
}

/**
 * Invalidate metrics cache for a user
 * (Call when memory changes significantly, e.g., bulk delete)
 */
export async function invalidateMetricsCache(
  profilePaths: ProfilePaths,
  profileName: string
): Promise<void> {
  const cacheFile = getCacheFilePath(profilePaths);

  try {
    await fs.unlink(cacheFile);

    audit({
      level: 'info',
      category: 'system',
      event: 'memory_metrics_cache_invalidated',
      details: { profile: profileName },
      actor: 'system',
    });
  } catch (error) {
    // File may not exist - that's fine
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      audit({
        level: 'warn',
        category: 'system',
        event: 'memory_metrics_cache_invalidation_failed',
        details: {
          profile: profileName,
          error: (error as Error).message,
        },
        actor: 'system',
      });
    }
  }
}
