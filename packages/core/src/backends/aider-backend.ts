/**
 * Aider Backend
 *
 * Escalation backend using Aider AI pair programming CLI.
 * Integrates with git for code changes.
 *
 * Features:
 * - Git-aware code editing
 * - Multiple LLM support
 * - Auto-commit capability
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
import { executeWithAider } from '../legacy-cli-adapters.js';
import { loadToolExecutorConfig, type CLIBackendConfig } from '../tool-executor-config.js';

// ============================================================================
// Aider Backend Implementation
// ============================================================================

class AiderBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.AIDER;
  readonly name = 'Aider';
  readonly description = 'AI pair programming tool with git integration';
  readonly supportsStreaming = false;

  private ready = false;

  /**
   * Check if Aider CLI is installed
   */
  async isAvailable(): Promise<boolean> {
    return isAiderInstalled();
  }

  /**
   * Aider is ready if installed (no session to maintain)
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Mark as ready (Aider doesn't need session startup)
   */
  async start(): Promise<boolean> {
    if (await this.isAvailable()) {
      this.ready = true;
      audit({
        level: 'info',
        category: 'system',
        event: 'aider_backend_ready',
        details: {},
        actor: 'aider-backend',
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
   * Execute a prompt using Aider CLI
   */
  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();

    try {
      const config = loadToolExecutorConfig();
      const aiderConfig = config.backends['aider'] as CLIBackendConfig;

      if (!aiderConfig.enabled) {
        return {
          success: false,
          output: '',
          error: 'Aider backend is not enabled in configuration',
          executionTime: Date.now() - startTime,
        };
      }

      // Execute using legacy adapter
      const result = await executeWithAider(prompt, aiderConfig);

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
 * Check if Aider CLI is installed
 */
function isAiderInstalled(): boolean {
  try {
    execSync('which aider', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Export Singleton and Register
// ============================================================================

export const aiderBackend = new AiderBackendImpl();

// Auto-register when imported
registerBackend(aiderBackend);
