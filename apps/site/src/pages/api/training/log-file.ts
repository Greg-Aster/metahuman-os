import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

/**
 * GET handler - Retrieve a specific training log file
 * Query params: ?file=<filename>
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const fileName = url.searchParams.get('file');

    if (!fileName) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing file parameter',
          logs: [],
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Security: Prevent directory traversal
    const sanitizedFileName = path.basename(fileName);
    const logPath = path.join(systemPaths.logs, 'run', sanitizedFileName);

    if (!fs.existsSync(logPath)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Log file not found',
          logs: [],
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Read the log file
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    return new Response(
      JSON.stringify({
        success: true,
        fileName: sanitizedFileName,
        logs: lines,
        count: lines.length,
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
        error: error?.message || 'Failed to load log file',
        logs: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
