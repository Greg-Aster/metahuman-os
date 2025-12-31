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

// Check if a port is actually in use
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(500)
    });
    return true; // Port is in use
  } catch {
    return false; // Port is free
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // Parse request body for optional command
    let command = 'bash';
    let args: string[] = [];

    try {
      const body = await request.json();
      if (body.command) {
        // Support shell command string or array
        if (typeof body.command === 'string') {
          command = 'bash';
          args = ['-c', body.command];
        } else if (Array.isArray(body.command)) {
          command = body.command[0];
          args = body.command.slice(1);
        }
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Find available port by checking actual availability
    let port = BASE_PORT;
    let portsChecked = 0;
    
    while (portsChecked < MAX_TERMINALS) {
      const inUse = await isPortInUse(port);
      if (!inUse) {
        break; // Found a free port
      }
      port++;
      portsChecked++;
    }

    if (portsChecked >= MAX_TERMINALS) {
      return new Response(JSON.stringify({
        error: `Maximum number of terminals reached (${MAX_TERMINALS})`
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
      command,
      ...args
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
