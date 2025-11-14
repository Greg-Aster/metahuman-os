import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootPath = path.resolve(process.cwd(), '../..');
const RVC_DIR = path.join(rootPath, 'external', 'applio-rvc');
const RVC_PID_FILE = path.join(rootPath, 'logs', 'run', 'rvc.pid');
const RVC_LOG_FILE = path.join(rootPath, 'logs', 'run', 'rvc-server.log');
const RVC_PORT = 9881;

export interface RvcStatus {
  running: boolean;
  pid?: number;
  port?: number;
  serverUrl?: string;
  installed: boolean;
  healthy?: boolean;
  modelLoaded?: boolean;
  device?: string;
}

export interface RvcActionResult {
  success: boolean;
  message?: string;
  error?: string;
  pid?: number;
  port?: number;
}

export async function getRvcServerStatus(): Promise<RvcStatus> {
  const installed = fs.existsSync(RVC_DIR);

  if (!installed) {
    return { running: false, installed: false };
  }

  // Check if server is responding (health check first)
  let healthy = false;
  let modelLoaded = false;
  let device = 'unknown';

  try {
    const response = await fetch(`http://127.0.0.1:${RVC_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      const data = await response.json();
      healthy = data.status === 'healthy';
      modelLoaded = data.model_loaded || false;
      device = data.device || 'unknown';
    }
  } catch {
    // Server not responding
  }

  // Get PID if available
  let pid: number | undefined;
  if (fs.existsSync(RVC_PID_FILE)) {
    const pidData = fs.readFileSync(RVC_PID_FILE, 'utf-8').trim();
    const parsedPid = parseInt(pidData, 10);

    if (!isNaN(parsedPid)) {
      try {
        process.kill(parsedPid, 0);
        pid = parsedPid;
      } catch {
        // PID file stale, remove it
        fs.unlinkSync(RVC_PID_FILE);
      }
    } else {
      fs.unlinkSync(RVC_PID_FILE);
    }
  }

  // If server is healthy but no PID, it's running (just started manually)
  const running = healthy || (pid !== undefined);

  return {
    running,
    installed,
    pid,
    port: RVC_PORT,
    serverUrl: `http://127.0.0.1:${RVC_PORT}`,
    healthy,
    modelLoaded,
    device,
  };
}

export async function startRvcServer(): Promise<RvcActionResult> {
  const status = await getRvcServerStatus();

  if (status.running) {
    return {
      success: false,
      error: `RVC server already running on port ${status.port} (PID: ${status.pid})`,
    };
  }

  if (!status.installed) {
    return {
      success: false,
      error: 'RVC (Applio) not installed. Check external/applio-rvc directory.',
    };
  }

  const venvPython = path.join(RVC_DIR, 'venv', 'bin', 'python3');

  if (!fs.existsSync(venvPython)) {
    return {
      success: false,
      error: 'RVC Python environment not found. Reinstall RVC.',
    };
  }

  const serverScript = path.join(RVC_DIR, 'server.py');
  if (!fs.existsSync(serverScript)) {
    return {
      success: false,
      error: 'RVC server script not found at external/applio-rvc/server.py',
    };
  }

  // Determine profile and models directory
  const profile = 'greggles'; // TODO: read from config
  const modelsDir = path.join(rootPath, 'profiles', profile, 'out', 'voices', 'rvc-models');

  try {
    const logDir = path.dirname(RVC_LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFd = fs.openSync(RVC_LOG_FILE, 'a');

    const serverProcess = spawn(
      venvPython,
      [
        serverScript,
        '--port', String(RVC_PORT),
        '--device', 'cuda',
        '--speaker', 'default',
        '--models-dir', modelsDir,
      ],
      {
        cwd: RVC_DIR, // Important: run from RVC dir for config files
        detached: true,
        stdio: ['ignore', logFd, logFd],
      }
    );

    fs.close(logFd, (err) => {
      if (err) console.error('[rvc-server] Error closing log fd:', err);
    });

    serverProcess.unref();

    // Write PID file
    fs.writeFileSync(RVC_PID_FILE, String(serverProcess.pid));

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const newStatus = await getRvcServerStatus();
    if (newStatus.running && newStatus.healthy) {
      return {
        success: true,
        message: `RVC server started successfully on port ${RVC_PORT}`,
        pid: serverProcess.pid,
        port: RVC_PORT,
      };
    }

    if (newStatus.running && !newStatus.healthy) {
      return {
        success: true,
        message: `RVC server started (PID ${serverProcess.pid}) but not yet healthy. It may still be initializing.`,
        pid: serverProcess.pid,
        port: RVC_PORT,
      };
    }

    return {
      success: false,
      error: 'Server process started but is not responding. Check logs at ' + RVC_LOG_FILE,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to start RVC server: ${String(error)}`,
    };
  }
}

export async function stopRvcServer(): Promise<RvcActionResult> {
  const status = await getRvcServerStatus();

  if (!status.running) {
    if (fs.existsSync(RVC_PID_FILE)) {
      fs.unlinkSync(RVC_PID_FILE);
    }
    return { success: true, message: 'RVC server is not running' };
  }

  try {
    // Send SIGTERM first (graceful shutdown)
    process.kill(status.pid!, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if still running, force kill if needed
    try {
      process.kill(status.pid!, 0);
      process.kill(status.pid!, 'SIGKILL');
    } catch {
      // already stopped
    }

    if (fs.existsSync(RVC_PID_FILE)) {
      fs.unlinkSync(RVC_PID_FILE);
    }

    return { success: true, message: 'RVC server stopped' };
  } catch (error) {
    return { success: false, error: `Failed to stop RVC server: ${String(error)}` };
  }
}
