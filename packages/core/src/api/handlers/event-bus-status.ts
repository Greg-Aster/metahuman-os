import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler, UnifiedResponse } from '../types.js';

const LOG_PREFIX = '[event-bus-status]';
const EVENT_BUS_PORT = 3100;
const EVENT_BUS_ENDPOINT = `http://localhost:${EVENT_BUS_PORT}`;

function getRepoRoot(): string {
  return path.resolve(process.cwd(), '..', '..');
}

function eventBusPaths(): {
  repoRoot: string;
  serverPath: string;
  tsxPath: string;
  logDir: string;
  logFile: string;
  pidFile: string;
} {
  const repoRoot = getRepoRoot();
  const logDir = path.join(repoRoot, 'logs', 'run');

  return {
    repoRoot,
    serverPath: path.join(repoRoot, 'packages', 'core', 'src', 'infrastructure', 'event-bus', 'server.ts'),
    tsxPath: path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
    logDir,
    logFile: path.join(logDir, 'event-bus.log'),
    pidFile: path.join(logDir, 'event-bus.pid'),
  };
}

async function checkEventBusHealth(timeoutMs = 2000): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${EVENT_BUS_ENDPOINT}/health`, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    return null;
  }

  return await response.json() as Record<string, unknown>;
}

function stopEventBusProcesses(): string[] {
  const stoppedPids: string[] = [];

  try {
    const result = execSync(
      `lsof -n -t -iTCP:${EVENT_BUS_PORT} -sTCP:LISTEN 2>/dev/null || true`
    ).toString().trim();

    if (result) {
      const pids = result.split('\n').filter(Boolean);
      console.log(`${LOG_PREFIX} Found processes on port ${EVENT_BUS_PORT}: ${pids.join(', ')}`);

      for (const pid of pids) {
        try {
          process.kill(parseInt(pid, 10), 'SIGTERM');
          console.log(`${LOG_PREFIX} Sent SIGTERM to PID ${pid}`);
          stoppedPids.push(pid);
        } catch (killError) {
          console.warn(`${LOG_PREFIX} Failed to kill PID ${pid}:`, killError);
        }
      }
    } else {
      console.log(`${LOG_PREFIX} No processes found on port ${EVENT_BUS_PORT}`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error finding/killing processes:`, error);
  }

  return stoppedPids;
}

function validateStartPaths(paths: ReturnType<typeof eventBusPaths>): UnifiedResponse | null {
  if (!fs.existsSync(paths.serverPath)) {
    console.error(`${LOG_PREFIX} ERROR: Server script not found at ${paths.serverPath}`);
    return {
      status: 500,
      data: {
        success: false,
        error: `Server script not found at ${paths.serverPath}`,
      },
    };
  }

  if (!fs.existsSync(paths.tsxPath)) {
    console.error(`${LOG_PREFIX} ERROR: tsx executable not found at ${paths.tsxPath}`);
    return {
      status: 500,
      data: {
        success: false,
        error: `tsx executable not found at ${paths.tsxPath}`,
      },
    };
  }

  return null;
}

async function startEventBus(paths: ReturnType<typeof eventBusPaths>): Promise<UnifiedResponse> {
  const invalid = validateStartPaths(paths);
  if (invalid) {
    return invalid;
  }

  fs.mkdirSync(paths.logDir, { recursive: true });
  const logFd = fs.openSync(paths.logFile, 'a');

  console.log(`${LOG_PREFIX} Starting event bus server...`);

  const child = spawn(paths.tsxPath, [paths.serverPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: paths.repoRoot,
    env: { ...process.env, NODE_ENV: 'production' },
  });

  if (child.pid) {
    fs.writeFileSync(paths.pidFile, child.pid.toString());
    console.log(`${LOG_PREFIX} Server started with PID: ${child.pid}`);
  }

  child.unref();
  fs.closeSync(logFd);

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const health = await checkEventBusHealth();
    if (health) {
      console.log(`${LOG_PREFIX} Server is healthy!`);
      return {
        status: 200,
        data: {
          success: true,
          message: 'Event bus server started successfully',
          pid: child.pid,
        },
      };
    }
  } catch (healthError) {
    console.warn(`${LOG_PREFIX} Health check failed, but server may still be starting:`, healthError);
  }

  return {
    status: 200,
    data: {
      success: true,
      message: 'Event bus server starting... (check logs/run/event-bus.log for details)',
      pid: child.pid,
      logFile: paths.logFile,
    },
  };
}

export const handleGetEventBusStatus: UnifiedHandler = async () => {
  try {
    const data = await checkEventBusHealth();

    if (data) {
      return {
        status: 200,
        data: {
          running: true,
          healthy: true,
          port: EVENT_BUS_PORT,
          endpoint: EVENT_BUS_ENDPOINT,
          uptime: data.uptime,
          eventCount: data.eventCount,
          subscribers: data.subscribers,
        },
      };
    }

    return {
      status: 200,
      data: {
        running: false,
        healthy: false,
        port: EVENT_BUS_PORT,
        endpoint: EVENT_BUS_ENDPOINT,
      },
    };
  } catch (error) {
    return {
      status: 200,
      data: {
        running: false,
        healthy: false,
        port: EVENT_BUS_PORT,
        endpoint: EVENT_BUS_ENDPOINT,
        error: (error as Error).message,
      },
    };
  }
};

export const handlePostEventBusStatus: UnifiedHandler = async (req) => {
  try {
    const action = req.body?.action;
    const paths = eventBusPaths();

    if (action === 'start') {
      console.log(`${LOG_PREFIX} ========== START REQUEST ==========`);
      console.log(`${LOG_PREFIX} Repo root: ${paths.repoRoot}`);
      console.log(`${LOG_PREFIX} Server path: ${paths.serverPath}`);
      console.log(`${LOG_PREFIX} Log file: ${paths.logFile}`);
      return await startEventBus(paths);
    }

    if (action === 'stop') {
      console.log(`${LOG_PREFIX} ========== STOP REQUEST ==========`);
      const stoppedPids = stopEventBusProcesses();

      if (fs.existsSync(paths.pidFile)) {
        fs.unlinkSync(paths.pidFile);
        console.log(`${LOG_PREFIX} Removed PID file`);
      }

      return {
        status: 200,
        data: {
          success: true,
          message: stoppedPids.length > 0
            ? `Event bus server stopped (PIDs: ${stoppedPids.join(', ')})`
            : 'Event bus server was not running',
        },
      };
    }

    if (action === 'restart') {
      console.log(`${LOG_PREFIX} ========== RESTART REQUEST ==========`);
      stopEventBusProcesses();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return await startEventBus(paths);
    }

    return {
      status: 400,
      data: {
        success: false,
        error: `Unknown action: ${action}`,
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
};
