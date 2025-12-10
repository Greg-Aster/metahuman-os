/**
 * Training Console Logs API Handler
 *
 * GET recent console logs from training runs.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

/**
 * Get the most recent training log file
 * Matches: full-cycle-*.log, full-cycle-local-*.log, fine-tune-cycle-*.log
 */
function getMostRecentLogFile(): string | null {
  const logsDir = path.join(systemPaths.logs, 'run');

  if (!existsSync(logsDir)) {
    return null;
  }

  const files = readdirSync(logsDir)
    .filter(f =>
      (f.includes('full-cycle') || f.includes('fine-tune-cycle')) &&
      f.endsWith('.log')
    )
    .map(f => ({
      name: f,
      path: path.join(logsDir, f),
      mtime: statSync(path.join(logsDir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

/**
 * GET /api/training/console-logs - Get recent training console logs
 */
export async function handleGetTrainingConsoleLogs(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { query } = req;
    const maxLines = parseInt(query?.maxLines || '200', 10);

    const logFile = getMostRecentLogFile();

    if (!logFile) {
      return {
        status: 404,
        data: {
          success: false,
          error: 'No training log files found',
          logs: [],
        }
      };
    }

    // Read the log file
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    // Get the last N lines
    const recentLines = lines.slice(-maxLines);

    return successResponse({
      success: true,
      logFile: path.basename(logFile),
      logs: recentLines,
      count: recentLines.length,
    });
  } catch (error) {
    console.error('[training-console-logs] GET failed:', error);
    return {
      status: 500,
      data: {
        success: false,
        error: (error as Error)?.message || 'Failed to load console logs',
        logs: [],
      }
    };
  }
}
