import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { audit } from '../../audit.js';
import {
  BIG_BROTHER_SESSION_PORT,
  getBigBrotherSessionState,
  stopBigBrotherSession,
} from '../../big-brother-session.js';
import { ROOT as REPO_ROOT } from '../../path-builder.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
const TTYD_BIN = path.join(REPO_ROOT, 'bin/ttyd');
const BASE_PORT = 3001;
const MAX_TERMINALS = 10;
const TERMINAL_HOST = '127.0.0.1';
const TERMINAL_START_TIMEOUT_MS = 5000;
const TERMINAL_START_POLL_MS = 50;

export interface RunningTerminal {
  pid: number | null;
  port: number;
  command?: string;
  cwd?: string;
  isBigBrother?: boolean;
  bigBrotherProvider?: string | null;
}

const activeTerminals = new Map<number, { pid: number; port: number }>();
let terminalSpawnQueue: Promise<void> = Promise.resolve();

async function withTerminalSpawnLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = terminalSpawnQueue;
  let release = () => {};
  terminalSpawnQueue = new Promise<void>(resolve => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export function parseTtydCommand(pid: number, argv: string[]): RunningTerminal | null {
  if (!Number.isInteger(pid) || pid <= 1 || path.basename(argv[0] || '') !== 'ttyd') return null;
  const portIndex = argv.indexOf('--port');
  if (portIndex < 0) return null;
  const port = Number.parseInt(argv[portIndex + 1] || '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;

  const cwdIndex = argv.indexOf('--cwd');
  const bashIndex = argv.findIndex(value => path.basename(value) === 'bash');
  const command = bashIndex >= 0 && argv[bashIndex + 1] === '-c'
    ? argv[bashIndex + 2]
    : undefined;

  return {
    pid,
    port,
    command,
    cwd: cwdIndex >= 0 ? argv[cwdIndex + 1] : undefined,
  };
}

async function listTtydProcesses(): Promise<RunningTerminal[]> {
  const terminals: RunningTerminal[] = [];

  for (let port = BASE_PORT; port < BASE_PORT + MAX_TERMINALS; port++) {
    const pidFile = terminalPidPath(port);
    const activePid = activeTerminals.get(port)?.pid;
    const storedPid = fs.existsSync(pidFile)
      ? Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
      : undefined;
    const pid = activePid ?? storedPid;
    if (!pid || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
      removeOwnedPidFile(port);
      activeTerminals.delete(port);
      continue;
    }

    try {
      process.kill(pid, 0);
      if (process.platform === 'linux') {
        const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
        const terminal = parseTtydCommand(pid, argv);
        if (!terminal || argv[0] !== TTYD_BIN || terminal.port !== port) {
          removeOwnedPidFile(port, storedPid);
          activeTerminals.delete(port);
          continue;
        }
        terminals.push(terminal);
      } else {
        terminals.push({ pid, port });
      }
    } catch {
      removeOwnedPidFile(port, storedPid);
      activeTerminals.delete(port);
    }
  }

  return terminals;
}

export async function isTerminalPortInUse(
  port: number,
  host = TERMINAL_HOST,
  timeoutMs = 500,
): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (inUse: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

export async function findAvailableTerminalPort(
  reservedPorts: ReadonlySet<number>,
  portInUse: (port: number) => Promise<boolean> = isTerminalPortInUse,
): Promise<number | null> {
  for (let candidate = BASE_PORT; candidate < BASE_PORT + MAX_TERMINALS; candidate++) {
    if (reservedPorts.has(candidate)) continue;
    if (!await portInUse(candidate)) return candidate;
  }

  return null;
}

async function waitForTerminalReady(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + TERMINAL_START_TIMEOUT_MS;
  let spawnError: Error | null = null;
  const handleError = (error: Error) => {
    spawnError = error;
  };
  child.once('error', handleError);

  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        const reason = child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode}`;
        throw new Error(`ttyd exited before opening port ${port} (${reason})`);
      }
      if (await isTerminalPortInUse(port)) return;
      await new Promise(resolve => setTimeout(resolve, TERMINAL_START_POLL_MS));
    }
  } finally {
    child.off('error', handleError);
  }

  throw new Error(`ttyd did not become ready on port ${port} within ${TERMINAL_START_TIMEOUT_MS}ms`);
}

function terminalPidPath(port: number): string {
  return path.join(LOG_DIR, `terminal-${port}.pid`);
}

function removeOwnedPidFile(port: number, pid?: number): void {
  const pidFile = terminalPidPath(port);
  try {
    if (!fs.existsSync(pidFile)) return;
    if (pid !== undefined && fs.readFileSync(pidFile, 'utf8').trim() !== String(pid)) return;
    fs.unlinkSync(pidFile);
  } catch (error) {
    console.warn(`[terminal] Failed to remove PID file for port ${port}:`, error);
  }
}

function terminalUrl(port: number): string {
  return `http://localhost:${port}`;
}

export async function handleListTerminals(): Promise<UnifiedResponse> {
  try {
    const terminals = await listTtydProcesses();

    const bigBrotherState = getBigBrotherSessionState();
    if (bigBrotherState.sessionOpen) {
      const existingBigBrother = terminals.find(t => t.port === bigBrotherState.port);
      if (existingBigBrother) {
        existingBigBrother.isBigBrother = true;
        existingBigBrother.bigBrotherProvider = bigBrotherState.provider;
        existingBigBrother.command = `big-brother:${bigBrotherState.provider || 'unknown'}`;
      } else {
        terminals.push({
          pid: bigBrotherState.pid,
          port: bigBrotherState.port,
          command: `big-brother:${bigBrotherState.provider || 'unknown'}`,
          isBigBrother: true,
          bigBrotherProvider: bigBrotherState.provider,
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
  return withTerminalSpawnLock(async () => {
    try {
      let command = 'bash';
      let args: string[] = [];
      const body = req.body;
      const purpose = body && typeof body === 'object' && typeof body.purpose === 'string'
        ? body.purpose
        : 'adhoc';

      if (body && typeof body === 'object' && 'command' in body) {
        const requestedCommand = (body as { command?: unknown }).command;
        if (typeof requestedCommand === 'string' && requestedCommand) {
          command = 'bash';
          args = ['-c', requestedCommand];
        } else if (Array.isArray(requestedCommand) && requestedCommand.length > 0) {
          command = requestedCommand[0] as string;
          args = requestedCommand.slice(1) as string[];
        }
      }

      const runningTerminals = await listTtydProcesses();
      const reusable = purpose === 'services'
        ? runningTerminals.find(terminal => terminal.command?.includes('start-services'))
        : purpose === 'default-shell'
          ? runningTerminals.find(terminal => !terminal.command && !terminal.isBigBrother)
          : undefined;

      if (reusable) {
        return successResponse({
          port: reusable.port,
          pid: reusable.pid,
          url: terminalUrl(reusable.port),
          alreadyRunning: true,
        });
      }

      const processPorts = new Set(runningTerminals.map(terminal => terminal.port));
      for (const activePort of activeTerminals.keys()) {
        processPorts.add(activePort);
      }
      const port = await findAvailableTerminalPort(processPorts);

      if (port === null) {
        return {
          status: 429,
          data: { error: `Maximum number of terminals reached (${MAX_TERMINALS})` },
        };
      }

      fs.mkdirSync(LOG_DIR, { recursive: true });
      const logFile = path.join(LOG_DIR, `terminal-${port}.log`);
      const pidFile = terminalPidPath(port);
      const logFd = fs.openSync(logFile, 'a');
      let ttydProcess: ChildProcess;

      try {
        ttydProcess = spawn(TTYD_BIN, [
          '--interface', TERMINAL_HOST,
          '--port', port.toString(),
          '--writable',
          '--cwd', REPO_ROOT,
          command,
          ...args,
        ], {
          detached: true,
          stdio: ['ignore', logFd, logFd],
        });
      } finally {
        fs.closeSync(logFd);
      }

      const pid = ttydProcess.pid;
      if (!pid) throw new Error('ttyd did not return a process ID');

      activeTerminals.set(port, { pid, port });

      ttydProcess.once('exit', () => {
        if (activeTerminals.get(port!)?.pid === pid) {
          activeTerminals.delete(port!);
        }
        removeOwnedPidFile(port!, pid);
      });

      try {
        await waitForTerminalReady(ttydProcess, port);
      } catch (error) {
        activeTerminals.delete(port);
        removeOwnedPidFile(port, pid);
        if (ttydProcess.exitCode === null && ttydProcess.signalCode === null) {
          ttydProcess.kill('SIGTERM');
        }
        throw error;
      }

      fs.writeFileSync(pidFile, String(pid));
      ttydProcess.unref();

      audit({
        level: 'info',
        category: 'action',
        event: 'terminal_spawned',
        details: { port, pid, purpose, command },
        actor: req.user.username,
      });

      return successResponse({
        port,
        pid,
        url: terminalUrl(port),
        alreadyRunning: false,
      });
    } catch (error) {
      console.error('[Terminal Spawn] Error:', error);
      audit({
        level: 'error',
        category: 'action',
        event: 'terminal_spawn_failed',
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
        actor: req.user.username,
      });
      return {
        status: 500,
        data: {
          error: error instanceof Error ? error.message : 'Failed to spawn terminal',
        },
      };
    }
  });
}

export async function handleCleanupTerminals(): Promise<UnifiedResponse> {
  try {
    const terminals = await listTtydProcesses();
    for (const terminal of terminals) {
      if (!terminal.pid) continue;
      try {
        process.kill(-terminal.pid, 'SIGTERM');
      } catch {
        try { process.kill(terminal.pid, 'SIGTERM'); } catch { /* already exited */ }
      }
    }
    await stopBigBrotherSession('All terminals cleaned up by user');
    activeTerminals.clear();
    for (let port = BASE_PORT; port < BASE_PORT + MAX_TERMINALS; port++) {
      removeOwnedPidFile(port);
    }

    return successResponse({
      success: true,
      message: 'All terminal processes cleaned up',
      stopped: terminals.length,
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
    const terminals = await listTtydProcesses();
    const bigBrotherState = getBigBrotherSessionState();
    if (bigBrotherState.sessionOpen) {
      const existingBigBrother = terminals.find(terminal => terminal.port === bigBrotherState.port);
      if (existingBigBrother) {
        existingBigBrother.isBigBrother = true;
        existingBigBrother.bigBrotherProvider = bigBrotherState.provider;
        existingBigBrother.command = `big-brother:${bigBrotherState.provider || 'unknown'}`;
      } else {
        terminals.push({
          pid: bigBrotherState.pid,
          port: bigBrotherState.port,
          command: `big-brother:${bigBrotherState.provider || 'unknown'}`,
          isBigBrother: true,
          bigBrotherProvider: bigBrotherState.provider,
        });
      }
    }

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
    if (port === BIG_BROTHER_SESSION_PORT) {
      const state = getBigBrotherSessionState();
      await stopBigBrotherSession('Big Brother terminal killed by user');
      return successResponse({
        success: true,
        message: 'Stopped Big Brother terminal',
        port,
        killed: state.sessionOpen || state.processRunning,
        pids: state.pid ? [state.pid] : [],
      });
    }

    const pids = (await listTtydProcesses())
      .filter(terminal => terminal.port === port)
      .map(terminal => terminal.pid)
      .filter((pid): pid is number => pid !== null);

    if (pids.length === 0) {
      activeTerminals.delete(port);
      removeOwnedPidFile(port);
      return successResponse({
        success: true,
        message: 'No terminal found on this port',
        port,
        killed: false,
      });
    }

    for (const pid of pids) {
      try {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          process.kill(pid, 'SIGTERM');
        }
        console.log(`[terminal/kill] Killed ttyd process ${pid} on port ${port}`);
      } catch (killError) {
        console.warn(`[terminal/kill] Failed to kill PID ${pid}:`, killError);
      }
    }

    activeTerminals.delete(port);
    removeOwnedPidFile(port);

    return successResponse({
      success: true,
      message: `Killed terminal on port ${port}`,
      port,
      killed: true,
      pids,
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
