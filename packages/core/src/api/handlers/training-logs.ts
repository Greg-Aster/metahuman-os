/**
 * Training Logs API Handler
 *
 * GET recent audit logs for training events.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

interface AuditLog {
  timestamp: string;
  level: string;
  category: string;
  event: string;
  actor?: string;
  details?: any;
}

/**
 * Read recent audit logs and filter for training-related events
 */
function getRecentTrainingLogs(maxLines: number = 100): AuditLog[] {
  const logs: AuditLog[] = [];
  const auditDir = path.join(systemPaths.logs, 'audit');

  if (!existsSync(auditDir)) {
    return logs;
  }

  // Get today's and yesterday's audit files
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const filesToCheck = [
    path.join(auditDir, `${today}.ndjson`),
    path.join(auditDir, `${yesterday}.ndjson`),
  ];

  for (const filePath of filesToCheck) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Read from end (most recent first)
      for (let i = lines.length - 1; i >= 0 && logs.length < maxLines; i--) {
        try {
          const log = JSON.parse(lines[i]) as AuditLog;

          // Filter for training-related events
          if (
            log.event?.startsWith('full_cycle_') ||
            log.event?.startsWith('adapter_') ||
            log.event?.startsWith('curator_') ||
            log.event?.startsWith('builder_') ||
            log.event?.startsWith('training_') ||
            log.event === 'dataset_prepared' ||
            log.event === 'samples_collected' ||
            log.category === 'action' // Show all action events during training
          ) {
            logs.push(log);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  // Return in chronological order (oldest first)
  return logs.reverse();
}

/**
 * GET /api/training/logs - Get recent training audit logs
 */
export async function handleGetTrainingLogs(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { query } = req;
    const maxLines = parseInt(query?.maxLines || '100', 10);

    const logs = getRecentTrainingLogs(maxLines);

    return successResponse({
      success: true,
      logs,
      count: logs.length,
    });
  } catch (error) {
    console.error('[training-logs] GET failed:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to load training logs',
    };
  }
}
