import type { APIRoute } from 'astro';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootPath = path.resolve(process.cwd(), '../..');
const SOVITS_DIR = path.join(rootPath, 'external', 'gpt-sovits');
const SOVITS_PID_FILE = path.join(rootPath, 'logs', 'run', 'sovits.pid');
const SOVITS_LOG_FILE = path.join(rootPath, 'logs', 'run', 'sovits.log');

/**
 * GET /api/sovits-server
 * Check GPT-SoVITS server status
 */
export const GET: APIRoute = async () => {
  try {
    const status = await getServerStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API /sovits-server GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), running: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/sovits-server
 * Start or stop GPT-SoVITS server
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { action, port } = await request.json();

    if (action === 'start') {
      const result = await startServer(port || 9880);
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
    console.error('[API /sovits-server POST] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function getServerStatus(): Promise<{
  running: boolean;
  pid?: number;
  port?: number;
  serverUrl?: string;
  installed: boolean;
  healthy?: boolean;
}> {
  // Check if GPT-SoVITS is installed
  const installed = fs.existsSync(SOVITS_DIR);

  if (!installed) {
    return { running: false, installed: false };
  }

  // Check if PID file exists
  if (!fs.existsSync(SOVITS_PID_FILE)) {
    return { running: false, installed: true };
  }

  // Read PID file
  const pidData = JSON.parse(fs.readFileSync(SOVITS_PID_FILE, 'utf-8'));
  const pid = pidData.pid;
  const port = pidData.port || 9880;

  // Check if process is actually running
  let running = false;
  try {
    process.kill(pid, 0); // Signal 0 = check if process exists
    running = true;
  } catch {
    // Process not running - clean up stale PID file
    fs.unlinkSync(SOVITS_PID_FILE);
    return { running: false, installed: true };
  }

  // Check server health (GPT-SoVITS doesn't have /health, check root instead)
  let healthy = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(2000),
    });
    // Server responds even with error (400 is expected without reference audio)
    healthy = response.status >= 200 && response.status < 500;
  } catch {
    // Server not responding
  }

  return {
    running,
    installed,
    pid,
    port,
    serverUrl: `http://127.0.0.1:${port}`,
    healthy,
  };
}

async function startServer(port: number): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  pid?: number;
  port?: number;
}> {
  // Check if already running
  const status = await getServerStatus();
  if (status.running) {
    return {
      success: false,
      error: `Server already running on port ${status.port} (PID: ${status.pid})`,
    };
  }

  // Check if GPT-SoVITS is installed
  if (!status.installed) {
    return {
      success: false,
      error: 'GPT-SoVITS not installed. Please install it from the Addons tab first.',
    };
  }

  // Use virtual environment Python if available, otherwise system Python
  const venvPython = path.join(SOVITS_DIR, 'venv', 'bin', 'python3');
  let pythonBin = 'python3';

  if (fs.existsSync(venvPython)) {
    pythonBin = venvPython;
  } else {
    // Fallback to system Python
    const pythonCandidates = ['python3.11', 'python3.10', 'python3.9', 'python3', 'python'];
    for (const cmd of pythonCandidates) {
      try {
        execSync(`command -v ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
        pythonBin = cmd;
        break;
      } catch {
        // Try next
      }
    }
  }

  // Start server in background
  const serverScript = path.join(SOVITS_DIR, 'api.py');
  if (!fs.existsSync(serverScript)) {
    return {
      success: false,
      error: 'GPT-SoVITS server script not found. Installation may be incomplete.',
    };
  }

  try {
    // Ensure log directory exists
    const logDir = path.dirname(SOVITS_LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Open log file descriptors
    const logFd = fs.openSync(SOVITS_LOG_FILE, 'a');

    // Start server process with file descriptors (not streams)
    const serverProcess = spawn(
      pythonBin,
      [serverScript, '--port', String(port)],
      {
        cwd: SOVITS_DIR,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      }
    );

    // Close the file descriptors in parent process (child has its own)
    fs.close(logFd, (err) => {
      if (err) console.error('[sovits-server] Error closing log fd:', err);
    });

    // Detach so it continues running after parent exits
    serverProcess.unref();

    // Write PID file
    fs.writeFileSync(
      SOVITS_PID_FILE,
      JSON.stringify({
        pid: serverProcess.pid,
        port,
        startTime: new Date().toISOString(),
      })
    );

    // Wait a moment to check if it started successfully
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const newStatus = await getServerStatus();
    if (newStatus.running) {
      return {
        success: true,
        message: `GPT-SoVITS server started successfully on port ${port}`,
        pid: serverProcess.pid,
        port,
      };
    } else {
      return {
        success: false,
        error: 'Server process started but is not responding. Check logs for details.',
      };
    }
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
  const status = await getServerStatus();

  if (!status.running) {
    // Clean up PID file if it exists
    if (fs.existsSync(SOVITS_PID_FILE)) {
      fs.unlinkSync(SOVITS_PID_FILE);
    }
    return {
      success: true,
      message: 'Server is not running',
    };
  }

  try {
    // Kill process
    process.kill(status.pid!, 'SIGTERM');

    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Force kill if still running
    try {
      process.kill(status.pid!, 0);
      process.kill(status.pid!, 'SIGKILL');
    } catch {
      // Process already stopped
    }

    // Remove PID file
    if (fs.existsSync(SOVITS_PID_FILE)) {
      fs.unlinkSync(SOVITS_PID_FILE);
    }

    return {
      success: true,
      message: `Server stopped successfully (PID: ${status.pid})`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to stop server: ${String(error)}`,
    };
  }
}
