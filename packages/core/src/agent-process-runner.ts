import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from './audit.js';
import { isLocked } from './locks.js';
import { ROOT, systemPaths } from './path-builder.js';
import {
  buildAgentNodePath,
  resolveAgentExecutablePath,
  resolveTsx,
} from './agent-executable-resolver.js';
import {
  clearAgentFailure,
  isAgentRunning,
  recordAgentFailure,
  registerAgent,
  unregisterAgent,
} from './agent-monitor-registry.js';

export interface AgentStartResult {
  agent: string;
  started: boolean;
  success?: boolean;
  pid?: number;
  error?: string;
  exitCode?: number | null;
  stderr?: string;
  stdout?: string;
  completed?: boolean;
  alreadyRunning?: boolean;
}

export interface StartAgentProcessOptions {
  actor?: string;
  source: string;
  args?: string[];
  triggerUsername?: string;
  useBootstrap?: boolean;
  waitForMs?: number;
  detached?: boolean;
  checkLock?: boolean;
  readyPattern?: RegExp;
}

export function outputExcerpt(chunks: string[]): string | undefined {
  const text = chunks.join('').trim();
  if (!text) return undefined;
  return text.length > 2000 ? text.slice(-2000) : text;
}

function failedStart(
  agentName: string,
  source: string,
  error: string,
  details: Pick<AgentStartResult, 'pid' | 'exitCode' | 'stderr' | 'stdout'> = {},
): AgentStartResult {
  recordAgentFailure({
    agent: agentName,
    error,
    source,
    ...details,
  });
  return {
    agent: agentName,
    started: false,
    success: false,
    error,
    ...details,
  };
}

function failureMessage(agentName: string, code: number | null, stderr?: string): string {
  return stderr || `Agent ${agentName} exited with code ${code ?? 'unknown'}`;
}

export async function startAgentProcess(agentName: string, options: StartAgentProcessOptions): Promise<AgentStartResult> {
  const actor = options.actor ?? 'system';
  const source = options.source;
  const args = options.args ?? [];
  const detached = options.detached ?? true;
  const useBootstrap = options.useBootstrap ?? true;
  const waitForMs = options.waitForMs ?? 0;

  try {
    if (isAgentRunning(agentName)) {
      return { agent: agentName, started: false, success: false, alreadyRunning: true };
    }

    if (options.checkLock && isLocked(`agent-${agentName}`)) {
      return { agent: agentName, started: false, success: false, alreadyRunning: true, error: 'Agent is already running' };
    }

    const bootstrapPath = path.join(systemPaths.brain, 'scripts', '_bootstrap.ts');
    const agentPath = resolveAgentExecutablePath(agentName);
    if (!agentPath) {
      return failedStart(agentName, source, 'Agent file not found');
    }
    if (useBootstrap && !fs.existsSync(bootstrapPath)) {
      return failedStart(agentName, source, 'Agent bootstrap not found');
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_PATH: buildAgentNodePath(),
    };
    if (options.triggerUsername) {
      env.MH_TRIGGER_USERNAME = options.triggerUsername;
    }

    const commandArgs = useBootstrap ? [bootstrapPath, agentName, ...args] : [agentPath, ...args];
    const child = spawn(resolveTsx(), commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
      detached,
      env,
    });

    const pid = child.pid;
    if (!pid) {
      return failedStart(agentName, source, 'Failed to spawn process');
    }

    registerAgent(agentName, pid);
    audit({
      level: 'info',
      category: 'system',
      event: 'agent_started',
      details: { agent: agentName, pid, args, source },
      actor,
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let closeCode: number | null = null;
    type ImmediateResult = { type: 'running' } | { type: 'error'; error: Error } | { type: 'closed' };
    let finishImmediate: ((result: ImmediateResult) => void) | undefined;
    const immediateResultPromise = waitForMs > 0
      ? new Promise<ImmediateResult>((resolve) => {
          let resolved = false;
          finishImmediate = (result) => {
            if (resolved) return;
            resolved = true;
            resolve(result);
          };
          child.once('error', error => finishImmediate?.({ type: 'error', error }));
          child.once('close', () => finishImmediate?.({ type: 'closed' }));
          const timer = setTimeout(() => finishImmediate?.({ type: 'running' }), waitForMs);
          timer.unref?.();
        })
      : undefined;

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdoutChunks.push(text);
      if (options.readyPattern?.test(text)) {
        finishImmediate?.({ type: 'running' });
      }
      console.log(`[Agent: ${agentName}] ${text.trim()}`);
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrChunks.push(text);
      console.error(`[Agent: ${agentName}] ${text.trim()}`);
    });

    child.once('close', (code: number | null) => {
      closeCode = code;
      const stderr = outputExcerpt(stderrChunks);
      const stdout = outputExcerpt(stdoutChunks);
      audit({
        level: code === 0 ? 'info' : 'error',
        category: 'system',
        event: 'agent_stopped',
        details: { agent: agentName, exitCode: code, source },
        actor,
      });
      unregisterAgent(agentName);
      if (code === 0) {
        clearAgentFailure(agentName);
      } else {
        recordAgentFailure({
          agent: agentName,
          pid,
          exitCode: code,
          error: failureMessage(agentName, code, stderr),
          stderr,
          stdout,
          source,
        });
      }
    });

    const immediateResult = await immediateResultPromise;

    if (detached) {
      child.unref();
    }

    if (immediateResult?.type === 'error') {
      unregisterAgent(agentName);
      const stderr = outputExcerpt(stderrChunks);
      const stdout = outputExcerpt(stdoutChunks);
      recordAgentFailure({
        agent: agentName,
        pid,
        error: immediateResult.error.message,
        stderr,
        stdout,
        source,
      });
      return {
        agent: agentName,
        started: false,
        success: false,
        pid,
        error: immediateResult.error.message,
        stderr,
        stdout,
      };
    }

    if (immediateResult?.type === 'closed') {
      const stderr = outputExcerpt(stderrChunks);
      const stdout = outputExcerpt(stdoutChunks);
      if (closeCode === 0) {
        return {
          agent: agentName,
          started: true,
          success: true,
          pid,
          completed: true,
          exitCode: closeCode,
          stderr,
          stdout,
        };
      }
      return {
        agent: agentName,
        started: false,
        success: false,
        pid,
        exitCode: closeCode,
        error: failureMessage(agentName, closeCode, stderr),
        stderr,
        stdout,
      };
    }

    return { agent: agentName, started: true, success: true, pid };
  } catch (error) {
    return failedStart(
      agentName,
      source,
      error instanceof Error ? error.message : String(error),
    );
  }
}
