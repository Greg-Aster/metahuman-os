import type { APIRoute } from 'astro';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(process.cwd(), '../..');
const LOG_DIR = path.join(REPO_ROOT, 'logs/run');

export const POST: APIRoute = async ({ params }) => {
  try {
    const port = parseInt(params.port || '', 10);

    if (isNaN(port)) {
      return new Response(JSON.stringify({
        error: 'Invalid port'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const pidFile = path.join(LOG_DIR, `terminal-${port}.pid`);

    if (!fs.existsSync(pidFile)) {
      return new Response(JSON.stringify({
        error: 'Terminal not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Read PID and kill process
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

    try {
      process.kill(pid, 'SIGTERM');

      // Wait a moment then check if it's still running
      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        process.kill(pid, 0); // Check if process exists
        // Still running, force kill
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process is dead, good
      }
    } catch (error) {
      // Process might already be dead
      console.log(`[Terminal Kill] Process ${pid} might already be dead`);
    }

    // Clean up files
    fs.unlinkSync(pidFile);

    const logFile = path.join(LOG_DIR, `terminal-${port}.log`);
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }

    return new Response(JSON.stringify({
      success: true,
      port
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Terminal Kill] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to kill terminal'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
