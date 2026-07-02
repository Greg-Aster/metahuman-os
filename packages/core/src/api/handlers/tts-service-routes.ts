import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { getProfilePaths, systemPaths } from '../../path-builder.js';

const rootPath = systemPaths.root;
const KOKORO_DIR = path.join(rootPath, 'external', 'kokoro');
const RVC_DIR = path.join(rootPath, 'external', 'applio-rvc');
const SOVITS_DIR = path.join(rootPath, 'external', 'gpt-sovits');

function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  let size = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          size += fs.statSync(fullPath).size;
        }
      }
    } catch {
      // Skip unreadable directories.
    }
  }
  return size;
}

async function runInstallScript(scriptName: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const scriptPath = path.join(rootPath, 'bin', scriptName);
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `Installation script not found: ${scriptPath}` };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const install = spawn('bash', [scriptPath], {
        cwd: rootPath,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      install.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      install.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      install.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Installation failed (code ${code}):\n${stderr || stdout}`));
        }
      });

      install.on('error', reject);
    });

    return { success: true, message: 'Installed successfully!' };
  } catch (error) {
    return { success: false, error: `Installation failed: ${String(error)}` };
  }
}

function killPidFile(pidFile: string): void {
  if (!fs.existsSync(pidFile)) return;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (Number.isFinite(pid)) {
      process.kill(pid, 'SIGTERM');
    }
    fs.unlinkSync(pidFile);
  } catch {
    // Ignore stop failures during uninstall cleanup.
  }
}

export const handleKokoroAddon: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') {
      const installed = fs.existsSync(KOKORO_DIR);
      if (!installed) return { status: 200, data: { installed: false } };

      const voicesFile = path.join(KOKORO_DIR, 'VOICES.md');
      let voicesCount = 0;
      if (fs.existsSync(voicesFile)) {
        const matches = fs.readFileSync(voicesFile, 'utf-8').match(/`[a-z_]+`/g);
        voicesCount = matches ? matches.length : 0;
      }

      return {
        status: 200,
        data: {
          installed: true,
          venvExists: fs.existsSync(path.join(KOKORO_DIR, 'venv')),
          serverScriptExists: fs.existsSync(path.join(KOKORO_DIR, 'kokoro_server.py')),
          diskUsage: getDirSize(KOKORO_DIR),
          voicesCount,
        },
      };
    }

    const action = req.body?.action;
    if (action === 'install') {
      if (fs.existsSync(KOKORO_DIR)) {
        return { status: 500, data: { success: false, error: 'Kokoro is already installed. Uninstall first to reinstall.' } };
      }
      const result = await runInstallScript('install-kokoro.sh');
      return { status: result.success ? 200 : 500, data: result.success ? { ...result, message: 'Kokoro installed successfully!' } : result };
    }

    if (action === 'uninstall') {
      if (!fs.existsSync(KOKORO_DIR)) {
        return { status: 200, data: { success: true, message: 'Kokoro is not installed' } };
      }
      killPidFile(path.join(rootPath, 'logs', 'run', 'kokoro-server.pid'));
      fs.rmSync(KOKORO_DIR, { recursive: true, force: true });
      return { status: 200, data: { success: true, message: 'Kokoro uninstalled successfully' } };
    }

    return { status: 400, data: { error: 'Invalid action. Use "install" or "uninstall".' } };
  } catch (error) {
    return { status: 500, data: { error: String(error), success: false, installed: false } };
  }
};

export const handleRvcAddon: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') {
      const installed = fs.existsSync(RVC_DIR);
      if (!installed) return { status: 200, data: { installed: false } };

      const modelsDir = path.join(rootPath, 'out', 'voices', 'rvc');
      let modelsCount = 0;
      if (fs.existsSync(modelsDir)) {
        modelsCount = fs.readdirSync(modelsDir).filter((name) => {
          return fs.existsSync(path.join(modelsDir, name, 'models', `${name}.pth`));
        }).length;
      }

      return {
        status: 200,
        data: {
          installed: true,
          venvExists: fs.existsSync(path.join(RVC_DIR, 'venv')),
          inferScriptExists: fs.existsSync(path.join(RVC_DIR, 'infer.py')),
          diskUsage: getDirSize(RVC_DIR),
          modelsCount,
        },
      };
    }

    const action = req.body?.action;
    if (action === 'install') {
      if (fs.existsSync(RVC_DIR)) {
        return { status: 500, data: { success: false, error: 'RVC is already installed. Uninstall first to reinstall.' } };
      }
      const result = await runInstallScript('install-rvc.sh');
      return { status: result.success ? 200 : 500, data: result.success ? { ...result, message: 'RVC installed successfully!' } : result };
    }

    if (action === 'uninstall') {
      if (!fs.existsSync(RVC_DIR)) {
        return { status: 200, data: { success: true, message: 'RVC is not installed' } };
      }
      fs.rmSync(RVC_DIR, { recursive: true, force: true });
      return { status: 200, data: { success: true, message: 'RVC uninstalled successfully' } };
    }

    return { status: 400, data: { error: 'Invalid action. Use "install" or "uninstall".' } };
  } catch (error) {
    return { status: 500, data: { error: String(error), success: false, installed: false } };
  }
};

async function getKokoroServerStatus(): Promise<Record<string, unknown>> {
  const pythonBin = path.join(KOKORO_DIR, 'venv', 'bin', 'python3');
  const serverScript = path.join(KOKORO_DIR, 'kokoro_server.py');
  const installed = fs.existsSync(pythonBin) && fs.existsSync(serverScript);
  const pidFile = path.join(rootPath, 'logs', 'run', 'kokoro-server.pid');

  if (!fs.existsSync(pidFile)) {
    return { running: false, installed };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0);
    } catch {
      fs.unlinkSync(pidFile);
      return { running: false, installed };
    }

    const url = 'http://127.0.0.1:9882';
    let healthy = false;
    let lang: string | undefined;
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const data = await response.json() as { lang?: string };
        healthy = true;
        lang = data.lang;
      }
    } catch {
      // Not responding.
    }

    return { running: true, installed, pid, healthy, url, lang };
  } catch {
    return { running: false, installed };
  }
}

async function startKokoroServer(port = 9882, lang = 'a', device = 'cuda'): Promise<Record<string, unknown>> {
  const pidFile = path.join(rootPath, 'logs', 'run', 'kokoro-server.pid');
  const logFile = path.join(rootPath, 'logs', 'run', 'kokoro-server.log');

  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 0);
      return { success: false, error: `Server already running (PID ${pid})` };
    } catch {
      fs.unlinkSync(pidFile);
    }
  }

  const pythonBin = path.join(KOKORO_DIR, 'venv', 'bin', 'python3');
  const serverScript = path.join(KOKORO_DIR, 'kokoro_server.py');
  if (!fs.existsSync(pythonBin)) return { success: false, error: 'Kokoro not installed. Run installation first.' };
  if (!fs.existsSync(serverScript)) return { success: false, error: 'Server script not found. Reinstall Kokoro.' };

  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const logFd = fs.openSync(logFile, 'a');
    const child = spawn(pythonBin, [serverScript, '--port', String(port), '--lang', lang, '--device', device], {
      cwd: KOKORO_DIR,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    fs.writeFileSync(pidFile, String(child.pid));
    fs.closeSync(logFd);

    const url = `http://127.0.0.1:${port}`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          child.unref();
          return { success: true, message: 'Server started successfully', pid: child.pid, url };
        }
      } catch {
        // Continue polling.
      }
    }
    child.unref();
    return { success: true, message: 'Server process started but not responding yet. Check logs.', pid: child.pid, url };
  } catch (error) {
    return { success: false, error: `Failed to start server: ${String(error)}` };
  }
}

async function stopPidServer(pidFile: string, stoppedMessage: string, notRunningMessage: string): Promise<Record<string, unknown>> {
  if (!fs.existsSync(pidFile)) {
    return { success: true, message: notRunningMessage };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 'SIGTERM');

    let stopped = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        process.kill(pid, 0);
      } catch {
        stopped = true;
        break;
      }
    }

    if (!stopped) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already stopped.
      }
    }

    fs.unlinkSync(pidFile);
    return { success: true, message: stoppedMessage };
  } catch (error) {
    return { success: false, error: `Failed to stop server: ${String(error)}` };
  }
}

export const handleKokoroServer: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') return { status: 200, data: await getKokoroServerStatus() };

    const { action, port, lang, device } = req.body ?? {};
    if (action === 'start') {
      let effectiveDevice = device;
      if (!effectiveDevice) {
        try {
          const profilePaths = getProfilePaths(req.user.username);
          if (fs.existsSync(profilePaths.voiceConfig)) {
            const voiceConfig = JSON.parse(fs.readFileSync(profilePaths.voiceConfig, 'utf-8'));
            effectiveDevice = voiceConfig.tts?.kokoro?.device;
          }
        } catch (error) {
          console.warn('[kokoro-server] Failed to read voice config for device setting:', error);
        }
        effectiveDevice = effectiveDevice || 'cuda';
      }

      const result = await startKokoroServer(port || 9882, lang || 'a', effectiveDevice);
      return { status: result.success ? 200 : 500, data: result };
    }

    if (action === 'stop') {
      const result = await stopPidServer(path.join(rootPath, 'logs', 'run', 'kokoro-server.pid'), 'Server stopped successfully', 'Server is not running');
      return { status: result.success ? 200 : 500, data: result };
    }

    return { status: 400, data: { error: 'Invalid action. Use "start" or "stop".' } };
  } catch (error) {
    return { status: 500, data: { error: String(error), success: false, running: false } };
  }
};

async function getRvcServerStatus(): Promise<Record<string, unknown>> {
  const installed = fs.existsSync(RVC_DIR);
  if (!installed) return { running: false, installed: false };

  const rvcPort = 9881;
  let healthy = false;
  let modelLoaded = false;
  let device = 'unknown';

  try {
    const response = await fetch(`http://127.0.0.1:${rvcPort}/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      const data = await response.json() as { status?: string; model_loaded?: boolean; device?: string };
      healthy = data.status === 'healthy';
      modelLoaded = data.model_loaded || false;
      device = data.device || 'unknown';
    }
  } catch {
    // Server not responding.
  }

  const pidFile = path.join(rootPath, 'logs', 'run', 'rvc.pid');
  let pid: number | undefined;
  if (fs.existsSync(pidFile)) {
    const parsedPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (!Number.isNaN(parsedPid)) {
      try {
        process.kill(parsedPid, 0);
        pid = parsedPid;
      } catch {
        fs.unlinkSync(pidFile);
      }
    } else {
      fs.unlinkSync(pidFile);
    }
  }

  return {
    running: healthy || pid !== undefined,
    installed,
    pid,
    port: rvcPort,
    serverUrl: `http://127.0.0.1:${rvcPort}`,
    healthy,
    modelLoaded,
    device,
  };
}

async function startRvcServer(username: string): Promise<Record<string, unknown>> {
  const status = await getRvcServerStatus();
  if (status.running) return { success: false, error: `RVC server already running on port ${status.port} (PID: ${status.pid})` };
  if (!status.installed) return { success: false, error: 'RVC (Applio) not installed. Check external/applio-rvc directory.' };

  const venvPython = path.join(RVC_DIR, 'venv', 'bin', 'python3');
  const serverScript = path.join(RVC_DIR, 'server.py');
  if (!fs.existsSync(venvPython)) return { success: false, error: 'RVC Python environment not found. Reinstall RVC.' };
  if (!fs.existsSync(serverScript)) return { success: false, error: 'RVC server script not found at external/applio-rvc/server.py' };

  const profilePaths = getProfilePaths(username);
  const modelsDir = path.join(profilePaths.out, 'voices', 'rvc-models');
  let device = 'cuda';
  try {
    if (fs.existsSync(profilePaths.voiceConfig)) {
      const voiceConfig = JSON.parse(fs.readFileSync(profilePaths.voiceConfig, 'utf-8'));
      device = voiceConfig?.tts?.rvc?.device || 'cuda';
    }
  } catch {
    console.warn('[rvc-server] Could not read device from voice.json, using default: cuda');
  }

  try {
    const logFile = path.join(rootPath, 'logs', 'run', 'rvc-server.log');
    const pidFile = path.join(rootPath, 'logs', 'run', 'rvc.pid');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const logFd = fs.openSync(logFile, 'a');
    const child = spawn(venvPython, [serverScript, '--port', '9881', '--device', device, '--speaker', 'default', '--models-dir', modelsDir], {
      cwd: RVC_DIR,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    fs.close(logFd, (error) => {
      if (error) console.error('[rvc-server] Error closing log fd:', error);
    });
    child.unref();
    fs.writeFileSync(pidFile, String(child.pid));
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const newStatus = await getRvcServerStatus();
    if (newStatus.running && newStatus.healthy) return { success: true, message: 'RVC server started successfully on port 9881', pid: child.pid, port: 9881 };
    if (newStatus.running && !newStatus.healthy) return { success: true, message: `RVC server started (PID ${child.pid}) but not yet healthy. It may still be initializing.`, pid: child.pid, port: 9881 };
    return { success: false, error: `Server process started but is not responding. Check logs at ${logFile}` };
  } catch (error) {
    return { success: false, error: `Failed to start RVC server: ${String(error)}` };
  }
}

async function stopRvcServer(): Promise<Record<string, unknown>> {
  const pidFile = path.join(rootPath, 'logs', 'run', 'rvc.pid');
  const status = await getRvcServerStatus();
  if (!status.running) {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    return { success: true, message: 'RVC server is not running' };
  }

  try {
    if (typeof status.pid === 'number') {
      process.kill(status.pid, 'SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        process.kill(status.pid, 0);
        process.kill(status.pid, 'SIGKILL');
      } catch {
        // Already stopped.
      }
    } else {
      try {
        const pids = execSync('lsof -t -i:9881', { encoding: 'utf-8' }).trim().split('\n');
        for (const pidStr of pids) {
          const pid = parseInt(pidStr, 10);
          if (!Number.isNaN(pid)) process.kill(pid, 'SIGTERM');
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch {
        // lsof failed or no process found.
      }
    }

    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    return { success: true, message: 'RVC server stopped' };
  } catch (error) {
    return { success: false, error: `Failed to stop RVC server: ${String(error)}` };
  }
}

export const handleRvcServer: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') return { status: 200, data: await getRvcServerStatus() };

    const action = req.body?.action;
    if (action === 'start') {
      const result = await startRvcServer(req.user.username);
      return { status: result.success ? 200 : 500, data: result };
    }
    if (action === 'stop') {
      const result = await stopRvcServer();
      return { status: result.success ? 200 : 500, data: result };
    }
    if (action === 'restart') {
      await stopRvcServer();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await startRvcServer(req.user.username);
      return { status: result.success ? 200 : 500, data: result };
    }

    return { status: 400, data: { error: 'Invalid action. Use "start", "stop", or "restart".' } };
  } catch (error) {
    return { status: 500, data: { error: String(error), success: false, running: false } };
  }
};

async function getSovitsServerStatus(): Promise<Record<string, unknown>> {
  const installed = fs.existsSync(SOVITS_DIR);
  if (!installed) return { running: false, installed: false };

  const pidFile = path.join(rootPath, 'logs', 'run', 'sovits.pid');
  if (!fs.existsSync(pidFile)) return { running: false, installed: true };

  const pidData = JSON.parse(fs.readFileSync(pidFile, 'utf-8'));
  const pid = pidData.pid;
  const port = pidData.port || 9880;

  try {
    process.kill(pid, 0);
  } catch {
    fs.unlinkSync(pidFile);
    return { running: false, installed: true };
  }

  let healthy = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    healthy = response.status >= 200 && response.status < 500;
  } catch {
    // keep unhealthy.
  }

  return { running: true, installed, pid, port, serverUrl: `http://127.0.0.1:${port}`, healthy };
}

async function startSovitsServer(port = 9880): Promise<Record<string, unknown>> {
  const status = await getSovitsServerStatus();
  if (status.running) return { success: false, error: `Server already running on port ${status.port} (PID: ${status.pid})` };
  if (!status.installed) return { success: false, error: 'GPT-SoVITS not installed. Please install it from the Addons tab first.' };

  const venvPython = path.join(SOVITS_DIR, 'venv', 'bin', 'python3');
  let pythonBin = 'python3';
  if (fs.existsSync(venvPython)) {
    pythonBin = venvPython;
  } else {
    for (const cmd of ['python3.11', 'python3.10', 'python3.9', 'python3', 'python']) {
      try {
        execSync(`command -v ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
        pythonBin = cmd;
        break;
      } catch {
        // Try next.
      }
    }
  }

  const serverScript = path.join(SOVITS_DIR, 'api.py');
  if (!fs.existsSync(serverScript)) return { success: false, error: 'GPT-SoVITS server script not found. Installation may be incomplete.' };

  try {
    const pidFile = path.join(rootPath, 'logs', 'run', 'sovits.pid');
    const logFile = path.join(rootPath, 'logs', 'run', 'sovits.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const logFd = fs.openSync(logFile, 'a');
    const child = spawn(pythonBin, [serverScript, '--port', String(port)], {
      cwd: SOVITS_DIR,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    fs.close(logFd, (error) => {
      if (error) console.error('[sovits-server] Error closing log fd:', error);
    });
    child.unref();
    fs.writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, startTime: new Date().toISOString() }));
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const newStatus = await getSovitsServerStatus();
    if (newStatus.running) return { success: true, message: `GPT-SoVITS server started successfully on port ${port}`, pid: child.pid, port };
    return { success: false, error: 'Server process started but is not responding. Check logs for details.' };
  } catch (error) {
    return { success: false, error: `Failed to start server: ${String(error)}` };
  }
}

async function stopSovitsServer(): Promise<Record<string, unknown>> {
  const pidFile = path.join(rootPath, 'logs', 'run', 'sovits.pid');
  const status = await getSovitsServerStatus();
  if (!status.running) {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    return { success: true, message: 'Server is not running' };
  }

  try {
    process.kill(status.pid as number, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      process.kill(status.pid as number, 0);
      process.kill(status.pid as number, 'SIGKILL');
    } catch {
      // already stopped.
    }
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    return { success: true, message: 'GPT-SoVITS server stopped' };
  } catch (error) {
    return { success: false, error: `Failed to stop server: ${String(error)}` };
  }
}

export const handleSovitsServer: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') return { status: 200, data: await getSovitsServerStatus() };

    const { action, port } = req.body ?? {};
    if (action === 'start') {
      const result = await startSovitsServer(port || 9880);
      return { status: result.success ? 200 : 500, data: result };
    }
    if (action === 'stop') {
      const result = await stopSovitsServer();
      return { status: result.success ? 200 : 500, data: result };
    }

    return { status: 400, data: { error: 'Invalid action. Use "start" or "stop".' } };
  } catch (error) {
    return { status: 500, data: { error: String(error), success: false, running: false } };
  }
};
