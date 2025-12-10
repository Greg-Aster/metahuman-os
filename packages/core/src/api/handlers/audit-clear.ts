/**
 * Audit Clear API Handlers
 *
 * Unified handlers for clearing audit logs.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { audit } from '../../audit.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * DELETE /api/audit/clear - Clear all audit logs for privacy
 */
export async function handleClearAudit(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const auditDir = path.join(systemPaths.logs, 'audit');

    if (!fs.existsSync(auditDir)) {
      return successResponse({ success: true, message: 'No audit logs to clear' });
    }

    // Get all audit log files
    const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.ndjson'));
    const deletedFiles: string[] = [];

    // Delete all audit log files
    for (const file of files) {
      const filePath = path.join(auditDir, file);
      try {
        fs.unlinkSync(filePath);
        deletedFiles.push(file);
      } catch (error) {
        console.warn(`Failed to delete audit log ${file}:`, error);
      }
    }

    // Audit the clear action itself (this will create a new log file)
    audit({
      level: 'info',
      category: 'security',
      event: 'audit_logs_cleared',
      details: {
        deletedFiles: deletedFiles.length,
        fileNames: deletedFiles,
        reason: 'User privacy request',
      },
      actor: user.username,
    });

    return successResponse({
      success: true,
      deletedFiles: deletedFiles.length,
      message: `Cleared ${deletedFiles.length} audit log file(s)`,
    });
  } catch (error) {
    console.error('[audit/clear] DELETE error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
