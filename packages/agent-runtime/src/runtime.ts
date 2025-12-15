/**
 * Agent Runtime
 *
 * Main entry point for running agents.
 * Automatically selects the appropriate executor for the platform.
 *
 * Usage:
 *   const runtime = getRuntime(rootDir);
 *   const result = await runtime.run('profile-sync', ctx, input);
 */

import type { AgentContext, AgentInput, AgentResult, ResultEnvelope, RunOptions } from './types.js';
import type { Executor } from './executors/interface.js';
import { DEFAULT_TIMEOUT } from './executors/interface.js';
import { getAgent, hasAgent } from './registry.js';
import { getMobileExecutor } from './executors/mobile-inproc.js';
import { getWebExecutor } from './executors/web-process.js';

/**
 * Detect if we're running on mobile (nodejs-mobile)
 */
function isMobilePlatform(): boolean {
  // nodejs-mobile sets specific environment or has limited capabilities
  try {
    // Check for common mobile indicators
    if (typeof process !== 'undefined') {
      // nodejs-mobile typically doesn't have full child_process support
      // or runs in a specific mobile environment
      const { spawn } = require('node:child_process');
      // Try to detect if spawn would work
      return typeof spawn !== 'function';
    }
  } catch {
    return true; // If we can't load child_process, we're on mobile
  }
  return false;
}

/**
 * Agent Runtime class
 */
export class AgentRuntime {
  private rootDir: string;
  private executor: Executor;
  private isMobile: boolean;

  constructor(rootDir: string, forceMobile?: boolean) {
    this.rootDir = rootDir;
    this.isMobile = forceMobile ?? isMobilePlatform();

    // Select executor based on platform
    if (this.isMobile) {
      this.executor = getMobileExecutor();
      console.log('[agent-runtime] Using mobile in-process executor');
    } else {
      this.executor = getWebExecutor(rootDir);
      console.log('[agent-runtime] Using web process executor');
    }
  }

  /**
   * Get the current executor name
   */
  getExecutorName(): string {
    return this.executor.name;
  }

  /**
   * Check if an agent is registered
   */
  hasAgent(agentId: string): boolean {
    return hasAgent(agentId);
  }

  /**
   * Run an agent by ID
   */
  async run(
    agentId: string,
    ctx: AgentContext,
    input: AgentInput = {},
    options: RunOptions = {}
  ): Promise<ResultEnvelope> {
    const startedAt = new Date().toISOString();
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    // Get agent from registry
    const agent = getAgent(agentId);
    if (!agent) {
      return {
        agentId,
        startedAt,
        completedAt: new Date().toISOString(),
        result: {
          success: false,
          error: `Agent '${agentId}' not found in registry`,
        },
        executor: this.executor.name,
      };
    }

    console.log(`[agent-runtime] Running agent: ${agentId} (executor: ${this.executor.name})`);

    // Run via executor
    const result = await this.executor.run(agent, ctx, input, timeout);

    const envelope: ResultEnvelope = {
      agentId,
      startedAt,
      completedAt: new Date().toISOString(),
      result,
      executor: this.executor.name,
    };

    console.log(`[agent-runtime] Agent '${agentId}' finished: success=${result.success}`);

    return envelope;
  }

  /**
   * Run an agent in the background (fire-and-forget)
   * Returns immediately with a promise that resolves when done
   */
  runBackground(
    agentId: string,
    ctx: AgentContext,
    input: AgentInput = {},
    options: RunOptions = {}
  ): { promise: Promise<ResultEnvelope>; agentId: string } {
    const promise = this.run(agentId, ctx, input, options);
    return { promise, agentId };
  }

  /**
   * Cancel a running agent (if supported by executor)
   */
  cancel(agentId: string): boolean {
    if (this.executor.cancel) {
      return this.executor.cancel(agentId);
    }
    return false;
  }
}

/**
 * Singleton runtime instance
 */
let runtimeInstance: AgentRuntime | null = null;

/**
 * Get or create the agent runtime
 */
export function getRuntime(rootDir: string, forceMobile?: boolean): AgentRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new AgentRuntime(rootDir, forceMobile);
  }
  return runtimeInstance;
}

/**
 * Reset runtime (for testing)
 */
export function resetRuntime(): void {
  runtimeInstance = null;
}
