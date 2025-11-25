import type { APIRoute } from 'astro';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(process.cwd(), '../..');
const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
const TTYD_BIN = path.join(REPO_ROOT, 'bin/ttyd');
const BASE_PORT = 3001;
const MAX_TERMINALS = 10;

// Track active terminals
const activeTerminals = new Map<number, { pid: number; port: number }>();

export const POST: APIRoute = async ({ request }) => {
  try {
    // Find available port
    let port = BASE_PORT;
    while (activeTerminals.has(port) && port < BASE_PORT + MAX_TERMINALS) {
      port++;
    }

    if (port >= BASE_PORT + MAX_TERMINALS) {
      return new Response(JSON.stringify({
        error: 'Maximum number of terminals reached'
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Spawn ttyd process
    const logFile = path.join(LOG_DIR, `terminal-${port}.log`);
    const pidFile = path.join(LOG_DIR, `terminal-${port}.pid`);

    const ttydProcess = spawn(TTYD_BIN, [
      '--port', port.toString(),
      '--writable',
      '--cwd', REPO_ROOT,
      'bash'
    ], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
    });

    ttydProcess.unref();

    // Store PID
    fs.writeFileSync(pidFile, ttydProcess.pid!.toString());
    activeTerminals.set(port, { pid: ttydProcess.pid!, port });

    // Wait a moment for ttyd to start
    await new Promise(resolve => setTimeout(resolve, 500));

    return new Response(JSON.stringify({
      port,
      pid: ttydProcess.pid,
      url: `http://localhost:${port}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Terminal Spawn] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to spawn terminal'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
