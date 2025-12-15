/**
 * Mobile In-Process Executor
 *
 * Runs agents in the same process with safety guards:
 * - try/catch for crash containment
 * - timeout enforcement
 * - abort signal support
 *
 * Used on mobile where spawning separate processes isn't available.
 */

import type { Executor } from './interface.js';
import type { AgentContext, AgentInput, AgentResult, AgentModule } from '../types.js';
import { DEFAULT_TIMEOUT, errorResult, withTimeout } from './interface.js';

/**
 * In-process executor for mobile platforms
 */
export class MobileInProcExecutor implements Executor {
  readonly name = 'mobile-inproc';

  /**
   * Always available - this is the fallback executor
   */
  isAvailable(): boolean {
    return true;
  }

  /**
   * Run agent in-process with safety guards
   */
  async run(
    agent: AgentModule,
    ctx: AgentContext,
    input: AgentInput,
    timeout: number = DEFAULT_TIMEOUT
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const agentId = agent.meta.id;

    console.log(`[mobile-inproc] Starting agent: ${agentId}`);

    try {
      // Create abort controller for timeout
      const abortController = new AbortController();
      const contextWithAbort: AgentContext = {
        ...ctx,
        signal: abortController.signal,
      };

      // Set up timeout to abort
      const timeoutId = setTimeout(() => {
        console.warn(`[mobile-inproc] Agent '${agentId}' timeout, aborting...`);
        abortController.abort();
      }, timeout);

      try {
        // Run with timeout wrapper
        const result = await withTimeout(
          agent.run(contextWithAbort, input),
          timeout,
          agentId
        );

        clearTimeout(timeoutId);

        // Attach duration
        result.duration = Date.now() - startTime;

        console.log(`[mobile-inproc] Agent '${agentId}' completed in ${result.duration}ms`);
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const result = errorResult(error);
      result.duration = duration;

      console.error(`[mobile-inproc] Agent '${agentId}' failed:`, (error as Error).message);
      return result;
    }
  }
}

/**
 * Singleton instance
 */
let instance: MobileInProcExecutor | null = null;

/**
 * Get the mobile in-process executor instance
 */
export function getMobileExecutor(): MobileInProcExecutor {
  if (!instance) {
    instance = new MobileInProcExecutor();
  }
  return instance;
}
