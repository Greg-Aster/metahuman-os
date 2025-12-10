/**
 * System Coder - Fix Management Service
 *
 * Manages proposed fixes: storage, approval, application, and rollback.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { audit } from '../audit.js';
import { generateUUID } from '../uuid.js';
import { getProfilePaths } from '../path-builder.js';
import type {
  ProposedFix,
  FileChange,
  FixStatus,
  FixRisk,
  CapturedError,
} from './types.js';
import { getFixesDir, ensureSystemCoderDirs } from './error-capture.js';

// ============================================================================
// Fix Storage
// ============================================================================

/**
 * Create and store a proposed fix
 */
export function createFix(
  username: string,
  errorId: string,
  fix: {
    title: string;
    explanation: string;
    changes: FileChange[];
    risk: FixRisk;
    generatedBy: 'big_brother' | 'local_llm' | 'manual';
    confidence: number;
    testCommands?: string[];
  }
): ProposedFix {
  ensureSystemCoderDirs(username);

  const timestamp = new Date().toISOString();
  const id = `fix-${timestamp.replace(/[:.]/g, '-')}-${generateUUID().substring(0, 8)}`;

  const proposedFix: ProposedFix = {
    id,
    timestamp,
    errorId,
    status: 'pending',
    risk: fix.risk,
    title: fix.title,
    explanation: fix.explanation,
    changes: fix.changes,
    testCommands: fix.testCommands,
    generatedBy: fix.generatedBy,
    confidence: fix.confidence,
    canRevert: true,
  };

  // Save to disk
  const fixPath = path.join(getFixesDir(username), `${id}.json`);
  fs.writeFileSync(fixPath, JSON.stringify(proposedFix, null, 2));

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_fix_created',
    details: {
      fixId: id,
      errorId,
      title: fix.title,
      risk: fix.risk,
      changesCount: fix.changes.length,
    },
    actor: 'system-coder',
    userId: username,
  });

  return proposedFix;
}

/**
 * List all fixes with optional filtering
 */
export function listFixes(
  username: string,
  options: {
    status?: FixStatus | FixStatus[];
    errorId?: string;
    limit?: number;
    offset?: number;
  } = {}
): { fixes: ProposedFix[]; total: number } {
  const fixesDir = getFixesDir(username);

  if (!fs.existsSync(fixesDir)) {
    return { fixes: [], total: 0 };
  }

  const files = fs.readdirSync(fixesDir).filter((f) => f.endsWith('.json'));
  let fixes: ProposedFix[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(fixesDir, file), 'utf-8');
      fixes.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp (newest first)
  fixes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply filters
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    fixes = fixes.filter((f) => statuses.includes(f.status));
  }

  if (options.errorId) {
    fixes = fixes.filter((f) => f.errorId === options.errorId);
  }

  const total = fixes.length;

  // Apply pagination
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  fixes = fixes.slice(offset, offset + limit);

  return { fixes, total };
}

/**
 * Get a specific fix by ID
 */
export function getFix(username: string, fixId: string): ProposedFix | null {
  const fixPath = path.join(getFixesDir(username), `${fixId}.json`);

  if (!fs.existsSync(fixPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(fixPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update fix status
 */
export function updateFixStatus(
  username: string,
  fixId: string,
  status: FixStatus,
  metadata?: {
    approvedBy?: string;
    rejectedBy?: string;
    rejectionReason?: string;
  }
): boolean {
  const fix = getFix(username, fixId);
  if (!fix) {
    return false;
  }

  fix.status = status;

  const now = new Date().toISOString();
  if (status === 'approved' && metadata?.approvedBy) {
    fix.approvedBy = metadata.approvedBy;
    fix.approvedAt = now;
  } else if (status === 'rejected' && metadata?.rejectedBy) {
    fix.rejectedBy = metadata.rejectedBy;
    fix.rejectedAt = now;
    fix.rejectionReason = metadata.rejectionReason;
  } else if (status === 'applied') {
    fix.appliedAt = now;
  } else if (status === 'reverted') {
    fix.revertedAt = now;
  }

  const fixPath = path.join(getFixesDir(username), `${fixId}.json`);
  fs.writeFileSync(fixPath, JSON.stringify(fix, null, 2));

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_fix_status_updated',
    details: { fixId, status, ...metadata },
    actor: metadata?.approvedBy || metadata?.rejectedBy || 'system-coder',
    userId: username,
  });

  return true;
}

// ============================================================================
// Fix Application
// ============================================================================

/**
 * Apply a fix to the codebase
 */
export function applyFix(username: string, fixId: string): { success: boolean; error?: string } {
  const fix = getFix(username, fixId);
  if (!fix) {
    return { success: false, error: 'Fix not found' };
  }

  if (fix.status !== 'approved') {
    return { success: false, error: 'Fix must be approved before applying' };
  }

  const backupPaths: string[] = [];

  try {
    // Create backups and apply changes
    for (const change of fix.changes) {
      const filePath = change.filePath;

      // Create backup if file exists
      if (fs.existsSync(filePath) && change.changeType !== 'create') {
        const backupPath = `${filePath}.backup-${fixId}`;
        fs.copyFileSync(filePath, backupPath);
        backupPaths.push(backupPath);
      }

      // Apply the change
      if (change.changeType === 'delete') {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } else {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, change.newContent);
      }
    }

    // Update fix with backup paths and mark as applied
    fix.backupPaths = backupPaths;
    fix.status = 'applied';
    fix.appliedAt = new Date().toISOString();

    const fixPath = path.join(getFixesDir(username), `${fixId}.json`);
    fs.writeFileSync(fixPath, JSON.stringify(fix, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'system_coder_fix_applied',
      details: {
        fixId,
        changesApplied: fix.changes.length,
        backupsCreated: backupPaths.length,
      },
      actor: 'system-coder',
      userId: username,
    });

    return { success: true };
  } catch (error) {
    // Attempt to restore backups on failure
    for (const backupPath of backupPaths) {
      try {
        const originalPath = backupPath.replace(`.backup-${fixId}`, '');
        fs.copyFileSync(backupPath, originalPath);
        fs.unlinkSync(backupPath);
      } catch {
        // Ignore restore errors
      }
    }

    // Mark fix as failed
    fix.status = 'failed';
    const fixPath = path.join(getFixesDir(username), `${fixId}.json`);
    fs.writeFileSync(fixPath, JSON.stringify(fix, null, 2));

    audit({
      level: 'error',
      category: 'action',
      event: 'system_coder_fix_apply_failed',
      details: {
        fixId,
        error: (error as Error).message,
      },
      actor: 'system-coder',
      userId: username,
    });

    return { success: false, error: (error as Error).message };
  }
}

/**
 * Revert a previously applied fix
 */
export function revertFix(username: string, fixId: string): { success: boolean; error?: string } {
  const fix = getFix(username, fixId);
  if (!fix) {
    return { success: false, error: 'Fix not found' };
  }

  if (fix.status !== 'applied') {
    return { success: false, error: 'Fix is not applied' };
  }

  if (!fix.canRevert || !fix.backupPaths?.length) {
    return { success: false, error: 'Fix cannot be reverted - no backups available' };
  }

  try {
    // Restore from backups
    for (const backupPath of fix.backupPaths) {
      const originalPath = backupPath.replace(`.backup-${fixId}`, '');
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, originalPath);
        fs.unlinkSync(backupPath);
      }
    }

    // Handle files that were created (need to delete them)
    for (const change of fix.changes) {
      if (change.changeType === 'create' && fs.existsSync(change.filePath)) {
        fs.unlinkSync(change.filePath);
      }
    }

    // Update fix status
    fix.status = 'reverted';
    fix.revertedAt = new Date().toISOString();
    fix.backupPaths = [];

    const fixPath = path.join(getFixesDir(username), `${fixId}.json`);
    fs.writeFileSync(fixPath, JSON.stringify(fix, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'system_coder_fix_reverted',
      details: { fixId },
      actor: 'system-coder',
      userId: username,
    });

    return { success: true };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'system_coder_fix_revert_failed',
      details: {
        fixId,
        error: (error as Error).message,
      },
      actor: 'system-coder',
      userId: username,
    });

    return { success: false, error: (error as Error).message };
  }
}

/**
 * Delete a fix (only pending/rejected fixes can be deleted)
 */
export function deleteFix(username: string, fixId: string): boolean {
  const fix = getFix(username, fixId);
  if (!fix) {
    return false;
  }

  if (fix.status === 'applied') {
    return false; // Cannot delete applied fixes
  }

  const fixPath = path.join(getFixesDir(username), `${fixId}.json`);
  fs.unlinkSync(fixPath);

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_fix_deleted',
    details: { fixId },
    actor: 'system-coder',
    userId: username,
  });

  return true;
}

/**
 * Get fix statistics
 */
export function getFixStats(username: string): {
  total: number;
  byStatus: Record<FixStatus, number>;
  byRisk: Record<FixRisk, number>;
} {
  const { fixes } = listFixes(username, { limit: 10000 });

  const stats = {
    total: fixes.length,
    byStatus: {} as Record<FixStatus, number>,
    byRisk: {} as Record<FixRisk, number>,
  };

  for (const fix of fixes) {
    stats.byStatus[fix.status] = (stats.byStatus[fix.status] || 0) + 1;
    stats.byRisk[fix.risk] = (stats.byRisk[fix.risk] || 0) + 1;
  }

  return stats;
}
