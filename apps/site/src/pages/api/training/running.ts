/**
 * API endpoint for checking if any training is currently running
 *
 * GET: Returns whether a training process is active (any method)
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

/**
 * Check if a process is running by PID
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * GET handler - Check if any training is running
 * Checks for: full-cycle.pid, full-cycle-local.pid, fine-tune-cycle.pid
 */
export const GET: APIRoute = async () => {
  try {
    const logsRunDir = path.join(systemPaths.logs, 'run');

    if (!fs.existsSync(logsRunDir)) {
      return new Response(
        JSON.stringify({
          success: true,
          running: false,
          pid: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check for any training PID files
    const pidFiles = fs.readdirSync(logsRunDir)
      .filter(f =>
        f.endsWith('.pid') &&
        (f.includes('full-cycle') || f.includes('fine-tune-cycle'))
      );

    // Check each PID file and return the first running process
    for (const pidFile of pidFiles) {
      const pidPath = path.join(logsRunDir, pidFile);
      const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);

      if (isNaN(pid)) {
        // Invalid PID file, clean it up
        fs.unlinkSync(pidPath);
        continue;
      }

      const running = isProcessRunning(pid);

      if (running) {
        // Found a running training process
        return new Response(
          JSON.stringify({
            success: true,
            running: true,
            pid,
            method: pidFile.replace('.pid', ''),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } else {
        // Clean up stale PID file
        fs.unlinkSync(pidPath);
      }
    }

    // No running training found
    return new Response(
      JSON.stringify({
        success: true,
        running: false,
        pid: null,
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
        error: error?.message || 'Failed to check training status',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
