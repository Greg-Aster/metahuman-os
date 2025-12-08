/**
 * Drift Storage Module
 *
 * Handles persistence of drift reports and metrics using the centralized
 * storage router. Reports are stored per-user in their profile directory.
 */

import { storageClient } from '../storage-client.js';
import type {
  DriftReport,
  DriftConfig,
  DriftMetricsSummary,
} from './types.js';
import { DEFAULT_DRIFT_CONFIG, driftToAccuracy } from './types.js';

// ============================================================================
// Constants
// ============================================================================

// Drift data is stored under state/drift/
const CATEGORY = 'state' as const;
const SUBCATEGORY = 'drift' as const;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Load drift configuration for a user.
 */
export async function loadDriftConfig(username: string): Promise<DriftConfig> {
  try {
    const result = await storageClient.read({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: 'config.json',
    });

    if (result.success && result.data) {
      const parsed = JSON.parse(result.data as string) as Partial<DriftConfig>;
      return { ...DEFAULT_DRIFT_CONFIG, ...parsed };
    }
  } catch (error) {
    console.error(`[drift-storage] Error loading config for ${username}:`, error);
  }

  return DEFAULT_DRIFT_CONFIG;
}

/**
 * Save drift configuration for a user.
 */
export async function saveDriftConfig(username: string, config: Partial<DriftConfig>): Promise<void> {
  const fullConfig = { ...DEFAULT_DRIFT_CONFIG, ...config };

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: 'config.json',
    data: JSON.stringify(fullConfig, null, 2),
  });
}

// ============================================================================
// Reports
// ============================================================================

/**
 * Save a drift report.
 */
export async function saveDriftReport(username: string, report: DriftReport): Promise<void> {
  const filename = `${report.id}.json`;

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: `reports/${filename}`,
    data: JSON.stringify(report, null, 2),
  });

  // Update summary after saving report
  await updateSummary(username, report);
}

/**
 * Load a specific drift report.
 */
export async function loadDriftReport(username: string, reportId: string): Promise<DriftReport | null> {
  try {
    const result = await storageClient.read({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: `reports/${reportId}.json`,
    });

    if (result.success && result.data) {
      return JSON.parse(result.data as string) as DriftReport;
    }
  } catch (error) {
    console.error(`[drift-storage] Error loading report ${reportId}:`, error);
  }

  return null;
}

/**
 * List all drift reports for a user.
 */
export async function listDriftReports(
  username: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ reports: DriftReport[]; total: number }> {
  const { limit = 20, offset = 0 } = options;

  try {
    const result = await storageClient.list({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: 'reports',
    });

    if (!result.success || !result.files) {
      return { reports: [], total: 0 };
    }

    const files = result.files
      .filter((f: string) => f.endsWith('.json'))
      .sort((a: string, b: string) => b.localeCompare(a)); // Newest first

    const total = files.length;
    const selected = files.slice(offset, offset + limit);

    const reports: DriftReport[] = [];
    for (const file of selected) {
      try {
        const readResult = await storageClient.read({
          username,
          category: CATEGORY,
          subcategory: SUBCATEGORY,
          relativePath: `reports/${file}`,
        });

        if (readResult.success && readResult.data) {
          reports.push(JSON.parse(readResult.data as string) as DriftReport);
        }
      } catch (error) {
        console.error(`[drift-storage] Error reading report ${file}:`, error);
      }
    }

    return { reports, total };
  } catch (error) {
    console.error(`[drift-storage] Error listing reports:`, error);
    return { reports: [], total: 0 };
  }
}

/**
 * Get the most recent drift report.
 */
export async function getLatestDriftReport(username: string): Promise<DriftReport | null> {
  const { reports } = await listDriftReports(username, { limit: 1 });
  return reports[0] || null;
}

/**
 * Delete old drift reports (retention policy).
 */
export async function cleanupOldReports(username: string, retentionDays: number = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const { reports } = await listDriftReports(username, { limit: 1000 });
  let deleted = 0;

  for (const report of reports) {
    const reportDate = new Date(report.generatedAt);
    if (reportDate < cutoffDate) {
      try {
        await storageClient.delete({
          username,
          category: CATEGORY,
          subcategory: SUBCATEGORY,
          relativePath: `reports/${report.id}.json`,
        });
        deleted++;
      } catch (error) {
        console.error(`[drift-storage] Error deleting report ${report.id}:`, error);
      }
    }
  }

  return deleted;
}

// ============================================================================
// Summary
// ============================================================================

/**
 * Load drift metrics summary.
 */
export async function loadDriftSummary(username: string): Promise<DriftMetricsSummary | null> {
  try {
    const result = await storageClient.read({
      username,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      relativePath: 'summary.json',
    });

    if (result.success && result.data) {
      return JSON.parse(result.data as string) as DriftMetricsSummary;
    }
  } catch (error) {
    console.error(`[drift-storage] Error loading summary for ${username}:`, error);
  }

  return null;
}

/**
 * Update summary after new report.
 */
async function updateSummary(username: string, report: DriftReport): Promise<void> {
  const existing = await loadDriftSummary(username);

  // Calculate strongest/weakest dimensions
  const dimensions = report.analysis.dimensions;
  const dimensionList = Object.entries(dimensions)
    .filter(([, v]) => v !== undefined)
    .map(([name, metrics]) => ({
      name,
      accuracy: driftToAccuracy(1 - (metrics?.similarity || 0.5)),
    }))
    .sort((a, b) => b.accuracy - a.accuracy);

  const strongestDimensions = dimensionList.slice(0, 3);
  const weakestDimensions = dimensionList.slice(-3).reverse();

  // Calculate accuracy change
  const previousAccuracy = existing?.currentAccuracy || report.analysis.accuracyPercent;
  const accuracyChange = report.analysis.accuracyPercent - previousAccuracy;

  const summary: DriftMetricsSummary = {
    currentAccuracy: report.analysis.accuracyPercent,
    accuracyChange,
    trend: report.analysis.trend,
    strongestDimensions,
    weakestDimensions,
    lastAnalyzedAt: report.generatedAt,
    totalExchangesAnalyzed: (existing?.totalExchangesAnalyzed || 0) + report.analysis.exchangeCount,
    reportCount: (existing?.reportCount || 0) + 1,
  };

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: 'summary.json',
    data: JSON.stringify(summary, null, 2),
  });
}

/**
 * Initialize empty summary.
 */
export async function initializeSummary(username: string): Promise<DriftMetricsSummary> {
  const summary: DriftMetricsSummary = {
    currentAccuracy: 0,
    accuracyChange: 0,
    trend: 'unknown',
    strongestDimensions: [],
    weakestDimensions: [],
    lastAnalyzedAt: new Date().toISOString(),
    totalExchangesAnalyzed: 0,
    reportCount: 0,
  };

  await storageClient.write({
    username,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    relativePath: 'summary.json',
    data: JSON.stringify(summary, null, 2),
  });

  return summary;
}

// ============================================================================
// Historical Data
// ============================================================================

/**
 * Get drift history for trending/charts.
 */
export async function getDriftHistory(
  username: string,
  days: number = 30
): Promise<Array<{ date: string; accuracy: number; exchangeCount: number }>> {
  const { reports } = await listDriftReports(username, { limit: 100 });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return reports
    .filter(r => new Date(r.generatedAt) >= cutoffDate)
    .map(r => ({
      date: r.generatedAt.split('T')[0],
      accuracy: r.analysis.accuracyPercent,
      exchangeCount: r.analysis.exchangeCount,
    }))
    .reverse(); // Oldest first for charts
}

/**
 * Get dimension trends over time.
 */
export async function getDimensionTrends(
  username: string,
  dimension: string,
  days: number = 30
): Promise<Array<{ date: string; similarity: number }>> {
  const { reports } = await listDriftReports(username, { limit: 100 });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return reports
    .filter(r => new Date(r.generatedAt) >= cutoffDate)
    .map(r => {
      const dimMetrics = r.analysis.dimensions[dimension as keyof typeof r.analysis.dimensions];
      return {
        date: r.generatedAt.split('T')[0],
        similarity: dimMetrics?.similarity || 0.5,
      };
    })
    .reverse();
}
