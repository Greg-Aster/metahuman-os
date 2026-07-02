import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { errorResponse, successResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';
import { systemPaths } from '../../path-builder.js';

function getVoiceConfigPath(username: string, fallbackToSystem = false): string | null {
  const storageResult = storageClient.getProfileRoot(username);
  if (storageResult.success && storageResult.profileRoot) {
    return path.join(storageResult.profileRoot, 'etc', 'voice.json');
  }
  return fallbackToSystem ? path.join(systemPaths.etc, 'voice.json') : null;
}

function readJsonFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) throw new Error('empty');
  return JSON.parse(content);
}

export const handleWhisperServer: UnifiedHandler = async (req) => {
  if (req.method === 'GET') {
    return getWhisperServerStatus(req.user.username);
  }
  return updateWhisperServer(req.user.username, req.body?.action);
};

async function getWhisperServerStatus(username: string) {
  try {
    const voiceConfigPath = getVoiceConfigPath(username, true);
    if (!voiceConfigPath || !fs.existsSync(voiceConfigPath)) {
      return successResponse({ running: false, installed: false, healthy: false, error: 'Voice config not found' });
    }

    let config: any;
    try {
      config = readJsonFile(voiceConfigPath);
    } catch (error) {
      const message = (error as Error).message === 'empty' ? 'Voice config is empty' : 'Voice config is invalid JSON';
      return successResponse({ running: false, installed: false, healthy: false, error: message });
    }

    const serverUrl = config.stt?.whisper?.server?.url || 'http://127.0.0.1:9883';
    const pythonBin = path.join(systemPaths.root, 'venv', 'bin', 'python3');
    const serverScript = path.join(systemPaths.root, 'external', 'whisper', 'whisper_server.py');
    const installed = fs.existsSync(pythonBin) && fs.existsSync(serverScript);

    let running = false;
    let healthy = false;
    let healthData: Record<string, unknown> = {};
    try {
      const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        healthData = await response.json() as Record<string, unknown>;
        running = true;
        healthy = healthData.status === 'ok';
      }
    } catch {
      // Server is not responding.
    }

    return successResponse({ running, installed, healthy, ...healthData });
  } catch (error) {
    console.error('[whisper-server] Error checking status:', error);
    return successResponse({ running: false, error: String(error) }, 500);
  }
}

async function updateWhisperServer(username: string, action: string | undefined) {
  try {
    const rootDir = systemPaths.root;
    const voiceConfigPath = getVoiceConfigPath(username);
    if (!voiceConfigPath) return errorResponse('Failed to resolve profile storage', 500);
    if (!fs.existsSync(voiceConfigPath)) return errorResponse('Voice config not found', 404);

    const config = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
    const whisperConfig = config.stt?.whisper;
    if (!whisperConfig) return errorResponse('Whisper not configured', 400);

    if (action === 'start') {
      const pythonBin = path.join(rootDir, 'venv', 'bin', 'python3');
      const serverScript = path.join(rootDir, 'external', 'whisper', 'whisper_server.py');
      const logFile = path.join(rootDir, 'logs', 'run', 'whisper-server.log');
      const pidFile = path.join(rootDir, 'logs', 'run', 'whisper-server.pid');

      if (!fs.existsSync(pythonBin)) return errorResponse('Python venv not found', 500);
      if (!fs.existsSync(serverScript)) return errorResponse('Whisper server script not found', 500);

      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const logFd = fs.openSync(logFile, 'a');

      const model = whisperConfig.model || 'base.en';
      const device = whisperConfig.device || 'cpu';
      let computeType = whisperConfig.computeType || 'int8';
      if (device === 'cuda' && computeType === 'int8') computeType = 'float16';
      const port = whisperConfig.server?.port || 9883;

      const child = spawn(pythonBin, [
        serverScript,
        '--model', model,
        '--device', device,
        '--compute-type', computeType,
        '--port', String(port),
      ], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: rootDir,
      });

      fs.writeFileSync(pidFile, String(child.pid));
      child.unref();

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const serverUrl = whisperConfig.server?.url || 'http://127.0.0.1:9883';
      try {
        const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return successResponse({ success: true, message: 'Whisper server started' });
      } catch {
        return successResponse({ success: false, error: 'Server failed to start (check logs)' }, 500);
      }

      return successResponse({ success: true, message: 'Whisper server start initiated' });
    }

    if (action === 'stop') {
      const pidFile = path.join(rootDir, 'logs', 'run', 'whisper-server.pid');
      if (!fs.existsSync(pidFile)) return successResponse({ success: true, message: 'Server not running' });

      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
        process.kill(pid, 'SIGTERM');
        fs.unlinkSync(pidFile);
        return successResponse({ success: true, message: 'Whisper server stopped' });
      } catch (error) {
        return successResponse({ success: false, error: String(error) }, 500);
      }
    }

    return errorResponse('Invalid action. Use "start" or "stop"', 400);
  } catch (error) {
    console.error('[whisper-server] Error:', error);
    return errorResponse(String(error), 500);
  }
}
