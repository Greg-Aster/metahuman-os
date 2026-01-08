/**
 * Claude Code Backend - Stream JSON Mode
 *
 * Uses Claude Code CLI's stream-json API for proper programmatic interaction.
 * This is the same API the VS Code extension uses.
 *
 * Clean JSON input/output, no TUI garbage, conversation context maintained.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { audit } from '../audit.js';
import {
  type EscalationBackend,
  type EscalationOptions,
  type EscalationResult,
  type ReasoningStep,
  registerBackend,
} from '../escalation-backend.js';
import { BACKEND_IDS } from '../escalation-constants.js';
import {
  bigBrotherTerminal,
  ensureBigBrotherTerminal,
  isBigBrotherReady,
  getBigBrotherState,
  openBigBrotherTab,
} from '../big-brother-terminal.js';

// Backend display name
const BACKEND_DISPLAY_NAME = 'Claude Code CLI';

// Cache Claude installation check (expensive execSync)
let claudeInstalledCache: boolean | null = null;
let claudeInstalledCacheTime = 0;
const CLAUDE_CACHE_TTL = 60000; // 1 minute cache

// ============================================================================
// Claude Code Backend Implementation
// ============================================================================

class ClaudeCodeBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.CLAUDE_CODE;
  readonly name = BACKEND_DISPLAY_NAME;
  readonly description = "Anthropic's Claude Code CLI using stream-json API";
  readonly supportsStreaming = true;

  /**
   * Check if Claude Code CLI is installed
   */
  async isAvailable(): Promise<boolean> {
    return isClaudeInstalled();
  }

  /**
   * Check if terminal session is ready
   */
  isReady(): boolean {
    return isBigBrotherReady();
  }

  /**
   * Start the Claude Code process
   */
  async start(): Promise<boolean> {
    const started = await ensureBigBrotherTerminal();
    if (started) {
      openBigBrotherTab();
    }
    return started;
  }

  /**
   * Stop the Claude Code process
   */
  stop(): void {
    bigBrotherTerminal.stop();
  }

  /**
   * Execute a prompt and wait for response
   */
  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();
    const username = options?.username;

    try {
      // Ensure Claude is running with correct user context
      if (!this.isReady()) {
        const started = await ensureBigBrotherTerminal(username);
        if (!started) {
          return {
            success: false,
            output: '',
            error: 'Failed to start Claude Code process',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Open the terminal tab in the UI
      openBigBrotherTab();

      audit({
        level: 'info',
        category: 'action',
        event: 'claude_code_execute_start',
        details: {
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 100),
          sessionId: options?.sessionId,
          username,
        },
        actor: 'claude-code-backend',
      });

      // Send prompt and wait for response via stream-json API (no timeout for cloud LLM)
      // Pass username so terminal runs from user's profile directory with their CLAUDE.md
      const response = await bigBrotherTerminal.sendPromptAndWait(prompt, username);

      const executionTime = Date.now() - startTime;

      audit({
        level: 'info',
        category: 'action',
        event: 'claude_code_execute_success',
        details: {
          responseLength: response.length,
          executionTime,
          sessionId: options?.sessionId,
        },
        actor: 'claude-code-backend',
      });

      // Call streaming callbacks if provided
      if (options?.onChunk) {
        options.onChunk(response);
      }

      return {
        success: true,
        output: response,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      audit({
        level: 'error',
        category: 'action',
        event: 'claude_code_execute_error',
        details: {
          error: (error as Error).message,
          executionTime,
          sessionId: options?.sessionId,
        },
        actor: 'claude-code-backend',
      });

      return {
        success: false,
        output: '',
        error: (error as Error).message,
        executionTime,
      };
    }
  }

  /**
   * Execute with streaming output (delegates to execute for now)
   */
  async *executeStreaming(
    prompt: string,
    options?: EscalationOptions
  ): AsyncGenerator<string, EscalationResult, unknown> {
    // For now, just execute and yield the result
    // TODO: Implement true streaming by yielding chunks as they arrive
    const result = await this.execute(prompt, options);

    if (result.success && result.output) {
      yield result.output;
    }

    return result;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if Claude Code CLI is installed (cached to avoid slow execSync)
 */
export function isClaudeInstalled(): boolean {
  const now = Date.now();

  // Return cached result if still valid
  if (claudeInstalledCache !== null && (now - claudeInstalledCacheTime) < CLAUDE_CACHE_TTL) {
    return claudeInstalledCache;
  }

  try {
    // Fast path: check common locations first
    const commonPaths = [
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      path.join(process.env.HOME || '', '.local/bin/claude'),
      path.join(process.env.HOME || '', '.local/share/pnpm/claude'),
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        claudeInstalledCache = true;
        claudeInstalledCacheTime = now;
        return true;
      }
    }

    // Slow path: use which command (only if fast path fails)
    try {
      const result = execSync('which claude 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
      claudeInstalledCache = result.trim().length > 0;
      claudeInstalledCacheTime = now;
      return claudeInstalledCache;
    } catch {
      claudeInstalledCache = false;
      claudeInstalledCacheTime = now;
      return false;
    }
  } catch {
    claudeInstalledCache = false;
    claudeInstalledCacheTime = now;
    return false;
  }
}

// ============================================================================
// Legacy API Compatibility
// ============================================================================

/**
 * Start Claude session
 */
export async function startClaudeSession(_spawnTerminal: boolean = true): Promise<boolean> {
  return ensureBigBrotherTerminal();
}

/**
 * Stop Claude session
 */
export function stopClaudeSession(): void {
  bigBrotherTerminal.stop();
}

/**
 * Check if session is ready
 */
export function isClaudeSessionReady(): boolean {
  return isBigBrotherReady();
}

/**
 * Get session status
 */
export function getSessionStatus(): {
  running: boolean;
  ready: boolean;
  uptime?: number;
  installed: boolean;
  waitingForInput: boolean;
  activeSessionId?: string;
} {
  const state = getBigBrotherState();
  return {
    running: state.isRunning,
    ready: state.claudeReady,
    uptime: state.lastActivity ? Date.now() - state.lastActivity.getTime() : undefined,
    installed: isClaudeInstalled(),
    waitingForInput: false,
    activeSessionId: undefined,
  };
}

/**
 * Send user input
 */
export function sendStdinInput(input: string): boolean {
  bigBrotherTerminal.sendPrompt(input);
  return true;
}

/**
 * Check if waiting for input
 */
export function isWaitingForInput(): boolean {
  return false;
}

/**
 * Send a prompt and wait for response (no timeout for cloud LLM)
 */
export async function sendPrompt(
  prompt: string,
  streaming?: {
    onReasoningStep?: (step: ReasoningStep) => void;
    onChunk?: (chunk: string) => void;
    onWaitingForInput?: (question: string) => void;
    sessionId?: string;
    username?: string;
  }
): Promise<string> {
  const username = streaming?.username;

  // Ensure terminal is started with user context
  if (!isBigBrotherReady()) {
    await ensureBigBrotherTerminal(username);
  }

  const response = await bigBrotherTerminal.sendPromptAndWait(prompt, username);

  // Call streaming callbacks
  if (streaming?.onChunk) {
    streaming.onChunk(response);
  }

  return response;
}

// ============================================================================
// Export Singleton and Register
// ============================================================================

export const claudeCodeBackend = new ClaudeCodeBackendImpl();

// Auto-register when imported
registerBackend(claudeCodeBackend);
