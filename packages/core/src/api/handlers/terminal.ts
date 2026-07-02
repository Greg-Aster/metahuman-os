import { exec, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { audit } from '../../audit.js';
import { bigBrotherTerminal } from '../../big-brother-terminal.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

const execAsync = promisify(exec);

const REPO_ROOT = path.resolve(process.cwd(), '../..');
const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
const TTYD_BIN = path.join(REPO_ROOT, 'bin/ttyd');
const BASE_PORT = 3001;
const MAX_TERMINALS = 10;
const BIG_BROTHER_PORT = 3099;

interface RunningTerminal {
  pid: number;
  port: number;
  command?: string;
  cwd?: string;
  isBigBrother?: boolean;
}

const activeTerminals = new Map<number, { pid: number; port: number }>();

async function isPortInUse(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(500),
    });
    return true;
  } catch {
    return false;
  }
}

function unauthenticatedTerminalError(): Error {
  return new Error('No session - redirect to auth gate');
}

export async function handleListTerminals(): Promise<UnifiedResponse> {
  try {
    const { stdout } = await execAsync('pgrep -fa "ttyd --port" || true');
    const terminals: RunningTerminal[] = [];

    if (stdout.trim()) {
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const pidMatch = line.match(/^(\d+)\s+/);
        const portMatch = line.match(/--port\s+(\d+)/);
        const cwdMatch = line.match(/--cwd\s+(\S+)/);

        if (pidMatch && portMatch) {
          const pid = parseInt(pidMatch[1], 10);
          const port = parseInt(portMatch[1], 10);

          let command: string | undefined;
          const bashIndex = line.indexOf(' bash');
          if (bashIndex > -1) {
            const afterBash = line.substring(bashIndex + 5).trim();
            if (afterBash.startsWith('-c ')) {
              command = afterBash.substring(3).trim();
            }
          }

          terminals.push({
            pid,
            port,
            command: command || undefined,
            cwd: cwdMatch?.[1],
          });
        }
      }
    }

    const bigBrotherState = bigBrotherTerminal.getState();
    if (bigBrotherState.isRunning && bigBrotherState.pid) {
      const existingBigBrother = terminals.find(t => t.port === bigBrotherState.port);
      if (!existingBigBrother) {
        terminals.push({
          pid: bigBrotherState.pid,
          port: bigBrotherState.port,
          command: 'claude --dangerously-skip-permissions',
          isBigBrother: true,
        });
      }
    }

    terminals.sort((a, b) => a.port - b.port);

    return successResponse({
      terminals,
      count: terminals.length,
    });
  } catch (error) {
    console.error('[terminal/list] Error:', error);
    return {
      status: 500,
      data: {
        error: 'Failed to list terminals',
        terminals: [],
        count: 0,
      },
    };
  }
}

export async function handleSpawnTerminal(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    let command = 'bash';
    let args: string[] = [];

    const body = req.body;
    if (body && typeof body === 'object' && 'command' in body) {
      const requestedCommand = (body as { command?: unknown }).command;
      if (typeof requestedCommand === 'string' && requestedCommand) {
        command = 'bash';
        args = ['-c', requestedCommand];
      } else if (Array.isArray(requestedCommand) && requestedCommand) {
        command = requestedCommand[0] as string;
        args = requestedCommand.slice(1);
      }
    }

    let port = BASE_PORT;
    let portsChecked = 0;

    while (portsChecked < MAX_TERMINALS) {
      const inUse = await isPortInUse(port);
      if (!inUse) {
        break;
      }
      port++;
      portsChecked++;
    }

    if (portsChecked >= MAX_TERMINALS) {
      return {
        status: 429,
        data: {
          error: `Maximum number of terminals reached (${MAX_TERMINALS})`,
        },
      };
    }

    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const logFile = path.join(LOG_DIR, `terminal-${port}.log`);
    const pidFile = path.join(LOG_DIR, `terminal-${port}.pid`);

    const ttydProcess = spawn(TTYD_BIN, [
      '--port', port.toString(),
      '--writable',
      '--cwd', REPO_ROOT,
      command,
      ...args,
    ], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
    });

    ttydProcess.unref();

    fs.writeFileSync(pidFile, ttydProcess.pid!.toString());
    activeTerminals.set(port, { pid: ttydProcess.pid!, port });

    await new Promise(resolve => setTimeout(resolve, 500));

    return successResponse({
      port,
      pid: ttydProcess.pid,
      url: `http://localhost:${port}`,
    });
  } catch (error) {
    console.error('[Terminal Spawn] Error:', error);
    return {
      status: 500,
      data: {
        error: error instanceof Error ? error.message : 'Failed to spawn terminal',
      },
    };
  }
}

export async function handleSpawnClaudeTerminal(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      throw unauthenticatedTerminalError();
    }

    if (req.user.role !== 'owner') {
      return {
        status: 403,
        data: {
          error: 'Only owners can spawn Big Brother terminal',
        },
      };
    }

    const currentState = bigBrotherTerminal.getState();

    if (currentState.isRunning) {
      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_terminal_already_running',
        details: { port: currentState.port, pid: currentState.pid },
        actor: req.user.username,
      });

      return successResponse({
        port: currentState.port,
        pid: currentState.pid,
        url: `http://localhost:${currentState.port}`,
        alreadyRunning: true,
      });
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_spawning',
      details: { port: BIG_BROTHER_PORT },
      actor: req.user.username,
    });

    const started = await bigBrotherTerminal.start();

    if (!started) {
      throw new Error('Failed to start Big Brother terminal');
    }

    const newState = bigBrotherTerminal.getState();

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_spawned',
      details: { port: newState.port, pid: newState.pid },
      actor: req.user.username,
    });

    return successResponse({
      port: newState.port,
      pid: newState.pid,
      url: `http://localhost:${newState.port}`,
      alreadyRunning: false,
    });
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_terminal_spawn_failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
      actor: 'system',
    });

    return {
      status: 500,
      data: {
        error: error instanceof Error ? error.message : 'Failed to spawn Big Brother terminal',
      },
    };
  }
}

export async function handleStopClaudeTerminal(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      throw unauthenticatedTerminalError();
    }

    const currentState = bigBrotherTerminal.getState();

    if (!currentState.isRunning) {
      return successResponse({
        success: true,
        message: 'No Big Brother terminal running',
      });
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_stopping',
      details: { port: currentState.port, pid: currentState.pid },
      actor: req.user.username,
    });

    await bigBrotherTerminal.stop();

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_killed',
      details: { port: currentState.port, pid: currentState.pid },
      actor: req.user.username,
    });

    return successResponse({
      success: true,
      message: 'Big Brother terminal stopped',
    });
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_terminal_kill_failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
      actor: 'system',
    });

    return {
      status: 500,
      data: {
        error: error instanceof Error ? error.message : 'Failed to stop terminal',
      },
    };
  }
}

export async function handleCleanupTerminals(): Promise<UnifiedResponse> {
  try {
    const { stdout } = await execAsync('pkill -f ttyd || true');

    return successResponse({
      success: true,
      message: 'All terminal processes cleaned up',
      output: stdout,
    });
  } catch (error) {
    console.error('[Terminal Cleanup] Error:', error);
    return {
      status: 500,
      data: {
        error: error instanceof Error ? error.message : 'Failed to cleanup terminals',
      },
    };
  }
}

export async function handleTerminalStatus(): Promise<UnifiedResponse> {
  try {
    const { stdout } = await execAsync('pgrep -fa ttyd || echo "No terminals running"');

    const lines = stdout.trim().split('\n').filter(line => line && !line.includes('No terminals running'));
    const terminals = lines.map(line => {
      const match = line.match(/--port (\d+)/);
      return {
        pid: line.split(' ')[0],
        port: match ? match[1] : 'unknown',
        command: line,
      };
    });

    return successResponse({
      count: terminals.length,
      terminals,
      maxTerminals: 10,
    });
  } catch (error) {
    console.error('[Terminal Status] Error:', error);
    return {
      status: 500,
      data: {
        error: error instanceof Error ? error.message : 'Failed to get terminal status',
      },
    };
  }
}

export async function handleKillTerminal(req: UnifiedRequest): Promise<UnifiedResponse> {
  const port = parseInt(req.params?.id || '', 10);

  if (isNaN(port) || port < 3001 || port > 3100) {
    return {
      status: 400,
      data: {
        error: 'Invalid port number',
        port,
      },
    };
  }

  try {
    const { stdout: pgrepOut } = await execAsync(`pgrep -f "ttyd --port ${port}" || true`);
    const pids = pgrepOut.trim().split('\n').filter(Boolean);

    if (pids.length === 0) {
      return successResponse({
        success: true,
        message: 'No terminal found on this port',
        port,
        killed: false,
      });
    }

    for (const pid of pids) {
      try {
        await execAsync(`kill ${pid}`);
        console.log(`[terminal/kill] Killed ttyd process ${pid} on port ${port}`);
      } catch (killError) {
        console.warn(`[terminal/kill] Failed to kill PID ${pid}:`, killError);
      }
    }

    return successResponse({
      success: true,
      message: `Killed terminal on port ${port}`,
      port,
      killed: true,
      pids: pids.map(p => parseInt(p, 10)),
    });
  } catch (error) {
    console.error(`[terminal/kill] Error killing terminal on port ${port}:`, error);
    return {
      status: 500,
      data: {
        error: 'Failed to kill terminal',
        port,
      },
    };
  }
}
