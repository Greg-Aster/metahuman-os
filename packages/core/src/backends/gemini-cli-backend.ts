/**
 * Gemini CLI Backend
 *
 * Escalation backend using Google's Gemini CLI.
 *
 * Features:
 * - Google Gemini model access
 * - Non-interactive execution
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
import { executeWithGeminiCLI } from '../legacy-cli-adapters.js';
import { loadToolExecutorConfig, type CLIBackendConfig } from '../tool-executor-config.js';

// ============================================================================
// Gemini CLI Backend Implementation
// ============================================================================

class GeminiCLIBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.GEMINI_CLI;
  readonly name = 'Gemini CLI';
  readonly description = "Google's Gemini command-line interface";
  readonly supportsStreaming = false;

  private ready = false;

  /**
   * Check if Gemini CLI is installed
   */
  async isAvailable(): Promise<boolean> {
    return isGeminiInstalled();
  }

  /**
   * Gemini is ready if installed (no session to maintain)
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Mark as ready (Gemini doesn't need session startup)
   */
  async start(): Promise<boolean> {
    if (await this.isAvailable()) {
      this.ready = true;
      audit({
        level: 'info',
        category: 'system',
        event: 'gemini_cli_backend_ready',
        details: {},
        actor: 'gemini-cli-backend',
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
   * Execute a prompt using Gemini CLI
   */
  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();

    try {
      const config = loadToolExecutorConfig();
      const geminiConfig = config.backends['gemini-cli'] as CLIBackendConfig;

      if (!geminiConfig.enabled) {
        return {
          success: false,
          output: '',
          error: 'Gemini CLI backend is not enabled in configuration',
          executionTime: Date.now() - startTime,
        };
      }

      // Execute using legacy adapter
      const result = await executeWithGeminiCLI(prompt, geminiConfig);

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
 * Check if Gemini CLI is installed
 */
function isGeminiInstalled(): boolean {
  try {
    execSync('which gemini', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Export Singleton and Register
// ============================================================================

export const geminiCLIBackend = new GeminiCLIBackendImpl();

// Auto-register when imported
registerBackend(geminiCLIBackend);
