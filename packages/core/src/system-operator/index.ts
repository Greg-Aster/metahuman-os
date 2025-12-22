/**
 * System Operator Module
 *
 * Provides high-confidence automated maintenance skills.
 * Part of Phase 5: Voice Agent + System Operator
 *
 * Features:
 * - Automated backups with retention policies
 * - Housekeeping (log rotation, temp cleanup, stale locks)
 * - Index maintenance and optimization
 * - Ingestion QA and memory health checks
 * - Safety invariants (diff-preview, rollback, rate limits, anomaly detection)
 */

// Types
export * from './types.js';

// Skills
export * from './backup.js';
export * from './housekeeping.js';
export * from './index-maintenance.js';
export * from './ingestion-qa.js';
export * from './safety-invariants.js';

// Re-export main functions for convenience
export { createBackup, listBackups, pruneBackups, restoreBackup } from './backup.js';
export { runHousekeeping, getDiskUsage } from './housekeeping.js';
export { runIndexMaintenance, checkIndexHealth, getIndexStatistics } from './index-maintenance.js';
export { runIngestionQA, getIngestionHealth, cleanupDuplicates } from './ingestion-qa.js';
export {
  createDiffPreview,
  getDiffPreview,
  createRollbackPoint,
  executeRollback,
  listRollbackPoints,
  checkRateLimit,
  recordOperation,
  getRateLimitStatus,
  detectAnomaly,
  getAnomalyReports,
  acknowledgeAnomaly,
  getSystemSafetySummary,
} from './safety-invariants.js';
