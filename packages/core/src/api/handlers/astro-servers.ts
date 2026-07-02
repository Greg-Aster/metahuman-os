import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { UnifiedHandler } from '../types.js';

const execAsync = promisify(exec);
const ASTRO_DEV_PORTS = [4321, 4322, 4323, 4324, 4325];

function parsePort(value: unknown): number | null {
  const port = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function currentPortFromHost(headers?: Record<string, string>): number {
  const host = headers?.host || headers?.Host;
  const match = host?.match(/:(\d+)$/);
  return match ? parseInt(match[1], 10) : 4321;
}

async function pidsForPort(port: number): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`lsof -ti:${port}`, { timeout: 2000 });
    return stdout.trim().split('\n').filter((pid) => /^\d+$/.test(pid));
  } catch {
    return [];
  }
}

async function commandForPid(pid: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`ps -p ${pid} -o cmd=`, { timeout: 1000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function stopPids(pids: string[]): Promise<number[]> {
  const stopped: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(parseInt(pid, 10), 'SIGTERM');
      stopped.push(parseInt(pid, 10));
    } catch {
      // Process may have exited between discovery and stop.
    }
  }
  return stopped;
}

export const handleGetAstroServers: UnifiedHandler = async (req) => {
  try {
    const currentPort = currentPortFromHost(req.headers);
    const servers: Array<{
      port: number;
      pid: number;
      command: string;
      isCurrentServer: boolean;
    }> = [];

    for (const port of ASTRO_DEV_PORTS) {
      const pids = await pidsForPort(port);

      for (const pid of pids) {
        const command = await commandForPid(pid);
        if (!command) {
          continue;
        }

        if (command.includes('astro') || command.includes('node') || command.includes('vite')) {
          servers.push({
            port,
            pid: parseInt(pid, 10),
            command: command.length > 60 ? `${command.substring(0, 57)}...` : command,
            isCurrentServer: port === currentPort,
          });
          break;
        }
      }
    }

    return {
      status: 200,
      data: {
        running: servers.length > 0,
        servers,
        currentPort,
      },
    };
  } catch (error) {
    console.error('[api/astro-servers] Error checking status:', error);
    return {
      status: 500,
      data: {
        running: false,
        error: String(error),
        servers: [],
      },
    };
  }
};

export const handlePostAstroServers: UnifiedHandler = async (req) => {
  try {
    const { action } = req.body ?? {};

    if (action === 'stop') {
      const port = parsePort(req.body?.port);
      if (!port) {
        return { status: 400, data: { success: false, error: 'Invalid action or missing port' } };
      }

      const pids = await pidsForPort(port);
      if (pids.length === 0) {
        return { status: 404, data: { success: false, error: 'No process found on this port' } };
      }

      const stoppedPids = await stopPids(pids);
      return {
        status: 200,
        data: {
          success: true,
          message: `Stopped ${stoppedPids.length} process(es) on port ${port}`,
          stoppedPids,
        },
      };
    }

    if (action === 'stop-all') {
      const stopped: number[] = [];

      for (const port of ASTRO_DEV_PORTS) {
        const pids = await pidsForPort(port);
        stopped.push(...await stopPids(pids));
      }

      return {
        status: 200,
        data: {
          success: true,
          message: `Stopped ${stopped.length} process(es)`,
          stoppedPids: stopped,
        },
      };
    }

    return { status: 400, data: { success: false, error: 'Invalid action or missing port' } };
  } catch (error) {
    console.error('[api/astro-servers] Error:', error);
    return {
      status: 500,
      data: {
        success: false,
        error: String(error),
      },
    };
  }
};
