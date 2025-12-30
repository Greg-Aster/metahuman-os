/**
 * Qwen Code Backend
 *
 * Escalation backend using Qwen Code CLI (fork of Gemini CLI for local Qwen models).
 *
 * Features:
 * - Local Qwen model support
 * - Code-focused execution
 */

import { execSync } from 'child_process';
import { audit } from '../audit.js';
import {
  type EscalationBackend,
  type EscalationOptions,
  type EscalationResult,
  registerBackend,
} from '../escalation-backend.js';
import { BACKEND_IDS } from '../escalation-constants.js';
import { executeWithQwenCode } from '../legacy-cli-adapters.js';
import { loadToolExecutorConfig, type CLIBackendConfig } from '../tool-executor-config.js';

// ============================================================================
// Qwen Code Backend Implementation
// ============================================================================

class QwenCodeBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.QWEN_CODE;
  readonly name = 'Qwen Code';
  readonly description = 'Local Qwen model CLI for code tasks';
  readonly supportsStreaming = false;

  private ready = false;

  /**
   * Check if Qwen Code CLI is installed
   */
  async isAvailable(): Promise<boolean> {
    return isQwenCodeInstalled();
  }

  /**
   * Qwen Code is ready if installed (no session to maintain)
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Mark as ready (Qwen Code doesn't need session startup)
   */
  async start(): Promise<boolean> {
    if (await this.isAvailable()) {
      this.ready = true;
      audit({
        level: 'info',
        category: 'system',
        event: 'qwen_code_backend_ready',
        details: {},
        actor: 'qwen-code-backend',
      });
      return true;
    }
    return false;
  }

  /**
   * Mark as not ready
   */
  stop(): void {
    this.ready = false;
  }

  /**
   * Execute a prompt using Qwen Code CLI
   */
  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();

    try {
      const config = loadToolExecutorConfig();
      const qwenConfig = config.backends['qwen-code'] as CLIBackendConfig;

      if (!qwenConfig.enabled) {
        return {
          success: false,
          output: '',
          error: 'Qwen Code backend is not enabled in configuration',
          executionTime: Date.now() - startTime,
        };
      }

      // Execute using legacy adapter
      const result = await executeWithQwenCode(prompt, qwenConfig);

      return {
        success: result.success,
        output: result.output || '',
        error: result.error,
        executionTime: Date.now() - startTime,
        metadata: result.metadata,
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
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if Qwen Code CLI is installed
 */
function isQwenCodeInstalled(): boolean {
  try {
    execSync('which qwen-code', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Export Singleton and Register
// ============================================================================

export const qwenCodeBackend = new QwenCodeBackendImpl();

// Auto-register when imported
registerBackend(qwenCodeBackend);
