/**
 * API endpoint for checking if full-cycle training is currently running
 *
 * GET: Returns whether a full-cycle process is active
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
 * GET handler - Check if full-cycle is running
 */
export const GET: APIRoute = async () => {
  try {
    const pidPath = path.join(systemPaths.logs, 'run', 'full-cycle.pid');

    if (!fs.existsSync(pidPath)) {
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

    const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      // Invalid PID file, clean it up
      fs.unlinkSync(pidPath);
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

    const running = isProcessRunning(pid);

    // Clean up stale PID file if process is dead
    if (!running) {
      fs.unlinkSync(pidPath);
    }

    return new Response(
      JSON.stringify({
        success: true,
        running,
        pid: running ? pid : null,
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
