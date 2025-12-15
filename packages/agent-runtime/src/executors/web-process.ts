/**
 * Web Process Executor
 *
 * Runs agents as separate processes using spawn/fork.
 * Provides true isolation - agent crashes don't affect the server.
 *
 * Used on web/desktop where process spawning is available.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { Executor } from './interface.js';
import type { AgentContext, AgentInput, AgentResult, AgentModule } from '../types.js';
import { DEFAULT_TIMEOUT, errorResult, timeoutResult } from './interface.js';

/**
 * Check if we can spawn processes (not available on mobile)
 */
function canSpawnProcesses(): boolean {
  try {
    // Check if spawn is available and functional
    return typeof spawn === 'function';
  } catch {
    return false;
  }
}

/**
 * Resolve tsx binary path
 */
function resolveTsx(rootDir: string): string {
  const candidates = [
    path.join(rootDir, 'apps', 'site', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
    path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'tsx'; // Fall back to global
}

/**
 * Process-based executor for web/desktop platforms
 */
export class WebProcessExecutor implements Executor {
  readonly name = 'web-process';
  private rootDir: string;
  private runningProcesses = new Map<string, ChildProcess>();

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * Check if process spawning is available
   */
  isAvailable(): boolean {
    return canSpawnProcesses();
  }

  /**
   * Run agent as a separate process
   */
  async run(
    agent: AgentModule,
    ctx: AgentContext,
    input: AgentInput,
    timeout: number = DEFAULT_TIMEOUT
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const agentId = agent.meta.id;

    // Resolve CLI path for this agent
    const cliPath = path.join(this.rootDir, 'brain', 'agents', agentId, 'cli.ts');

    // Fall back to legacy single-file agent if new structure doesn't exist
    const legacyPath = path.join(this.rootDir, 'brain', 'agents', `${agentId}.ts`);
    const agentPath = fs.existsSync(cliPath) ? cliPath : legacyPath;

    if (!fs.existsSync(agentPath)) {
      return {
        success: false,
        error: `Agent file not found: ${agentPath}`,
        duration: Date.now() - startTime,
      };
    }

    const tsx = resolveTsx(this.rootDir);
    const args = input.args || [];

    console.log(`[web-process] Starting agent: ${agentId} via ${tsx}`);

    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout;
      let resolved = false;

      const child = spawn(tsx, [agentPath, ...args], {
        cwd: this.rootDir,
        env: {
          ...process.env,
          METAHUMAN_USERNAME: ctx.username,
          METAHUMAN_DATA_DIR: ctx.dataDir,
          NODE_PATH: [
            path.join(this.rootDir, 'node_modules'),
            path.join(this.rootDir, 'packages/cli/node_modules'),
            path.join(this.rootDir, 'apps/site/node_modules'),
          ].join(':'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.runningProcesses.set(agentId, child);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn(`[web-process] Agent '${agentId}' timeout, killing process...`);
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000); // Force kill after 5s
          this.runningProcesses.delete(agentId);
          resolve(timeoutResult(agentId, timeout));
        }
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        this.runningProcesses.delete(agentId);

        if (resolved) return;
        resolved = true;

        const duration = Date.now() - startTime;
        console.log(`[web-process] Agent '${agentId}' exited with code ${code} in ${duration}ms`);

        if (code === 0) {
          resolve({
            success: true,
            data: { stdout, stderr },
            duration,
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Process exited with code ${code}`,
            duration,
          });
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        this.runningProcesses.delete(agentId);

        if (resolved) return;
        resolved = true;

        resolve(errorResult(error));
      });
    });
  }

  /**
   * Cancel a running agent
   */
  cancel(agentId: string): boolean {
    const process = this.runningProcesses.get(agentId);
    if (process) {
      process.kill('SIGTERM');
      return true;
    }
    return false;
  }
}

/**
 * Singleton instance
 */
let instance: WebProcessExecutor | null = null;

/**
 * Get the web process executor instance
 */
export function getWebExecutor(rootDir: string): WebProcessExecutor {
  if (!instance) {
    instance = new WebProcessExecutor(rootDir);
  }
  return instance;
}
