import { spawn } from 'node:child_process';
import path from 'node:path';
import type { UnifiedHandler, UnifiedRequest } from '../types.js';
import { streamResponse } from '../types.js';
import { systemPaths } from '../../path-builder.js';

const ALLOWED_COMMANDS = new Set([
  'bash',
  'sh',
  'python3',
  'python',
  'node',
  'tsx',
  'pnpm',
  'npm',
  'ollama',
]);

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function* runProcessStream(req: UnifiedRequest): AsyncIterable<string> {
  const { command, args = [], cwd, env } = req.body ?? {};
  const workingDir = cwd ? path.resolve(systemPaths.root, cwd) : systemPaths.root;

  const proc = spawn(command, Array.isArray(args) ? args : [], {
    cwd: workingDir,
    stdio: 'pipe',
    env: { ...process.env, ...(env && typeof env === 'object' ? env : {}) },
  });

  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  const push = (chunk: string): void => {
    queue.push(chunk);
    if (wake) {
      wake();
      wake = null;
    }
  };

  const close = (): void => {
    closed = true;
    if (wake) {
      wake();
      wake = null;
    }
  };

  req.signal?.addEventListener('abort', () => {
    try {
      proc.kill('SIGTERM');
    } catch {
      // Process may already be gone.
    }
    close();
  }, { once: true });

  push(event('start', {
    command,
    args,
    cwd: workingDir,
    pid: proc.pid,
    message: 'Process started',
  }));

  proc.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((line: string) => line.trim());
    for (const line of lines) {
      console.log(`[Process ${proc.pid}]`, line);
      push(event('log', { level: 'info', message: line }));
    }
  });

  proc.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((line: string) => line.trim());
    for (const line of lines) {
      console.error(`[Process ${proc.pid} Error]`, line);
      push(event('log', { level: 'error', message: line }));
    }
  });

  proc.on('close', (code) => {
    if (code === 0) {
      push(event('complete', {
        success: true,
        code,
        message: 'Process completed successfully',
      }));
    } else {
      push(event('complete', {
        success: false,
        code,
        error: `Process exited with code ${code}`,
      }));
    }
    close();
  });

  proc.on('error', (error) => {
    push(event('error', { message: error.message }));
    close();
  });

  while (!closed || queue.length > 0) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }

    if (closed) {
      break;
    }

    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

export const handleProcessStream: UnifiedHandler = async (req) => {
  const { command } = req.body ?? {};

  if (!command) {
    return { status: 400, data: { error: 'Missing command parameter' } };
  }

  if (!ALLOWED_COMMANDS.has(command)) {
    return {
      status: 403,
      data: {
        error: `Command not allowed: ${command}. Allowed: ${Array.from(ALLOWED_COMMANDS).join(', ')}`,
      },
    };
  }

  return streamResponse(runProcessStream(req));
};
