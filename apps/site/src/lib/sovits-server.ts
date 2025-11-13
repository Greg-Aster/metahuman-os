import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootPath = path.resolve(process.cwd(), '../..');
const SOVITS_DIR = path.join(rootPath, 'external', 'gpt-sovits');
const SOVITS_PID_FILE = path.join(rootPath, 'logs', 'run', 'sovits.pid');
const SOVITS_LOG_FILE = path.join(rootPath, 'logs', 'run', 'sovits.log');

export interface SovitsStatus {
  running: boolean;
  pid?: number;
  port?: number;
  serverUrl?: string;
  installed: boolean;
  healthy?: boolean;
}

export interface SovitsActionResult {
  success: boolean;
  message?: string;
  error?: string;
  pid?: number;
  port?: number;
}

export async function getSovitsServerStatus(): Promise<SovitsStatus> {
  const installed = fs.existsSync(SOVITS_DIR);

  if (!installed) {
    return { running: false, installed: false };
  }

  if (!fs.existsSync(SOVITS_PID_FILE)) {
    return { running: false, installed: true };
  }

  const pidData = JSON.parse(fs.readFileSync(SOVITS_PID_FILE, 'utf-8'));
  const pid = pidData.pid;
  const port = pidData.port || 9880;

  let running = false;
  try {
    process.kill(pid, 0);
    running = true;
  } catch {
    fs.unlinkSync(SOVITS_PID_FILE);
    return { running: false, installed: true };
  }

  let healthy = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(2000),
    });
    healthy = response.status >= 200 && response.status < 500;
  } catch {
    // ignore, healthy stays false
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

export async function startSovitsServer(port = 9880): Promise<SovitsActionResult> {
  const status = await getSovitsServerStatus();

  if (status.running) {
    return {
      success: false,
      error: `Server already running on port ${status.port} (PID: ${status.pid})`,
    };
  }

  if (!status.installed) {
    return {
      success: false,
      error: 'GPT-SoVITS not installed. Please install it from the Addons tab first.',
    };
  }

  const venvPython = path.join(SOVITS_DIR, 'venv', 'bin', 'python3');
  let pythonBin = 'python3';

  if (fs.existsSync(venvPython)) {
    pythonBin = venvPython;
  } else {
    const pythonCandidates = ['python3.11', 'python3.10', 'python3.9', 'python3', 'python'];
    for (const cmd of pythonCandidates) {
      try {
        execSync(`command -v ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
        pythonBin = cmd;
        break;
      } catch {
        // try next
      }
    }
  }

  const serverScript = path.join(SOVITS_DIR, 'api.py');
  if (!fs.existsSync(serverScript)) {
    return {
      success: false,
      error: 'GPT-SoVITS server script not found. Installation may be incomplete.',
    };
  }

  try {
    const logDir = path.dirname(SOVITS_LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFd = fs.openSync(SOVITS_LOG_FILE, 'a');

    const serverProcess = spawn(
      pythonBin,
      [serverScript, '--port', String(port)],
      {
        cwd: SOVITS_DIR,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      }
    );

    fs.close(logFd, (err) => {
      if (err) console.error('[sovits-server] Error closing log fd:', err);
    });

    serverProcess.unref();

    fs.writeFileSync(
      SOVITS_PID_FILE,
      JSON.stringify({
        pid: serverProcess.pid,
        port,
        startTime: new Date().toISOString(),
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const newStatus = await getSovitsServerStatus();
    if (newStatus.running) {
      return {
        success: true,
        message: `GPT-SoVITS server started successfully on port ${port}`,
        pid: serverProcess.pid,
        port,
      };
    }

    return {
      success: false,
      error: 'Server process started but is not responding. Check logs for details.',
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to start server: ${String(error)}`,
    };
  }
}

export async function stopSovitsServer(): Promise<SovitsActionResult> {
  const status = await getSovitsServerStatus();

  if (!status.running) {
    if (fs.existsSync(SOVITS_PID_FILE)) {
      fs.unlinkSync(SOVITS_PID_FILE);
    }
    return { success: true, message: 'Server is not running' };
  }

  try {
    process.kill(status.pid!, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      process.kill(status.pid!, 0);
      process.kill(status.pid!, 'SIGKILL');
    } catch {
      // already stopped
    }

    if (fs.existsSync(SOVITS_PID_FILE)) {
      fs.unlinkSync(SOVITS_PID_FILE);
    }

    return { success: true, message: 'GPT-SoVITS server stopped' };
  } catch (error) {
    return { success: false, error: `Failed to stop server: ${String(error)}` };
  }
}
