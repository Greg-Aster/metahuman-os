/**
 * Open Interpreter Backend
 *
 * Escalation backend using Open Interpreter Python server.
 * Provides LLM-agnostic code execution via the MetaHuman LLM proxy.
 *
 * Features:
 * - Multiple language support (Python, Shell, JavaScript)
 * - LLM-agnostic (uses configured LLM proxy)
 * - Auto-start capability
 * - Streaming via SSE
 */

import { audit } from '../audit.js';
import {
  type EscalationBackend,
  type EscalationOptions,
  type EscalationResult,
  registerBackend,
} from '../escalation-backend.js';
import { BACKEND_IDS } from '../escalation-constants.js';
import {
  isInterpreterServerRunning,
  startInterpreterServer,
  stopInterpreterServer,
  executeWithInterpreter,
  executeWithInterpreterStream,
  getInterpreterStatus,
  type InterpreterRequest,
} from '../open-interpreter.js';
import { loadToolExecutorConfig, type OpenInterpreterBackendConfig } from '../tool-executor-config.js';

// ============================================================================
// Open Interpreter Backend Implementation
// ============================================================================

class OpenInterpreterBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.OPEN_INTERPRETER;
  readonly name = 'Open Interpreter';
  readonly description = 'LLM-agnostic code interpreter using Python, Shell, and JavaScript';
  readonly supportsStreaming = true;

  private serverRunning = false;

  /**
   * Check if Open Interpreter server is reachable
   */
  async isAvailable(): Promise<boolean> {
    const config = loadToolExecutorConfig();
    const interpreterConfig = config.backends['open-interpreter'] as OpenInterpreterBackendConfig;

    // If server is running, it's available
    if (await isInterpreterServerRunning(interpreterConfig.endpoint)) {
      return true;
    }

    // If auto-start is enabled, it's potentially available
    if (interpreterConfig.autoStart) {
      return true;
    }

    return false;
  }

  /**
   * Check if server is currently ready
   */
  isReady(): boolean {
    return this.serverRunning;
  }

  /**
   * Start the Open Interpreter server
   */
  async start(): Promise<boolean> {
    try {
      const config = loadToolExecutorConfig();
      const interpreterConfig = config.backends['open-interpreter'] as OpenInterpreterBackendConfig;

      // Check if already running
      if (await isInterpreterServerRunning(interpreterConfig.endpoint)) {
        this.serverRunning = true;
        return true;
      }

      audit({
        level: 'info',
        category: 'system',
        event: 'open_interpreter_starting',
        details: { endpoint: interpreterConfig.endpoint },
        actor: 'open-interpreter-backend',
      });

      const result = await startInterpreterServer();

      if (result.success) {
        this.serverRunning = true;
        audit({
          level: 'info',
          category: 'system',
          event: 'open_interpreter_started',
          details: { endpoint: interpreterConfig.endpoint },
          actor: 'open-interpreter-backend',
        });
        return true;
      } else {
        audit({
          level: 'error',
          category: 'system',
          event: 'open_interpreter_start_failed',
          details: { error: result.error },
          actor: 'open-interpreter-backend',
        });
        return false;
      }
    } catch (error) {
      audit({
        level: 'error',
        category: 'system',
        event: 'open_interpreter_start_failed',
        details: { error: (error as Error).message },
        actor: 'open-interpreter-backend',
      });
      return false;
    }
  }

  /**
   * Stop the Open Interpreter server
   */
  stop(): void {
    try {
      stopInterpreterServer();
      this.serverRunning = false;
      audit({
        level: 'info',
        category: 'system',
        event: 'open_interpreter_stopped',
        details: {},
        actor: 'open-interpreter-backend',
      });
    } catch (error) {
      audit({
        level: 'error',
        category: 'system',
        event: 'open_interpreter_stop_failed',
        details: { error: (error as Error).message },
        actor: 'open-interpreter-backend',
      });
    }
  }

  /**
   * Execute a prompt using Open Interpreter
   */
  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();

    try {
      // Ensure server is running
      const config = loadToolExecutorConfig();
      const interpreterConfig = config.backends['open-interpreter'] as OpenInterpreterBackendConfig;

      if (!(await isInterpreterServerRunning(interpreterConfig.endpoint))) {
        if (interpreterConfig.autoStart) {
          const started = await this.start();
          if (!started) {
            return {
              success: false,
              output: '',
              error: 'Failed to start Open Interpreter server',
              executionTime: Date.now() - startTime,
            };
          }
        } else {
          return {
            success: false,
            output: '',
            error: 'Open Interpreter server is not running',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Build request
      const request: InterpreterRequest = {
        task: prompt,
        context: {
          sessionId: options?.sessionId,
          workingDirectory: options?.workingDirectory,
        },
      };

      // Execute
      const response = await executeWithInterpreter(request, {
        timeout: options?.timeout || 120000,
      });

      // Build output from messages
      let output = response.finalOutput || '';
      if (!output && response.messages.length > 0) {
        output = response.messages
          .filter((m) => m.role === 'assistant' || m.role === 'computer')
          .map((m) => m.content)
          .join('\n');
      }

      return {
        success: response.success,
        output,
        error: response.error,
        executionTime: Date.now() - startTime,
        metadata: {
          taskId: response.taskId,
          iterations: response.metadata?.iterations,
          codeBlocks: response.metadata?.codeBlocks,
          filesModified: response.metadata?.filesModified,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: (error as Error).message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute with streaming output
   */
  async *executeStreaming(
    prompt: string,
    options?: EscalationOptions
  ): AsyncGenerator<string, EscalationResult, unknown> {
    const startTime = Date.now();
    const chunks: string[] = [];

    try {
      // Ensure server is running
      const config = loadToolExecutorConfig();
      const interpreterConfig = config.backends['open-interpreter'] as OpenInterpreterBackendConfig;

      if (!(await isInterpreterServerRunning(interpreterConfig.endpoint))) {
        if (interpreterConfig.autoStart) {
          const started = await this.start();
          if (!started) {
            return {
              success: false,
              output: '',
              error: 'Failed to start Open Interpreter server',
              executionTime: Date.now() - startTime,
            };
          }
        } else {
          return {
            success: false,
            output: '',
            error: 'Open Interpreter server is not running',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Build request
      const request: InterpreterRequest = {
        task: prompt,
        context: {
          sessionId: options?.sessionId,
          workingDirectory: options?.workingDirectory,
        },
      };

      // Stream execution
      const stream = executeWithInterpreterStream(request, {
        timeout: options?.timeout || 120000,
      });

      for await (const message of stream) {
        const chunk = message.content;
        chunks.push(chunk);
        yield chunk;

        // Emit reasoning step if callback provided
        if (options?.onReasoningStep && message.type === 'code') {
          options.onReasoningStep({
            type: 'action',
            content: chunk,
            timestamp: new Date().toISOString(),
          });
        }
      }

      return {
        success: true,
        output: chunks.join(''),
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: chunks.join(''),
        error: (error as Error).message,
        executionTime: Date.now() - startTime,
      };
    }
  }
}

// ============================================================================
// Export Singleton and Register
// ============================================================================

export const openInterpreterBackend = new OpenInterpreterBackendImpl();

// Auto-register when imported
registerBackend(openInterpreterBackend);

// Re-export useful functions for direct access
export {
  isInterpreterServerRunning,
  startInterpreterServer,
  stopInterpreterServer,
  getInterpreterStatus,
};
