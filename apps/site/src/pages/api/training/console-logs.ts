/**
 * API endpoint for retrieving full-cycle console output logs
 *
 * GET: Returns recent console logs from full-cycle.ts runs
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

/**
 * Get the most recent full-cycle log file
 */
function getMostRecentLogFile(): string | null {
  const logsDir = path.join(systemPaths.logs, 'run');

  if (!fs.existsSync(logsDir)) {
    return null;
  }

  const files = fs.readdirSync(logsDir)
    .filter(f => f.startsWith('full-cycle-') && f.endsWith('.log'))
    .map(f => ({
      name: f,
      path: path.join(logsDir, f),
      mtime: fs.statSync(path.join(logsDir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

/**
 * GET handler - Retrieve full-cycle console logs
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const maxLines = parseInt(url.searchParams.get('maxLines') || '200', 10);

    const logFile = getMostRecentLogFile();

    if (!logFile) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No full-cycle log files found',
          logs: [],
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Read the log file
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    // Get the last N lines
    const recentLines = lines.slice(-maxLines);

    return new Response(
      JSON.stringify({
        success: true,
        logFile: path.basename(logFile),
        logs: recentLines,
        count: recentLines.length,
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
        error: error?.message || 'Failed to load console logs',
        logs: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
