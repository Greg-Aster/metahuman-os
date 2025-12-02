/**
 * TTS Server Manager
 * Centralized lifecycle management for TTS server processes
 * Ensures only one TTS server runs at a time and handles cleanup
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../path-builder.js';
import { audit } from '../audit.js';

export type TTSProvider = 'piper' | 'gpt-sovits' | 'rvc' | 'kokoro';

interface ServerInfo {
  provider: TTSProvider;
  pidFile: string;
  logFile: string;
}

/**
 * Get server info for a TTS provider
 */
function getServerInfo(provider: TTSProvider): ServerInfo | null {
  const runDir = path.join(systemPaths.logs, 'run');

  switch (provider) {
    case 'rvc':
      return {
        provider: 'rvc',
        pidFile: path.join(runDir, 'rvc-server.pid'),
        logFile: path.join(runDir, 'rvc-server.log'),
      };
    case 'kokoro':
      return {
        provider: 'kokoro',
        pidFile: path.join(runDir, 'kokoro-server.pid'),
        logFile: path.join(runDir, 'kokoro-server.log'),
      };
    case 'gpt-sovits':
      return {
        provider: 'gpt-sovits',
        pidFile: path.join(runDir, 'sovits-server.pid'),
        logFile: path.join(runDir, 'sovits-server.log'),
      };
    case 'piper':
      // Piper doesn't use a server
      return null;
    default:
      return null;
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a TTS server by provider name
 * Returns true if server was running and stopped, false otherwise
 */
export async function stopServer(provider: TTSProvider): Promise<boolean> {
  const info = getServerInfo(provider);
  if (!info) {
    // Provider doesn't use a server
    return false;
  }

  // Check if PID file exists
  if (!fs.existsSync(info.pidFile)) {
    console.log(`[ServerManager] No PID file for ${provider}, server not running`);
    return false;
  }

  // Read PID
  const pidStr = fs.readFileSync(info.pidFile, 'utf-8').trim();
  const pid = parseInt(pidStr, 10);

  if (isNaN(pid)) {
    console.warn(`[ServerManager] Invalid PID in ${info.pidFile}: ${pidStr}`);
    fs.unlinkSync(info.pidFile);
    return false;
  }

  // Check if process is actually running
  if (!isProcessRunning(pid)) {
    console.log(`[ServerManager] Process ${pid} for ${provider} not running, cleaning up PID file`);
    fs.unlinkSync(info.pidFile);
    return false;
  }

  console.log(`[ServerManager] Stopping ${provider} server (PID: ${pid})...`);

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, 'SIGTERM');

    // Wait up to 5 seconds for graceful shutdown
    const timeout = 5000;
    const pollInterval = 100;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (!isProcessRunning(pid)) {
        console.log(`[ServerManager] ${provider} server stopped gracefully`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // If still running, force kill
    if (isProcessRunning(pid)) {
      console.warn(`[ServerManager] ${provider} server didn't stop gracefully, sending SIGKILL`);
      process.kill(pid, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Clean up PID file
    if (fs.existsSync(info.pidFile)) {
      fs.unlinkSync(info.pidFile);
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'tts_server_stopped',
      details: { provider, pid },
      actor: 'system',
    });

    return true;
  } catch (error) {
    console.error(`[ServerManager] Error stopping ${provider} server:`, error);

    audit({
      level: 'error',
      category: 'system',
      event: 'tts_server_stop_failed',
      details: { provider, pid, error: (error as Error).message },
      actor: 'system',
    });

    return false;
  }
}

/**
 * Stop all TTS servers
 * Returns count of servers that were stopped
 */
export async function stopAllServers(): Promise<number> {
  const providers: TTSProvider[] = ['rvc', 'kokoro', 'gpt-sovits'];
  let stoppedCount = 0;

  console.log('[ServerManager] Stopping all TTS servers...');

  for (const provider of providers) {
    const stopped = await stopServer(provider);
    if (stopped) {
      stoppedCount++;
    }
  }

  console.log(`[ServerManager] Stopped ${stoppedCount} TTS server(s)`);
  return stoppedCount;
}

/**
 * Get running TTS servers
 * Returns array of providers that have running servers
 */
export function getRunningServers(): TTSProvider[] {
  const providers: TTSProvider[] = ['rvc', 'kokoro', 'gpt-sovits'];
  const running: TTSProvider[] = [];

  for (const provider of providers) {
    const info = getServerInfo(provider);
    if (!info || !fs.existsSync(info.pidFile)) {
      continue;
    }

    const pidStr = fs.readFileSync(info.pidFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (!isNaN(pid) && isProcessRunning(pid)) {
      running.push(provider);
    }
  }

  return running;
}

/**
 * Clean up stale PID files (processes that aren't running)
 */
export function cleanupStalePidFiles(): number {
  const providers: TTSProvider[] = ['rvc', 'kokoro', 'gpt-sovits'];
  let cleaned = 0;

  for (const provider of providers) {
    const info = getServerInfo(provider);
    if (!info || !fs.existsSync(info.pidFile)) {
      continue;
    }

    const pidStr = fs.readFileSync(info.pidFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid) || !isProcessRunning(pid)) {
      console.log(`[ServerManager] Cleaning stale PID file for ${provider} (PID: ${pid})`);
      fs.unlinkSync(info.pidFile);
      cleaned++;
    }
  }

  return cleaned;
}
