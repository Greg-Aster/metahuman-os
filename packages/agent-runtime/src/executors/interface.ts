/**
 * Executor Interface
 *
 * Executors are responsible for actually running agents.
 * Each platform has its own executor implementation:
 * - Web: spawn/fork processes
 * - Mobile: in-process with safety guards
 */

import type { AgentContext, AgentInput, AgentResult, AgentModule } from '../types.js';

/**
 * Executor interface - all executors must implement this
 */
export interface Executor {
  /** Unique name for this executor */
  readonly name: string;

  /**
   * Check if this executor is available on the current platform
   */
  isAvailable(): boolean;

  /**
   * Run an agent
   *
   * @param agent - The agent module to run
   * @param ctx - Execution context
   * @param input - Input parameters
   * @param timeout - Timeout in milliseconds
   * @returns Promise resolving to AgentResult
   */
  run(
    agent: AgentModule,
    ctx: AgentContext,
    input: AgentInput,
    timeout?: number
  ): Promise<AgentResult>;

  /**
   * Cancel a running agent (if supported)
   * @param agentId - ID of the agent to cancel
   * @returns true if cancellation was requested
   */
  cancel?(agentId: string): boolean;
}

/**
 * Default timeout for agent execution (5 minutes)
 */
export const DEFAULT_TIMEOUT = 5 * 60 * 1000;

/**
 * Create a timeout error result
 */
export function timeoutResult(agentId: string, timeout: number): AgentResult {
  return {
    success: false,
    error: `Agent '${agentId}' timed out after ${timeout}ms`,
  };
}

/**
 * Create an error result from an exception
 */
export function errorResult(error: unknown): AgentResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: message,
  };
}

/**
 * Wrap agent execution with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  agentId: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Agent '${agentId}' timed out after ${timeout}ms`));
    }, timeout);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}
