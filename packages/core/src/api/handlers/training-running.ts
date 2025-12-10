/**
 * Training Running API Handler
 *
 * GET whether a training process is currently running.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

/**
 * Check if a process is running by PID
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/training/running - Check if any training is running
 */
export async function handleGetTrainingRunning(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const logsRunDir = path.join(systemPaths.logs, 'run');

    if (!existsSync(logsRunDir)) {
      return successResponse({
        success: true,
        running: false,
        pid: null,
      });
    }

    // Check for any training PID files
    const pidFiles = readdirSync(logsRunDir)
      .filter(f =>
        f.endsWith('.pid') &&
        (f.includes('full-cycle') || f.includes('fine-tune-cycle'))
      );

    // Check each PID file and return the first running process
    for (const pidFile of pidFiles) {
      const pidPath = path.join(logsRunDir, pidFile);
      const pidStr = readFileSync(pidPath, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);

      if (isNaN(pid)) {
        // Invalid PID file, clean it up
        try {
          unlinkSync(pidPath);
        } catch {}
        continue;
      }

      const running = isProcessRunning(pid);

      if (running) {
        // Found a running training process
        return successResponse({
          success: true,
          running: true,
          pid,
          method: pidFile.replace('.pid', ''),
        });
      } else {
        // Clean up stale PID file
        try {
          unlinkSync(pidPath);
        } catch {}
      }
    }

    // No running training found
    return successResponse({
      success: true,
      running: false,
      pid: null,
    });
  } catch (error) {
    console.error('[training-running] GET failed:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to check training status',
    };
  }
}
