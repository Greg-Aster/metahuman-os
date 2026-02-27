/**
 * Event Bus Status API
 * GET - Check if event bus server is running
 * POST - Start/stop/restart the event bus server
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

const LOG_PREFIX = '[event-bus-status]';
const EVENT_BUS_PORT = 3100;
const EVENT_BUS_ENDPOINT = `http://localhost:${EVENT_BUS_PORT}`;

// Get the root directory (metahuman repo root)
function getRepoRoot(): string {
  // apps/site -> metahuman root
  return path.resolve(process.cwd(), '..', '..');
}

export const GET: APIRoute = async () => {
  try {
    // Check health endpoint
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${EVENT_BUS_ENDPOINT}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      return new Response(JSON.stringify({
        running: true,
        healthy: true,
        port: EVENT_BUS_PORT,
        endpoint: EVENT_BUS_ENDPOINT,
        uptime: data.uptime,
        eventCount: data.eventCount,
        subscribers: data.subscribers,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      running: false,
      healthy: false,
      port: EVENT_BUS_PORT,
      endpoint: EVENT_BUS_ENDPOINT,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      running: false,
      healthy: false,
      port: EVENT_BUS_PORT,
      endpoint: EVENT_BUS_ENDPOINT,
      error: (error as Error).message,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'start') {
      // Start event bus server using spawn
      const { spawn } = await import('child_process');

      const repoRoot = getRepoRoot();
      const serverPath = path.join(repoRoot, 'packages', 'core', 'src', 'infrastructure', 'event-bus', 'server.ts');
      const tsxPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
      const logDir = path.join(repoRoot, 'logs', 'run');
      const logFile = path.join(logDir, 'event-bus.log');
      const pidFile = path.join(logDir, 'event-bus.pid');

      console.log(`${LOG_PREFIX} ========== START REQUEST ==========`);
      console.log(`${LOG_PREFIX} Repo root: ${repoRoot}`);
      console.log(`${LOG_PREFIX} Server path: ${serverPath}`);
      console.log(`${LOG_PREFIX} Log file: ${logFile}`);

      // Check if server script exists
      if (!fs.existsSync(serverPath)) {
        console.error(`${LOG_PREFIX} ERROR: Server script not found at ${serverPath}`);
        return new Response(JSON.stringify({
          success: false,
          error: `Server script not found at ${serverPath}`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!fs.existsSync(tsxPath)) {
        console.error(`${LOG_PREFIX} ERROR: tsx executable not found at ${tsxPath}`);
        return new Response(JSON.stringify({
          success: false,
          error: `tsx executable not found at ${tsxPath}`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Ensure log directory exists
      fs.mkdirSync(logDir, { recursive: true });

      // Open log file for writing
      const logFd = fs.openSync(logFile, 'a');

      console.log(`${LOG_PREFIX} Starting event bus server...`);

      const child = spawn(tsxPath, [serverPath], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: 'production' },
      });

      // Save PID for later management
      if (child.pid) {
        fs.writeFileSync(pidFile, child.pid.toString());
        console.log(`${LOG_PREFIX} Server started with PID: ${child.pid}`);
      }

      child.unref();
      fs.closeSync(logFd);

      // Wait a moment for startup
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify it's actually running by checking health
      try {
        const healthCheck = await fetch(`${EVENT_BUS_ENDPOINT}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (healthCheck.ok) {
          console.log(`${LOG_PREFIX} Server is healthy!`);
          return new Response(JSON.stringify({
            success: true,
            message: 'Event bus server started successfully',
            pid: child.pid,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (healthError) {
        console.warn(`${LOG_PREFIX} Health check failed, but server may still be starting:`, healthError);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Event bus server starting... (check logs/run/event-bus.log for details)',
        pid: child.pid,
        logFile,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'stop') {
      // Find and kill the event bus process
      const { execSync } = await import('child_process');

      console.log(`${LOG_PREFIX} ========== STOP REQUEST ==========`);

      const repoRoot = getRepoRoot();
      const pidFile = path.join(repoRoot, 'logs', 'run', 'event-bus.pid');

      let stoppedPids: string[] = [];

      try {
        // Find process using port 3100
        // Only target the listener on EVENT_BUS_PORT. Using plain `-i:port`
        // would also match clients (including this web server).
        const result = execSync(
          `lsof -n -t -iTCP:${EVENT_BUS_PORT} -sTCP:LISTEN 2>/dev/null || true`
        ).toString().trim();
        if (result) {
          const pids = result.split('\n').filter(Boolean);
          console.log(`${LOG_PREFIX} Found processes on port ${EVENT_BUS_PORT}: ${pids.join(', ')}`);
          for (const pid of pids) {
            try {
              process.kill(parseInt(pid), 'SIGTERM');
              console.log(`${LOG_PREFIX} Sent SIGTERM to PID ${pid}`);
              stoppedPids.push(pid);
            } catch (killError) {
              console.warn(`${LOG_PREFIX} Failed to kill PID ${pid}:`, killError);
            }
          }
        } else {
          console.log(`${LOG_PREFIX} No processes found on port ${EVENT_BUS_PORT}`);
        }
      } catch (error) {
        console.error(`${LOG_PREFIX} Error finding/killing processes:`, error);
      }

      // Clean up PID file
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
        console.log(`${LOG_PREFIX} Removed PID file`);
      }

      return new Response(JSON.stringify({
        success: true,
        message: stoppedPids.length > 0
          ? `Event bus server stopped (PIDs: ${stoppedPids.join(', ')})`
          : 'Event bus server was not running',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'restart') {
      // Stop then start
      const { execSync, spawn } = await import('child_process');

      const repoRoot = getRepoRoot();
      const serverPath = path.join(repoRoot, 'packages', 'core', 'src', 'infrastructure', 'event-bus', 'server.ts');
      const tsxPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
      const logDir = path.join(repoRoot, 'logs', 'run');
      const logFile = path.join(logDir, 'event-bus.log');
      const pidFile = path.join(logDir, 'event-bus.pid');

      console.log(`${LOG_PREFIX} ========== RESTART REQUEST ==========`);

      // Stop existing process
      try {
        const result = execSync(
          `lsof -n -t -iTCP:${EVENT_BUS_PORT} -sTCP:LISTEN 2>/dev/null || true`
        ).toString().trim();
        if (result) {
          const pids = result.split('\n').filter(Boolean);
          console.log(`${LOG_PREFIX} Stopping existing processes: ${pids.join(', ')}`);
          for (const pid of pids) {
            try {
              process.kill(parseInt(pid), 'SIGTERM');
              console.log(`${LOG_PREFIX} Sent SIGTERM to PID ${pid}`);
            } catch (killError) {
              console.warn(`${LOG_PREFIX} Failed to kill PID ${pid}:`, killError);
            }
          }
        }
      } catch (stopError) {
        console.warn(`${LOG_PREFIX} Error during stop phase:`, stopError);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if server script exists
      if (!fs.existsSync(serverPath)) {
        console.error(`${LOG_PREFIX} ERROR: Server script not found at ${serverPath}`);
        return new Response(JSON.stringify({
          success: false,
          error: `Server script not found at ${serverPath}`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!fs.existsSync(tsxPath)) {
        console.error(`${LOG_PREFIX} ERROR: tsx executable not found at ${tsxPath}`);
        return new Response(JSON.stringify({
          success: false,
          error: `tsx executable not found at ${tsxPath}`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Ensure log directory exists
      fs.mkdirSync(logDir, { recursive: true });

      // Open log file for writing
      const logFd = fs.openSync(logFile, 'a');

      console.log(`${LOG_PREFIX} Starting event bus server...`);

      const child = spawn(tsxPath, [serverPath], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: 'production' },
      });

      // Save PID for later management
      if (child.pid) {
        fs.writeFileSync(pidFile, child.pid.toString());
        console.log(`${LOG_PREFIX} Server started with PID: ${child.pid}`);
      }

      child.unref();
      fs.closeSync(logFd);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify it's actually running
      try {
        const healthCheck = await fetch(`${EVENT_BUS_ENDPOINT}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (healthCheck.ok) {
          console.log(`${LOG_PREFIX} Server restarted and is healthy!`);
        }
      } catch {
        console.warn(`${LOG_PREFIX} Health check after restart timed out`);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Event bus server restarted',
        pid: child.pid,
        logFile,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: `Unknown action: ${action}`,
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
