/**
 * Safety Invariants Module
 *
 * Provides safety mechanisms for system operations:
 * - Diff-preview for mutations (show what will change before executing)
 * - Rollback capability (undo recent operations)
 * - Rate limiting (prevent runaway operations)
 * - Anomaly detection (flag unusual activity)
 *
 * Part of Phase 5: Voice Agent + System Operator
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths, systemPaths } from '../paths.js';
import { audit } from '../audit.js';

// ============================================================================
// Types
// ============================================================================

export interface DiffPreview {
  operationId: string;
  operationType: string;
  timestamp: string;
  changes: DiffChange[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  estimatedImpact: string;
  requiresApproval: boolean;
}

export interface DiffChange {
  type: 'create' | 'modify' | 'delete' | 'move';
  path: string;
  before?: string | object;
  after?: string | object;
  sizeDelta?: number;
}

export interface RollbackPoint {
  id: string;
  operationType: string;
  timestamp: string;
  username: string;
  changes: RollbackChange[];
  expiresAt: string;
}

export interface RollbackChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  originalContent?: string;
  originalExists: boolean;
}

export interface RateLimitConfig {
  windowMs: number;
  maxOperations: number;
  operationType: string;
}

export interface RateLimitState {
  operationType: string;
  windowStart: number;
  count: number;
}

export interface AnomalyReport {
  id: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  type: string;
  description: string;
  details: Record<string, unknown>;
  acknowledged: boolean;
}

// ============================================================================
// Diff Preview
// ============================================================================

const diffPreviewCache = new Map<string, DiffPreview>();

/**
 * Create a diff preview for a file operation.
 */
export function createDiffPreview(
  operationType: string,
  changes: Array<{
    type: 'create' | 'modify' | 'delete' | 'move';
    path: string;
    newContent?: string | object;
  }>
): DiffPreview {
  const operationId = `diff-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const diffChanges: DiffChange[] = [];

  for (const change of changes) {
    const diffChange: DiffChange = {
      type: change.type,
      path: change.path,
    };

    // Read current content if file exists
    if (fs.existsSync(change.path)) {
      try {
        const stat = fs.statSync(change.path);
        const content = fs.readFileSync(change.path, 'utf-8');
        diffChange.before = content.length > 1000
          ? content.substring(0, 1000) + '... (truncated)'
          : content;

        if (change.newContent) {
          const newContentStr = typeof change.newContent === 'string'
            ? change.newContent
            : JSON.stringify(change.newContent, null, 2);
          diffChange.after = newContentStr.length > 1000
            ? newContentStr.substring(0, 1000) + '... (truncated)'
            : newContentStr;
          diffChange.sizeDelta = newContentStr.length - stat.size;
        }
      } catch {
        diffChange.before = '[Unable to read]';
      }
    } else if (change.newContent) {
      const newContentStr = typeof change.newContent === 'string'
        ? change.newContent
        : JSON.stringify(change.newContent, null, 2);
      diffChange.after = newContentStr.length > 1000
        ? newContentStr.substring(0, 1000) + '... (truncated)'
        : newContentStr;
      diffChange.sizeDelta = newContentStr.length;
    }

    diffChanges.push(diffChange);
  }

  // Calculate risk level
  const riskLevel = calculateRiskLevel(operationType, diffChanges);

  const preview: DiffPreview = {
    operationId,
    operationType,
    timestamp: new Date().toISOString(),
    changes: diffChanges,
    riskLevel,
    estimatedImpact: generateImpactSummary(diffChanges),
    requiresApproval: riskLevel === 'high' || riskLevel === 'critical',
  };

  // Cache for later execution
  diffPreviewCache.set(operationId, preview);

  // Clean old previews (keep last 50)
  if (diffPreviewCache.size > 50) {
    const keys = Array.from(diffPreviewCache.keys());
    for (let i = 0; i < keys.length - 50; i++) {
      diffPreviewCache.delete(keys[i]);
    }
  }

  return preview;
}

/**
 * Get a cached diff preview.
 */
export function getDiffPreview(operationId: string): DiffPreview | null {
  return diffPreviewCache.get(operationId) || null;
}

/**
 * Calculate risk level based on operation type and changes.
 */
function calculateRiskLevel(
  operationType: string,
  changes: DiffChange[]
): 'low' | 'medium' | 'high' | 'critical' {
  // High-risk operations
  const highRiskOps = ['delete_all', 'reset', 'restore', 'bulk_delete'];
  if (highRiskOps.includes(operationType)) {
    return 'critical';
  }

  // Check for sensitive paths
  const sensitivePaths = ['/persona/', '/etc/', 'core.json', 'decision-rules.json'];
  const hasSensitiveChanges = changes.some(c =>
    sensitivePaths.some(p => c.path.includes(p))
  );

  if (hasSensitiveChanges) {
    return 'high';
  }

  // Check number of changes
  if (changes.length > 100) return 'high';
  if (changes.length > 20) return 'medium';

  // Check delete operations
  const deleteCount = changes.filter(c => c.type === 'delete').length;
  if (deleteCount > 10) return 'high';
  if (deleteCount > 5) return 'medium';

  return 'low';
}

/**
 * Generate a human-readable impact summary.
 */
function generateImpactSummary(changes: DiffChange[]): string {
  const creates = changes.filter(c => c.type === 'create').length;
  const modifies = changes.filter(c => c.type === 'modify').length;
  const deletes = changes.filter(c => c.type === 'delete').length;
  const moves = changes.filter(c => c.type === 'move').length;

  const parts: string[] = [];
  if (creates > 0) parts.push(`${creates} file(s) created`);
  if (modifies > 0) parts.push(`${modifies} file(s) modified`);
  if (deletes > 0) parts.push(`${deletes} file(s) deleted`);
  if (moves > 0) parts.push(`${moves} file(s) moved`);

  return parts.join(', ') || 'No changes';
}

// ============================================================================
// Rollback
// ============================================================================

const rollbackPoints: Map<string, RollbackPoint> = new Map();
const ROLLBACK_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create a rollback point before executing an operation.
 */
export function createRollbackPoint(
  operationType: string,
  username: string,
  paths: string[]
): RollbackPoint {
  const id = `rb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const changes: RollbackChange[] = [];

  for (const filePath of paths) {
    const change: RollbackChange = {
      path: filePath,
      type: 'modify',
      originalExists: fs.existsSync(filePath),
    };

    if (change.originalExists) {
      try {
        change.originalContent = fs.readFileSync(filePath, 'utf-8');
        change.type = 'modify';
      } catch {
        // File exists but can't be read
      }
    } else {
      change.type = 'create';
    }

    changes.push(change);
  }

  const rollbackPoint: RollbackPoint = {
    id,
    operationType,
    timestamp: new Date().toISOString(),
    username,
    changes,
    expiresAt: new Date(Date.now() + ROLLBACK_RETENTION_MS).toISOString(),
  };

  rollbackPoints.set(id, rollbackPoint);

  // Clean expired rollback points
  cleanExpiredRollbackPoints();

  audit({
    category: 'action',
    level: 'info',
    event: 'rollback_point_created',
    actor: username,
    details: {
      rollbackId: id,
      operationType,
      filesCount: paths.length,
    },
  });

  return rollbackPoint;
}

/**
 * Execute a rollback to restore previous state.
 */
export function executeRollback(
  rollbackId: string,
  actor: string
): { success: boolean; restored: number; errors: string[] } {
  const rollbackPoint = rollbackPoints.get(rollbackId);

  if (!rollbackPoint) {
    return { success: false, restored: 0, errors: ['Rollback point not found'] };
  }

  const errors: string[] = [];
  let restored = 0;

  for (const change of rollbackPoint.changes) {
    try {
      if (change.type === 'create') {
        // File was created, so delete it
        if (fs.existsSync(change.path)) {
          fs.unlinkSync(change.path);
          restored++;
        }
      } else if (change.originalContent !== undefined) {
        // Restore original content
        const dir = path.dirname(change.path);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(change.path, change.originalContent);
        restored++;
      } else if (!change.originalExists) {
        // File didn't exist before, delete it
        if (fs.existsSync(change.path)) {
          fs.unlinkSync(change.path);
          restored++;
        }
      }
    } catch (error) {
      errors.push(`Failed to rollback ${change.path}: ${(error as Error).message}`);
    }
  }

  // Remove the rollback point after execution
  rollbackPoints.delete(rollbackId);

  audit({
    category: 'action',
    level: 'info',
    event: 'rollback_executed',
    actor,
    details: {
      rollbackId,
      operationType: rollbackPoint.operationType,
      restored,
      errors: errors.length,
    },
  });

  return { success: errors.length === 0, restored, errors };
}

/**
 * List available rollback points.
 */
export function listRollbackPoints(username?: string): RollbackPoint[] {
  cleanExpiredRollbackPoints();

  const points = Array.from(rollbackPoints.values());

  if (username) {
    return points.filter(p => p.username === username);
  }

  return points;
}

/**
 * Clean expired rollback points.
 */
function cleanExpiredRollbackPoints(): void {
  const now = Date.now();
  for (const [id, point] of rollbackPoints) {
    if (new Date(point.expiresAt).getTime() < now) {
      rollbackPoints.delete(id);
    }
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

const rateLimitStates = new Map<string, RateLimitState>();

const DEFAULT_RATE_LIMITS: RateLimitConfig[] = [
  { operationType: 'backup', windowMs: 60 * 60 * 1000, maxOperations: 10 }, // 10 per hour
  { operationType: 'housekeeping', windowMs: 60 * 60 * 1000, maxOperations: 5 }, // 5 per hour
  { operationType: 'index_maintenance', windowMs: 60 * 60 * 1000, maxOperations: 3 }, // 3 per hour
  { operationType: 'ingestion_qa', windowMs: 60 * 60 * 1000, maxOperations: 5 }, // 5 per hour
  { operationType: 'cleanup_duplicates', windowMs: 60 * 60 * 1000, maxOperations: 3 }, // 3 per hour
  { operationType: 'rollback', windowMs: 60 * 60 * 1000, maxOperations: 10 }, // 10 per hour
];

/**
 * Check if an operation is rate limited.
 */
export function checkRateLimit(
  operationType: string,
  username: string
): { allowed: boolean; remaining: number; resetAt: string } {
  const key = `${username}:${operationType}`;
  const config = DEFAULT_RATE_LIMITS.find(c => c.operationType === operationType);

  if (!config) {
    return { allowed: true, remaining: -1, resetAt: '' };
  }

  const now = Date.now();
  let state = rateLimitStates.get(key);

  // Reset if window has passed
  if (!state || now - state.windowStart > config.windowMs) {
    state = {
      operationType,
      windowStart: now,
      count: 0,
    };
  }

  const remaining = config.maxOperations - state.count;
  const resetAt = new Date(state.windowStart + config.windowMs).toISOString();

  if (remaining <= 0) {
    return { allowed: false, remaining: 0, resetAt };
  }

  return { allowed: true, remaining, resetAt };
}

/**
 * Record an operation for rate limiting.
 */
export function recordOperation(operationType: string, username: string): void {
  const key = `${username}:${operationType}`;
  const config = DEFAULT_RATE_LIMITS.find(c => c.operationType === operationType);

  if (!config) return;

  const now = Date.now();
  let state = rateLimitStates.get(key);

  if (!state || now - state.windowStart > config.windowMs) {
    state = {
      operationType,
      windowStart: now,
      count: 0,
    };
  }

  state.count++;
  rateLimitStates.set(key, state);
}

/**
 * Get rate limit status for all operation types.
 */
export function getRateLimitStatus(username: string): Array<{
  operationType: string;
  remaining: number;
  maxOperations: number;
  resetAt: string;
}> {
  return DEFAULT_RATE_LIMITS.map(config => {
    const check = checkRateLimit(config.operationType, username);
    return {
      operationType: config.operationType,
      remaining: check.remaining === -1 ? config.maxOperations : check.remaining,
      maxOperations: config.maxOperations,
      resetAt: check.resetAt,
    };
  });
}

// ============================================================================
// Anomaly Detection
// ============================================================================

const anomalyReports: AnomalyReport[] = [];
const MAX_ANOMALY_REPORTS = 100;

interface AnomalyThresholds {
  maxDeletionsPerHour: number;
  maxModificationsPerHour: number;
  maxRollbacksPerHour: number;
  maxFailedOperationsPerHour: number;
}

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  maxDeletionsPerHour: 50,
  maxModificationsPerHour: 200,
  maxRollbacksPerHour: 5,
  maxFailedOperationsPerHour: 20,
};

// Track operations for anomaly detection
const operationCounters = new Map<string, { count: number; windowStart: number }>();

/**
 * Check for anomalies and report if found.
 */
export function detectAnomaly(
  operationType: string,
  success: boolean,
  details: Record<string, unknown> = {}
): AnomalyReport | null {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  // Track operation counts
  const key = `${operationType}:${success ? 'success' : 'failure'}`;
  let counter = operationCounters.get(key);

  if (!counter || now - counter.windowStart > hourMs) {
    counter = { count: 0, windowStart: now };
  }
  counter.count++;
  operationCounters.set(key, counter);

  // Check thresholds
  let anomaly: AnomalyReport | null = null;

  if (operationType === 'delete' && counter.count > DEFAULT_THRESHOLDS.maxDeletionsPerHour) {
    anomaly = createAnomalyReport(
      'critical',
      'excessive_deletions',
      `${counter.count} deletions in the last hour exceeds threshold of ${DEFAULT_THRESHOLDS.maxDeletionsPerHour}`,
      { count: counter.count, threshold: DEFAULT_THRESHOLDS.maxDeletionsPerHour, ...details }
    );
  }

  if (operationType === 'modify' && counter.count > DEFAULT_THRESHOLDS.maxModificationsPerHour) {
    anomaly = createAnomalyReport(
      'warning',
      'excessive_modifications',
      `${counter.count} modifications in the last hour exceeds threshold of ${DEFAULT_THRESHOLDS.maxModificationsPerHour}`,
      { count: counter.count, threshold: DEFAULT_THRESHOLDS.maxModificationsPerHour, ...details }
    );
  }

  if (operationType === 'rollback' && counter.count > DEFAULT_THRESHOLDS.maxRollbacksPerHour) {
    anomaly = createAnomalyReport(
      'warning',
      'frequent_rollbacks',
      `${counter.count} rollbacks in the last hour may indicate instability`,
      { count: counter.count, threshold: DEFAULT_THRESHOLDS.maxRollbacksPerHour, ...details }
    );
  }

  if (!success) {
    const failKey = `failure:all`;
    let failCounter = operationCounters.get(failKey);
    if (!failCounter || now - failCounter.windowStart > hourMs) {
      failCounter = { count: 0, windowStart: now };
    }
    failCounter.count++;
    operationCounters.set(failKey, failCounter);

    if (failCounter.count > DEFAULT_THRESHOLDS.maxFailedOperationsPerHour) {
      anomaly = createAnomalyReport(
        'critical',
        'excessive_failures',
        `${failCounter.count} failed operations in the last hour`,
        { count: failCounter.count, threshold: DEFAULT_THRESHOLDS.maxFailedOperationsPerHour, ...details }
      );
    }
  }

  return anomaly;
}

/**
 * Create an anomaly report.
 */
function createAnomalyReport(
  severity: 'info' | 'warning' | 'critical',
  type: string,
  description: string,
  details: Record<string, unknown>
): AnomalyReport {
  const report: AnomalyReport = {
    id: `anomaly-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    timestamp: new Date().toISOString(),
    severity,
    type,
    description,
    details,
    acknowledged: false,
  };

  anomalyReports.push(report);

  // Keep only recent reports
  while (anomalyReports.length > MAX_ANOMALY_REPORTS) {
    anomalyReports.shift();
  }

  audit({
    category: 'security',
    level: severity === 'critical' ? 'error' : 'warn',
    event: 'anomaly_detected',
    actor: 'system',
    details: {
      anomalyId: report.id,
      type,
      severity,
      description,
    },
  });

  return report;
}

/**
 * Get recent anomaly reports.
 */
export function getAnomalyReports(
  options: { unacknowledgedOnly?: boolean; severity?: string } = {}
): AnomalyReport[] {
  let reports = [...anomalyReports];

  if (options.unacknowledgedOnly) {
    reports = reports.filter(r => !r.acknowledged);
  }

  if (options.severity) {
    reports = reports.filter(r => r.severity === options.severity);
  }

  return reports.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Acknowledge an anomaly report.
 */
export function acknowledgeAnomaly(anomalyId: string, actor: string): boolean {
  const report = anomalyReports.find(r => r.id === anomalyId);

  if (!report) {
    return false;
  }

  report.acknowledged = true;

  audit({
    category: 'action',
    level: 'info',
    event: 'anomaly_acknowledged',
    actor,
    details: { anomalyId, type: report.type },
  });

  return true;
}

/**
 * Get a safety summary for the system operator.
 */
export function getSystemSafetySummary(username: string): {
  rollbackPointsAvailable: number;
  rateLimitStatus: Array<{ operationType: string; remaining: number; maxOperations: number }>;
  unacknowledgedAnomalies: number;
  criticalAnomalies: number;
} {
  const rollbackPointsAvailable = listRollbackPoints(username).length;
  const rateLimitStatus = getRateLimitStatus(username);
  const anomalies = getAnomalyReports({ unacknowledgedOnly: true });
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical').length;

  return {
    rollbackPointsAvailable,
    rateLimitStatus,
    unacknowledgedAnomalies: anomalies.length,
    criticalAnomalies,
  };
}
