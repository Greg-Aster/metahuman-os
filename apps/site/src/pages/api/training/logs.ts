/**
 * API endpoint for retrieving training/full-cycle logs
 *
 * GET: Returns recent audit logs for full-cycle events
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

interface AuditLog {
  timestamp: string;
  level: string;
  category: string;
  event: string;
  actor?: string;
  details?: any;
}

/**
 * Read recent audit logs and filter for full_cycle events
 */
function getRecentFullCycleLogs(maxLines: number = 100): AuditLog[] {
  const logs: AuditLog[] = [];
  const auditDir = path.join(systemPaths.logs, 'audit');

  if (!fs.existsSync(auditDir)) {
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
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Read from end (most recent first)
      for (let i = lines.length - 1; i >= 0 && logs.length < maxLines; i--) {
        try {
          const log = JSON.parse(lines[i]) as AuditLog;

          // Filter for training-related events (expanded to show pre-processing steps)
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
        } catch (e) {
          // Skip malformed lines
        }
      }
    }
  }

  // Return in chronological order (oldest first)
  return logs.reverse();
}

/**
 * GET handler - Retrieve full-cycle training logs
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const maxLines = parseInt(url.searchParams.get('maxLines') || '100', 10);

    const logs = getRecentFullCycleLogs(maxLines);

    return new Response(
      JSON.stringify({
        success: true,
        logs,
        count: logs.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Failed to load training logs',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
