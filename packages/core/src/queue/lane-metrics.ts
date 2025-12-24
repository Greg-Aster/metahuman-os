/**
 * Lane Metrics
 *
 * Tracks throughput and performance metrics per resource lane.
 * Features:
 * - Completed tasks per lane (total and hourly)
 * - Average execution time per lane
 * - Queue wait time per lane
 * - Error rate per lane
 * - Rolling 24-hour history
 */

import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '../path-builder.js';
import { ResourceLaneId, QueuedTask } from './types.js';

// Metrics file paths
const METRICS_DIR = path.join(systemPaths.logs, 'run', 'queue');
const METRICS_FILE = path.join(METRICS_DIR, 'lane-metrics.json');

// How long to keep hourly data (24 hours)
const MAX_HISTORY_HOURS = 24;

// ============================================================================
// Types
// ============================================================================

/**
 * Metrics for a single hour bucket
 */
export interface HourlyMetrics {
  hour: string; // ISO date string truncated to hour
  completed: number;
  failed: number;
  totalDurationMs: number;
  totalWaitMs: number;
  taskCount: number;
}

/**
 * Metrics for a single lane
 */
export interface LaneMetrics {
  laneId: ResourceLaneId;
  // Lifetime totals
  totalCompleted: number;
  totalFailed: number;
  totalDurationMs: number;
  totalWaitMs: number;
  // Rolling hourly data (last 24 hours)
  hourly: HourlyMetrics[];
  // Computed averages
  avgDurationMs: number;
  avgWaitMs: number;
  errorRate: number;
  // Current hour stats
  currentHourCompleted: number;
  currentHourFailed: number;
}

/**
 * Full metrics state
 */
export interface QueueMetrics {
  lastUpdated: string;
  lanes: Record<ResourceLaneId, LaneMetrics>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get current hour bucket key
 */
function getCurrentHourKey(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now.toISOString();
}

/**
 * Ensure metrics directory exists
 */
function ensureMetricsDir(): void {
  if (!fs.existsSync(METRICS_DIR)) {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
  }
}

/**
 * Create empty lane metrics
 */
function createEmptyLaneMetrics(laneId: ResourceLaneId): LaneMetrics {
  return {
    laneId,
    totalCompleted: 0,
    totalFailed: 0,
    totalDurationMs: 0,
    totalWaitMs: 0,
    hourly: [],
    avgDurationMs: 0,
    avgWaitMs: 0,
    errorRate: 0,
    currentHourCompleted: 0,
    currentHourFailed: 0,
  };
}

/**
 * Create empty metrics state
 */
function createEmptyMetrics(): QueueMetrics {
  return {
    lastUpdated: new Date().toISOString(),
    lanes: {
      'local-llm': createEmptyLaneMetrics('local-llm'),
      'vector-index': createEmptyLaneMetrics('vector-index'),
      'remote-llm': createEmptyLaneMetrics('remote-llm'),
    },
  };
}

/**
 * Prune old hourly data (keep only last 24 hours)
 */
function pruneHourlyData(hourly: HourlyMetrics[]): HourlyMetrics[] {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - MAX_HISTORY_HOURS);
  const cutoffIso = cutoff.toISOString();

  return hourly.filter((h) => h.hour >= cutoffIso);
}

/**
 * Recalculate computed averages for a lane
 */
function recalculateAverages(lane: LaneMetrics): void {
  const total = lane.totalCompleted + lane.totalFailed;
  if (total > 0) {
    lane.avgDurationMs = lane.totalDurationMs / total;
    lane.avgWaitMs = lane.totalWaitMs / total;
    lane.errorRate = lane.totalFailed / total;
  } else {
    lane.avgDurationMs = 0;
    lane.avgWaitMs = 0;
    lane.errorRate = 0;
  }

  // Update current hour stats
  const currentHour = getCurrentHourKey();
  const currentHourData = lane.hourly.find((h) => h.hour === currentHour);
  if (currentHourData) {
    lane.currentHourCompleted = currentHourData.completed;
    lane.currentHourFailed = currentHourData.failed;
  } else {
    lane.currentHourCompleted = 0;
    lane.currentHourFailed = 0;
  }
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Load metrics from disk
 */
export function loadMetrics(): QueueMetrics {
  try {
    if (!fs.existsSync(METRICS_FILE)) {
      return createEmptyMetrics();
    }
    const data = fs.readFileSync(METRICS_FILE, 'utf-8');
    const metrics = JSON.parse(data) as QueueMetrics;

    // Prune old hourly data and recalculate
    for (const laneId of ['local-llm', 'vector-index', 'remote-llm'] as ResourceLaneId[]) {
      if (metrics.lanes[laneId]) {
        metrics.lanes[laneId].hourly = pruneHourlyData(metrics.lanes[laneId].hourly);
        recalculateAverages(metrics.lanes[laneId]);
      } else {
        metrics.lanes[laneId] = createEmptyLaneMetrics(laneId);
      }
    }

    return metrics;
  } catch (error) {
    console.error('[lane-metrics] Failed to load metrics:', error);
    return createEmptyMetrics();
  }
}

/**
 * Save metrics to disk
 */
export function saveMetrics(metrics: QueueMetrics): void {
  ensureMetricsDir();
  try {
    metrics.lastUpdated = new Date().toISOString();
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
  } catch (error) {
    console.error('[lane-metrics] Failed to save metrics:', error);
  }
}

/**
 * Clear all metrics
 */
export function clearMetrics(): void {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      fs.unlinkSync(METRICS_FILE);
    }
  } catch (error) {
    console.error('[lane-metrics] Failed to clear metrics:', error);
  }
}

// ============================================================================
// Recording Functions
// ============================================================================

/**
 * Record a completed task
 */
export function recordTaskComplete(
  laneId: ResourceLaneId,
  durationMs: number,
  waitMs: number
): void {
  const metrics = loadMetrics();
  const lane = metrics.lanes[laneId];
  const currentHour = getCurrentHourKey();

  // Update totals
  lane.totalCompleted++;
  lane.totalDurationMs += durationMs;
  lane.totalWaitMs += waitMs;

  // Update hourly bucket
  let hourBucket = lane.hourly.find((h) => h.hour === currentHour);
  if (!hourBucket) {
    hourBucket = {
      hour: currentHour,
      completed: 0,
      failed: 0,
      totalDurationMs: 0,
      totalWaitMs: 0,
      taskCount: 0,
    };
    lane.hourly.push(hourBucket);
  }

  hourBucket.completed++;
  hourBucket.totalDurationMs += durationMs;
  hourBucket.totalWaitMs += waitMs;
  hourBucket.taskCount++;

  // Prune and recalculate
  lane.hourly = pruneHourlyData(lane.hourly);
  recalculateAverages(lane);

  saveMetrics(metrics);
}

/**
 * Record a failed task
 */
export function recordTaskFailed(
  laneId: ResourceLaneId,
  durationMs: number,
  waitMs: number
): void {
  const metrics = loadMetrics();
  const lane = metrics.lanes[laneId];
  const currentHour = getCurrentHourKey();

  // Update totals
  lane.totalFailed++;
  lane.totalDurationMs += durationMs;
  lane.totalWaitMs += waitMs;

  // Update hourly bucket
  let hourBucket = lane.hourly.find((h) => h.hour === currentHour);
  if (!hourBucket) {
    hourBucket = {
      hour: currentHour,
      completed: 0,
      failed: 0,
      totalDurationMs: 0,
      totalWaitMs: 0,
      taskCount: 0,
    };
    lane.hourly.push(hourBucket);
  }

  hourBucket.failed++;
  hourBucket.totalDurationMs += durationMs;
  hourBucket.totalWaitMs += waitMs;
  hourBucket.taskCount++;

  // Prune and recalculate
  lane.hourly = pruneHourlyData(lane.hourly);
  recalculateAverages(lane);

  saveMetrics(metrics);
}

/**
 * Record task completion from a QueuedTask object
 */
export function recordTaskFromTask(task: QueuedTask, success: boolean): void {
  if (!task.startedAt || !task.queuedAt) {
    console.warn('[lane-metrics] Task missing timing data, skipping metrics');
    return;
  }

  const startedAt = new Date(task.startedAt).getTime();
  const queuedAt = new Date(task.queuedAt).getTime();
  const completedAt = Date.now();

  const durationMs = completedAt - startedAt;
  const waitMs = startedAt - queuedAt;

  if (success) {
    recordTaskComplete(task.resourceLane, durationMs, waitMs);
  } else {
    recordTaskFailed(task.resourceLane, durationMs, waitMs);
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get metrics for all lanes
 */
export function getAllLaneMetrics(): QueueMetrics {
  return loadMetrics();
}

/**
 * Get metrics for a single lane
 */
export function getLaneMetrics(laneId: ResourceLaneId): LaneMetrics {
  const metrics = loadMetrics();
  return metrics.lanes[laneId];
}

/**
 * Get throughput for the last N hours
 */
export function getThroughputHistory(
  laneId: ResourceLaneId,
  hours: number = 24
): { hour: string; completed: number; failed: number }[] {
  const lane = getLaneMetrics(laneId);
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  const cutoffIso = cutoff.toISOString();

  return lane.hourly
    .filter((h) => h.hour >= cutoffIso)
    .map((h) => ({
      hour: h.hour,
      completed: h.completed,
      failed: h.failed,
    }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
}

/**
 * Get summary statistics for the last hour
 */
export function getLastHourSummary(): {
  totalCompleted: number;
  totalFailed: number;
  byLane: Record<ResourceLaneId, { completed: number; failed: number }>;
} {
  const metrics = loadMetrics();
  const currentHour = getCurrentHourKey();

  const result = {
    totalCompleted: 0,
    totalFailed: 0,
    byLane: {} as Record<ResourceLaneId, { completed: number; failed: number }>,
  };

  for (const laneId of ['local-llm', 'vector-index', 'remote-llm'] as ResourceLaneId[]) {
    const lane = metrics.lanes[laneId];
    const hourData = lane.hourly.find((h) => h.hour === currentHour);

    const completed = hourData?.completed || 0;
    const failed = hourData?.failed || 0;

    result.byLane[laneId] = { completed, failed };
    result.totalCompleted += completed;
    result.totalFailed += failed;
  }

  return result;
}

/**
 * Get average execution time for the last hour
 */
export function getLastHourAvgDuration(laneId: ResourceLaneId): number {
  const lane = getLaneMetrics(laneId);
  const currentHour = getCurrentHourKey();
  const hourData = lane.hourly.find((h) => h.hour === currentHour);

  if (!hourData || hourData.taskCount === 0) {
    return 0;
  }

  return hourData.totalDurationMs / hourData.taskCount;
}
