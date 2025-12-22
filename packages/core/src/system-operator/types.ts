/**
 * System Operator Types
 *
 * Type definitions for the system operator module.
 * Part of Phase 5: Voice Agent + System Operator
 */

export type OperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type OperationType =
  | 'backup'
  | 'housekeeping'
  | 'index_maintenance'
  | 'ingestion_qa'
  | 'log_rotation'
  | 'audit_cleanup';

export interface OperationResult {
  success: boolean;
  operation: OperationType;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  details: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export interface BackupResult extends OperationResult {
  operation: 'backup';
  details: {
    backupPath: string;
    filesBackedUp: number;
    totalSize: number;
    profile: string;
  };
}

export interface HousekeepingResult extends OperationResult {
  operation: 'housekeeping';
  details: {
    logsRotated: number;
    tempFilesRemoved: number;
    cacheCleared: number;
    spaceReclaimed: number;
    staleLocksRemoved: number;
  };
}

export interface IndexMaintenanceResult extends OperationResult {
  operation: 'index_maintenance';
  details: {
    indexesRebuild: string[];
    memoriesReindexed: number;
    orphanedEntriesRemoved: number;
    indexSize: number;
  };
}

export interface IngestionQAResult extends OperationResult {
  operation: 'ingestion_qa';
  details: {
    totalChecked: number;
    issuesFound: number;
    repaired: number;
    unrepairable: number;
    duplicatesFound: number;
    contaminationFound: number;
    issues: Array<{
      filePath: string;
      memoryId: string;
      issueType: 'malformed_json' | 'missing_field' | 'invalid_value' | 'contamination' | 'duplicate' | 'orphan';
      severity: 'error' | 'warning' | 'info';
      description: string;
      autoRepairable: boolean;
      repairAction?: string;
    }>;
  };
}

export interface ScheduledOperation {
  id: string;
  operation: OperationType;
  scheduledFor: string;
  status: OperationStatus;
  options: Record<string, unknown>;
  result?: OperationResult;
  error?: string;
}

export interface SystemOperatorConfig {
  enabled: boolean;
  autoBackup: {
    enabled: boolean;
    intervalHours: number;
    keepCount: number;
    compress: boolean;
  };
  autoHousekeeping: {
    enabled: boolean;
    intervalHours: number;
    maxLogAgeDays: number;
    maxTempAgeDays: number;
  };
  autoIndexMaintenance: {
    enabled: boolean;
    intervalHours: number;
    rebuildThreshold: number; // % of stale entries
  };
  ingestionQA: {
    enabled: boolean;
    intervalHours: number;
    autoFix: boolean;
  };
}

export const DEFAULT_CONFIG: SystemOperatorConfig = {
  enabled: true,
  autoBackup: {
    enabled: true,
    intervalHours: 24,
    keepCount: 7,
    compress: true,
  },
  autoHousekeeping: {
    enabled: true,
    intervalHours: 6,
    maxLogAgeDays: 30,
    maxTempAgeDays: 7,
  },
  autoIndexMaintenance: {
    enabled: true,
    intervalHours: 12,
    rebuildThreshold: 20,
  },
  ingestionQA: {
    enabled: false,
    intervalHours: 24,
    autoFix: false,
  },
};
