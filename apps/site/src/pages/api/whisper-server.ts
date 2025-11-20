import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getAuthenticatedUser, getProfilePaths, getUserOrAnonymous, systemPaths } from '@metahuman/core';

/**
 * GET: Check Whisper server status
 * POST: Start/stop Whisper server
 */
const getHandler: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const profilePaths = getProfilePaths(user.username);
    const rootPaths = systemPaths;
    const voiceConfigPath = profilePaths.voiceConfig;
    if (!fs.existsSync(voiceConfigPath)) {
      return new Response(
        JSON.stringify({ running: false, error: 'Voice config not found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const config = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
    const serverUrl = config.stt?.whisper?.server?.url || 'http://127.0.0.1:9883';

    // Check if faster-whisper is installed
    const pythonBin = path.join(rootPaths.root, 'venv', 'bin', 'python3');
    const serverScript = path.join(rootPaths.root, 'external', 'whisper', 'whisper_server.py');
    const installed = fs.existsSync(pythonBin) && fs.existsSync(serverScript);

    // Check if server is running
    let running = false;
    let healthy = false;
    let healthData: any = {};

    try {
      const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        healthData = await response.json();
        running = true;
        healthy = healthData.status === 'ok';
      }
    } catch {
      // Server not running
    }

    return new Response(
      JSON.stringify({
        running,
        installed,
        healthy,
        ...healthData,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[whisper-server] Error checking status:', error);
    return new Response(
      JSON.stringify({ running: false, error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const postHandler: APIRoute = async ({ request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { action } = body;

    const rootDir = systemPaths.root;
    const profilePaths = getProfilePaths(user.username);
    const voiceConfigPath = profilePaths.voiceConfig;

    if (!fs.existsSync(voiceConfigPath)) {
      return new Response(
        JSON.stringify({ error: 'Voice config not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const config = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
    const whisperConfig = config.stt?.whisper;

    if (!whisperConfig) {
      return new Response(
        JSON.stringify({ error: 'Whisper not configured' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'start') {
      // Start Whisper server
      const pythonBin = path.join(rootDir, 'venv', 'bin', 'python3');
      const serverScript = path.join(rootDir, 'external', 'whisper', 'whisper_server.py');
      const logFile = path.join(rootDir, 'logs', 'run', 'whisper-server.log');
      const pidFile = path.join(rootDir, 'logs', 'run', 'whisper-server.pid');

      if (!fs.existsSync(pythonBin)) {
        return new Response(
          JSON.stringify({ error: 'Python venv not found' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!fs.existsSync(serverScript)) {
        return new Response(
          JSON.stringify({ error: 'Whisper server script not found' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Ensure log directory exists
      fs.mkdirSync(path.dirname(logFile), { recursive: true });

      const logFd = fs.openSync(logFile, 'a');

      const model = whisperConfig.model || 'base.en';
      const device = whisperConfig.device || 'cpu';
      let computeType = whisperConfig.computeType || 'int8';

      // Auto-adjust compute type for GPU
      if (device === 'cuda' && computeType === 'int8') {
        computeType = 'float16';
      }

      const port = whisperConfig.server?.port || 9883;

      const args = [
        serverScript,
        '--model', model,
        '--device', device,
        '--compute-type', computeType,
        '--port', port.toString(),
      ];

      const child = spawn(pythonBin, args, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: rootDir,
      });

      fs.writeFileSync(pidFile, child.pid!.toString());
      child.unref();

      // Wait a bit for server to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify it started
      const serverUrl = whisperConfig.server?.url || 'http://127.0.0.1:9883';
      try {
        const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          return new Response(
            JSON.stringify({ success: true, message: 'Whisper server started' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } catch {
        return new Response(
          JSON.stringify({ success: false, error: 'Server failed to start (check logs)' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Whisper server start initiated' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    } else if (action === 'stop') {
      // Stop Whisper server
      const pidFile = path.join(rootDir, 'logs', 'run', 'whisper-server.pid');

      if (!fs.existsSync(pidFile)) {
        return new Response(
          JSON.stringify({ success: true, message: 'Server not running' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
        process.kill(pid, 'SIGTERM');
        fs.unlinkSync(pidFile);

        return new Response(
          JSON.stringify({ success: true, message: 'Whisper server stopped' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({ success: false, error: String(error) }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use "start" or "stop"' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('[whisper-server] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// MIGRATED: explicit authentication (GET/POST require authenticated user)
export const GET = getHandler;
export const POST = postHandler;
