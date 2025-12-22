/**
 * System Operator API Handlers
 *
 * Endpoints for system maintenance operations.
 * Part of Phase 5: Voice Agent + System Operator
 *
 * POST /api/system-operator/backup - Create a backup
 * GET /api/system-operator/backups - List backups
 * DELETE /api/system-operator/backups/:name - Delete a backup
 * POST /api/system-operator/backup/restore - Restore a backup (preview or execute)
 * POST /api/system-operator/housekeeping - Run housekeeping
 * GET /api/system-operator/disk-usage - Get disk usage stats
 * POST /api/system-operator/index-maintenance - Run index maintenance
 * GET /api/system-operator/index-health - Check index health
 * GET /api/system-operator/index-stats - Get index statistics
 * POST /api/system-operator/ingestion-qa - Run ingestion QA checks
 * GET /api/system-operator/ingestion-health - Get ingestion health summary
 * POST /api/system-operator/cleanup-duplicates - Clean up duplicate memories
 * GET /api/system-operator/rollback-points - List available rollback points
 * POST /api/system-operator/rollback - Execute a rollback
 * GET /api/system-operator/rate-limits - Get rate limit status
 * GET /api/system-operator/anomalies - Get anomaly reports
 * POST /api/system-operator/anomalies/:id/acknowledge - Acknowledge an anomaly
 * GET /api/system-operator/safety-summary - Get overall safety summary
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  createBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  runHousekeeping,
  getDiskUsage,
  runIndexMaintenance,
  checkIndexHealth,
  getIndexStatistics,
  runIngestionQA,
  getIngestionHealth,
  cleanupDuplicates,
  listRollbackPoints,
  executeRollback,
  getRateLimitStatus,
  getAnomalyReports,
  acknowledgeAnomaly,
  getSystemSafetySummary,
  type BackupOptions,
  type HousekeepingOptions,
  type IndexMaintenanceOptions,
  type IngestionQAOptions,
} from '../../system-operator/index.js';
import { audit } from '../../audit.js';

/**
 * POST /api/system-operator/backup
 * Create a backup of the user's profile
 */
export async function handleCreateBackup(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as Partial<BackupOptions> | undefined;

    const options: BackupOptions = {
      username: req.user.username,
      compress: body?.compress ?? true,
      includeMemories: body?.includeMemories ?? true,
      includePersona: body?.includePersona ?? true,
      includeTasks: body?.includeTasks ?? true,
      includeConfig: body?.includeConfig ?? true,
      includeState: body?.includeState ?? true,
    };

    const result = await createBackup(options);

    audit({
      category: 'action',
      level: 'info',
      event: 'backup_created_api',
      actor: req.user.username,
      details: {
        backupPath: result.details.backupPath,
        filesBackedUp: result.details.filesBackedUp,
        totalSize: result.details.totalSize,
      },
    });

    return successResponse({
      success: result.success,
      result,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/backups
 * List available backups
 */
export async function handleListBackups(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const allUsers = req.query?.all === 'true' && req.user.role === 'owner';
    const backups = listBackups(allUsers ? undefined : req.user.username);

    return successResponse({
      success: true,
      backups,
      count: backups.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * DELETE /api/system-operator/backups/:name
 * Delete a backup (or prune old backups)
 */
export async function handleDeleteBackup(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { keepCount?: number } | undefined;
    const keepCount = body?.keepCount ?? 7;

    const deleted = pruneBackups(req.user.username, keepCount);

    audit({
      category: 'action',
      level: 'info',
      event: 'backups_pruned_api',
      actor: req.user.username,
      details: { deleted, keepCount },
    });

    return successResponse({
      success: true,
      deleted,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/system-operator/backup/restore
 * Restore a backup (preview or execute)
 */
export async function handleRestoreBackup(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { backupPath: string; dryRun?: boolean } | undefined;

    if (!body?.backupPath) {
      return badRequestResponse('backupPath is required');
    }

    const result = restoreBackup(
      body.backupPath,
      req.user.username,
      body.dryRun ?? true
    );

    if (!body.dryRun) {
      audit({
        category: 'action',
        level: 'info',
        event: 'backup_restored_api',
        actor: req.user.username,
        details: {
          backupPath: body.backupPath,
          filesRestored: result.filesRestored,
        },
      });
    }

    return successResponse({
      success: result.success,
      filesRestored: result.filesRestored,
      errors: result.errors,
      dryRun: body.dryRun ?? true,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/system-operator/housekeeping
 * Run housekeeping operations
 */
export async function handleRunHousekeeping(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as Partial<HousekeepingOptions> | undefined;

    const options: HousekeepingOptions = {
      maxLogAgeDays: body?.maxLogAgeDays ?? 30,
      maxTempAgeDays: body?.maxTempAgeDays ?? 7,
      cleanLogs: body?.cleanLogs ?? true,
      cleanTemp: body?.cleanTemp ?? true,
      cleanCache: body?.cleanCache ?? true,
      cleanStaleLocks: body?.cleanStaleLocks ?? true,
      dryRun: body?.dryRun ?? false,
    };

    const result = await runHousekeeping(options);

    if (!options.dryRun) {
      audit({
        category: 'action',
        level: 'info',
        event: 'housekeeping_api',
        actor: req.user.username,
        details: result.details,
      });
    }

    return successResponse({
      success: result.success,
      result,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/disk-usage
 * Get disk usage statistics
 */
export async function handleGetDiskUsage(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const usage = getDiskUsage();

    return successResponse({
      success: true,
      usage,
      formatted: {
        logs: formatBytes(usage.logs),
        temp: formatBytes(usage.temp),
        cache: formatBytes(usage.cache),
        total: formatBytes(usage.total),
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/system-operator/index-maintenance
 * Run index maintenance
 */
export async function handleRunIndexMaintenance(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as Partial<IndexMaintenanceOptions> | undefined;

    const options: IndexMaintenanceOptions = {
      username: req.user.username,
      model: body?.model,
      forceRebuild: body?.forceRebuild ?? false,
      rebuildThreshold: body?.rebuildThreshold ?? 20,
      removeOrphans: body?.removeOrphans ?? true,
      dryRun: body?.dryRun ?? false,
    };

    const result = await runIndexMaintenance(options);

    if (!options.dryRun) {
      audit({
        category: 'action',
        level: 'info',
        event: 'index_maintenance_api',
        actor: req.user.username,
        details: result.details,
      });
    }

    return successResponse({
      success: result.success,
      result,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/index-health
 * Check index health
 */
export async function handleCheckIndexHealth(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const model = req.query?.model;
    const health = checkIndexHealth(req.user.username, model);

    return successResponse({
      success: true,
      health,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/index-stats
 * Get index statistics
 */
export async function handleGetIndexStats(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const model = req.query?.model;
    const stats = getIndexStatistics(req.user.username, model);

    return successResponse({
      success: true,
      stats,
      formatted: {
        fileSize: formatBytes(stats.fileSizeBytes),
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/system-operator/ingestion-qa
 * Run ingestion QA checks
 */
export async function handleRunIngestionQA(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as Partial<IngestionQAOptions> | undefined;

    const options: IngestionQAOptions = {
      username: req.user.username,
      autoRepair: body?.autoRepair ?? false,
      checkDuplicates: body?.checkDuplicates ?? true,
      checkContamination: body?.checkContamination ?? true,
      dryRun: body?.dryRun ?? false,
    };

    const result = await runIngestionQA(options);

    if (!options.dryRun) {
      audit({
        category: 'action',
        level: 'info',
        event: 'ingestion_qa_api',
        actor: req.user.username,
        details: {
          totalChecked: result.details.totalChecked,
          issuesFound: result.details.issuesFound,
          repaired: result.details.repaired,
        },
      });
    }

    return successResponse({
      success: result.success,
      result,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/ingestion-health
 * Get quick ingestion health summary
 */
export async function handleGetIngestionHealth(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const health = getIngestionHealth(req.user.username);

    return successResponse({
      success: true,
      health,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/system-operator/cleanup-duplicates
 * Clean up duplicate memories
 */
export async function handleCleanupDuplicates(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { dryRun?: boolean } | undefined;
    const dryRun = body?.dryRun ?? true;

    const result = cleanupDuplicates(req.user.username, dryRun);

    if (!dryRun && result.removed > 0) {
      audit({
        category: 'action',
        level: 'info',
        event: 'duplicates_cleanup_api',
        actor: req.user.username,
        details: {
          removed: result.removed,
        },
      });
    }

    return successResponse({
      success: true,
      removed: result.removed,
      files: result.files,
      dryRun,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

// ============================================================================
// Safety Invariants API Handlers
// ============================================================================

/**
 * GET /api/system-operator/rollback-points
 * List available rollback points
 */
export async function handleListRollbackPoints(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const points = listRollbackPoints(req.user.username);

    return successResponse({
      success: true,
      rollbackPoints: points,
      count: points.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/system-operator/rollback
 * Execute a rollback
 */
export async function handleExecuteRollback(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { rollbackId: string } | undefined;

    if (!body?.rollbackId) {
      return badRequestResponse('rollbackId is required');
    }

    const result = executeRollback(body.rollbackId, req.user.username);

    return successResponse({
      success: result.success,
      restored: result.restored,
      errors: result.errors,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/rate-limits
 * Get rate limit status for the user
 */
export async function handleGetRateLimits(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const status = getRateLimitStatus(req.user.username);

    return successResponse({
      success: true,
      rateLimits: status,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/anomalies
 * Get anomaly reports
 */
export async function handleGetAnomalies(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const unacknowledgedOnly = req.query?.unacknowledged === 'true';
    const severity = req.query?.severity;

    const reports = getAnomalyReports({
      unacknowledgedOnly,
      severity,
    });

    return successResponse({
      success: true,
      anomalies: reports,
      count: reports.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/system-operator/anomalies/:id/acknowledge
 * Acknowledge an anomaly
 */
export async function handleAcknowledgeAnomaly(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // Extract anomaly ID from path
    const pathMatch = req.path.match(/\/anomalies\/([^\/]+)\/acknowledge/);
    const anomalyId = pathMatch?.[1];

    if (!anomalyId) {
      return badRequestResponse('Anomaly ID is required');
    }

    const success = acknowledgeAnomaly(anomalyId, req.user.username);

    if (!success) {
      return errorResponse('Anomaly not found', 404);
    }

    return successResponse({
      success: true,
      acknowledged: anomalyId,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/system-operator/safety-summary
 * Get overall safety summary
 */
export async function handleGetSafetySummary(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const summary = getSystemSafetySummary(req.user.username);

    return successResponse({
      success: true,
      ...summary,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}
