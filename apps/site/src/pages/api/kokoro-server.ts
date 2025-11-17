import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootPath = path.resolve(process.cwd(), '../..');
const KOKORO_DIR = path.join(rootPath, 'external', 'kokoro');
const PID_FILE = path.join(rootPath, 'logs', 'run', 'kokoro-server.pid');
const LOG_FILE = path.join(rootPath, 'logs', 'run', 'kokoro-server.log');

/**
 * GET /api/kokoro-server
 * Check Kokoro server status
 */
export const GET: APIRoute = async () => {
  try {
    const status = await getServerStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API /kokoro-server GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), running: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/kokoro-server
 * Start or stop Kokoro server
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { action, port, lang } = await request.json();

    if (action === 'start') {
      const result = await startServer(port || 9882, lang || 'a');
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'stop') {
      const result = await stopServer();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use "start" or "stop".' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('[API /kokoro-server POST] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function getServerStatus(): Promise<{
  running: boolean;
  installed: boolean;
  pid?: number;
  healthy?: boolean;
  url?: string;
  lang?: string;
}> {
  // Check if Kokoro is installed
  const pythonBin = path.join(KOKORO_DIR, 'venv', 'bin', 'python3');
  const serverScript = path.join(KOKORO_DIR, 'kokoro_server.py');
  const installed = fs.existsSync(pythonBin) && fs.existsSync(serverScript);

  // Check if PID file exists
  if (!fs.existsSync(PID_FILE)) {
    return { running: false, installed };
  }

  try {
    const pidStr = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    // Check if process is running
    try {
      process.kill(pid, 0); // Signal 0 checks if process exists
    } catch {
      // Process not running, clean up stale PID file
      fs.unlinkSync(PID_FILE);
      return { running: false, installed };
    }

    // Process is running, check health
    const url = 'http://127.0.0.1:9882';
    let healthy = false;
    let lang: string | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${url}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        healthy = true;
        lang = data.lang;
      }
    } catch {
      // Server not responding
    }

    return {
      running: true,
      installed,
      pid,
      healthy,
      url,
      lang,
    };
  } catch (error) {
    console.error('[getServerStatus] Error:', error);
    return { running: false, installed };
  }
}

async function startServer(
  port: number = 9882,
  lang: string = 'a'
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  pid?: number;
  url?: string;
}> {
  // Check if already running
  if (fs.existsSync(PID_FILE)) {
    try {
      const pidStr = fs.readFileSync(PID_FILE, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);
      process.kill(pid, 0);
      return {
        success: false,
        error: `Server already running (PID ${pid})`,
      };
    } catch {
      // Stale PID file, clean it up
      fs.unlinkSync(PID_FILE);
    }
  }

  const pythonBin = path.join(KOKORO_DIR, 'venv', 'bin', 'python3');
  const serverScript = path.join(KOKORO_DIR, 'kokoro_server.py');

  if (!fs.existsSync(pythonBin)) {
    return {
      success: false,
      error: 'Kokoro not installed. Run installation first.',
    };
  }

  if (!fs.existsSync(serverScript)) {
    return {
      success: false,
      error: 'Server script not found. Reinstall Kokoro.',
    };
  }

  try {
    // Ensure log directory exists
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFd = fs.openSync(LOG_FILE, 'a');

    const server = spawn(
      pythonBin,
      [serverScript, '--port', port.toString(), '--lang', lang],
      {
        cwd: KOKORO_DIR,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      }
    );

    // Save PID
    fs.writeFileSync(PID_FILE, server.pid!.toString());

    // Close log file descriptor after spawning
    fs.closeSync(logFd);

    // Wait for server to start (first time may take ~5-10 seconds for model loading)
    const url = `http://127.0.0.1:${port}`;
    const maxWaitTime = 10000; // 10 seconds
    const pollInterval = 500; // 500ms
    const startTime = Date.now();

    // Poll for server health
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);

        const response = await fetch(`${url}/health`, {
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          server.unref(); // Detach from parent process
          return {
            success: true,
            message: 'Server started successfully',
            pid: server.pid!,
            url,
          };
        }
      } catch {
        // Server not responding yet, continue polling
      }
    }

    // Server started but not responding within timeout
    server.unref();
    return {
      success: true,
      message: 'Server process started but not responding yet. Check logs.',
      pid: server.pid!,
      url,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to start server: ${String(error)}`,
    };
  }
}

async function stopServer(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  if (!fs.existsSync(PID_FILE)) {
    return {
      success: true,
      message: 'Server is not running',
    };
  }

  try {
    const pidStr = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    // Send SIGTERM for graceful shutdown
    process.kill(pid, 'SIGTERM');

    // Wait for graceful shutdown
    let stopped = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        process.kill(pid, 0);
      } catch {
        stopped = true;
        break;
      }
    }

    if (!stopped) {
      // Force kill if not stopped
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already stopped
      }
    }

    // Clean up PID file
    fs.unlinkSync(PID_FILE);

    return {
      success: true,
      message: 'Server stopped successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to stop server: ${String(error)}`,
    };
  }
}
