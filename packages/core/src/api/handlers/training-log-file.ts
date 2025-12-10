/**
 * Training Log File API Handler
 *
 * GET a specific training log file by name.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

/**
 * GET /api/training/log-file - Get a specific training log file
 */
export async function handleGetTrainingLogFile(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { query } = req;
    const fileName = query?.file;

    if (!fileName) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'Missing file parameter',
          logs: [],
        }
      };
    }

    // Security: Prevent directory traversal
    const sanitizedFileName = path.basename(fileName);
    const logPath = path.join(systemPaths.logs, 'run', sanitizedFileName);

    if (!existsSync(logPath)) {
      return {
        status: 404,
        data: {
          success: false,
          error: 'Log file not found',
          logs: [],
        }
      };
    }

    // Read the log file
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    return successResponse({
      success: true,
      fileName: sanitizedFileName,
      logs: lines,
      count: lines.length,
    });
  } catch (error) {
    console.error('[training-log-file] GET failed:', error);
    return {
      status: 500,
      data: {
        success: false,
        error: (error as Error)?.message || 'Failed to load log file',
        logs: [],
      }
    };
  }
}
