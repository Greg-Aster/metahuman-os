/**
 * Claude Code Backend - Interactive Terminal Mode
 *
 * This backend runs Claude Code in a visible, interactive terminal
 * within the MetaHuman OS program. All Claude interactions happen
 * in the terminal where the user can see and interact with them.
 *
 * NO background processes - everything is visible in the terminal.
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
  onBigBrotherOutput,
  type TerminalOutputEvent,
} from '../big-brother-terminal.js';

// Backend display name
const BACKEND_DISPLAY_NAME = 'Claude Code CLI';

// ============================================================================
// Types
// ============================================================================

interface PendingPrompt {
  prompt: string;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  outputBuffer: string;
  startTime: number;
  timeout: NodeJS.Timeout;
  streaming?: {
    onReasoningStep?: (step: ReasoningStep) => void;
    onChunk?: (chunk: string) => void;
    onWaitingForInput?: (question: string) => void;
    sessionId?: string;
  };
}

// ============================================================================
// State
// ============================================================================

let pendingPrompt: PendingPrompt | null = null;
let outputUnsubscribe: (() => void) | null = null;
let isInitialized = false;

// ============================================================================
// Claude Code Backend Implementation
// ============================================================================

class ClaudeCodeBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.CLAUDE_CODE;
  readonly name = BACKEND_DISPLAY_NAME;
  readonly description = "Anthropic's Claude Code CLI running in an interactive terminal";
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
   * Start the interactive terminal session
   */
  async start(): Promise<boolean> {
    const started = await ensureBigBrotherTerminal();
    if (started && !isInitialized) {
      initializeOutputCapture();
      isInitialized = true;
    }
    return started;
  }

  /**
   * Stop the terminal session
   */
  stop(): void {
    if (outputUnsubscribe) {
      outputUnsubscribe();
      outputUnsubscribe = null;
    }
    isInitialized = false;
    bigBrotherTerminal.stop();
  }

  /**
   * Execute a prompt by sending it to the interactive terminal
   */
  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();

    try {
      // Ensure terminal is running
      if (!this.isReady()) {
        const started = await this.start();
        if (!started) {
          return {
            success: false,
            output: '',
            error: 'Failed to start Big Brother terminal',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // CRITICAL: Ensure output capture is initialized even if terminal was already running
      // (e.g., started by boot endpoint before this backend was invoked)
      if (!isInitialized) {
        console.log('[claude-code-backend] Initializing output capture for existing terminal');
        initializeOutputCapture();
        isInitialized = true;
      }

      // Send prompt to terminal and wait for response
      const response = await sendPromptToTerminal(prompt, options?.timeout || 600000, {
        onReasoningStep: options?.onReasoningStep,
        onChunk: options?.onChunk,
        onWaitingForInput: options?.onWaitingForInput,
        sessionId: options?.sessionId,
      });

      return {
        success: true,
        output: response,
        executionTime: Date.now() - startTime,
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
      // Ensure terminal is running
      if (!this.isReady()) {
        const started = await this.start();
        if (!started) {
          return {
            success: false,
            output: '',
            error: 'Failed to start Big Brother terminal',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Use sendPromptToTerminal with chunk callback
      const response = await sendPromptToTerminal(prompt, options?.timeout || 600000, {
        onReasoningStep: options?.onReasoningStep,
        onChunk: (chunk) => {
          chunks.push(chunk);
          options?.onChunk?.(chunk);
        },
        sessionId: options?.sessionId,
      });

      return {
        success: true,
        output: response,
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
// Helper Functions
// ============================================================================

/**
 * Check if Claude Code CLI is installed
 */
export function isClaudeInstalled(): boolean {
  try {
    const commonPaths = [
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      path.join(process.env.HOME || '', '.local/bin/claude'),
      path.join(process.env.HOME || '', '.local/share/pnpm/claude'),
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }

    try {
      const result = execSync('which claude 2>/dev/null', { encoding: 'utf8' });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Initialize output capture from the terminal
 */
function initializeOutputCapture(): void {
  if (outputUnsubscribe) {
    outputUnsubscribe();
  }

  console.log('[claude-code-backend] Setting up output capture listener');

  outputUnsubscribe = onBigBrotherOutput((event: TerminalOutputEvent) => {
    // Log all output events for debugging
    console.log(`[claude-code-backend] Output event: type=${event.type}, contentLen=${event.content?.length || 0}, hasPending=${!!pendingPrompt}`);

    if (!pendingPrompt) {
      console.log('[claude-code-backend] No pending prompt, ignoring output');
      return;
    }

    if (event.type === 'output') {
      // Accumulate output
      pendingPrompt.outputBuffer += event.content;
      console.log(`[claude-code-backend] Buffer now: ${pendingPrompt.outputBuffer.length} chars`);

      // Stream to callback
      if (pendingPrompt.streaming?.onChunk) {
        pendingPrompt.streaming.onChunk(event.content);
      }

      // Parse for reasoning steps
      parseAndEmitReasoningSteps(event.content, pendingPrompt.streaming);

      // Check if response is complete
      // Claude shows its prompt again when ready for new input
      if (isResponseComplete(pendingPrompt.outputBuffer)) {
        console.log('[claude-code-backend] Response detected as complete');
        completeCurrentPrompt();
      }
    }
  });

  audit({
    level: 'info',
    category: 'system',
    event: 'claude_terminal_output_capture_initialized',
    details: {},
    actor: 'claude-code-backend',
  });
}

/**
 * Check if the response is complete
 * Looks for patterns indicating Claude is done
 */
function isResponseComplete(buffer: string): boolean {
  const recentOutput = buffer.slice(-200);

  // Claude shows these patterns when done
  const completionPatterns = [
    /✓\s*Complete/i,
    /\n>\s*$/,  // Claude's prompt
    /Finished\s+in\s+\d+/i,
    /\n\$\s*$/,  // Shell prompt returned
  ];

  for (const pattern of completionPatterns) {
    if (pattern.test(recentOutput)) {
      return true;
    }
  }

  return false;
}

/**
 * Complete the current pending prompt
 */
function completeCurrentPrompt(): void {
  if (!pendingPrompt) return;

  clearTimeout(pendingPrompt.timeout);

  const response = cleanResponse(pendingPrompt.outputBuffer);

  audit({
    level: 'info',
    category: 'action',
    event: 'claude_terminal_response_complete',
    details: {
      responseLength: response.length,
      duration: Date.now() - pendingPrompt.startTime,
      sessionId: pendingPrompt.streaming?.sessionId,
    },
    actor: 'claude-code-backend',
  });

  pendingPrompt.resolve(response);
  pendingPrompt = null;
}

/**
 * Clean up the response text
 */
function cleanResponse(buffer: string): string {
  // Remove ANSI escape codes
  let cleaned = buffer.replace(/\x1b\[[0-9;]*m/g, '');

  // Remove the prompt we sent
  const promptEndIndex = cleaned.indexOf('\n');
  if (promptEndIndex > 0) {
    cleaned = cleaned.slice(promptEndIndex + 1);
  }

  // Remove trailing prompt indicators
  cleaned = cleaned.replace(/\n>\s*$/, '');
  cleaned = cleaned.replace(/\n\$\s*$/, '');

  return cleaned.trim();
}

/**
 * Parse output for reasoning steps and emit them
 */
function parseAndEmitReasoningSteps(
  chunk: string,
  streaming?: {
    onReasoningStep?: (step: ReasoningStep) => void;
    sessionId?: string;
  }
): void {
  if (!streaming?.onReasoningStep) return;

  // Tool use patterns
  const toolUseMatch = chunk.match(/⏺\s*(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch)[:\s]/i);
  if (toolUseMatch) {
    streaming.onReasoningStep({
      type: 'tool_use',
      toolName: toolUseMatch[1],
      content: chunk.substring(0, 200),
      timestamp: new Date().toISOString(),
    });
  }

  // Thought patterns
  const thoughtPatterns = [
    /^(Thinking|Let me|I'll|I need to|First,|Next,|Now|Looking at|Checking|Searching|Reading)/i,
  ];

  for (const pattern of thoughtPatterns) {
    if (pattern.test(chunk) && chunk.length > 20 && chunk.length < 500) {
      streaming.onReasoningStep({
        type: 'thought',
        content: chunk.substring(0, 300),
        timestamp: new Date().toISOString(),
      });
      break;
    }
  }
}

/**
 * Send a prompt to the interactive terminal
 */
async function sendPromptToTerminal(
  prompt: string,
  timeoutMs: number,
  streaming?: {
    onReasoningStep?: (step: ReasoningStep) => void;
    onChunk?: (chunk: string) => void;
    onWaitingForInput?: (question: string) => void;
    sessionId?: string;
  }
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    // Check if terminal is ready
    if (!isBigBrotherReady()) {
      reject(new Error('Big Brother terminal not ready'));
      return;
    }

    // Cancel any pending prompt
    if (pendingPrompt) {
      clearTimeout(pendingPrompt.timeout);
      pendingPrompt.reject(new Error('Cancelled by new prompt'));
      pendingPrompt = null;
    }

    const timeout = setTimeout(() => {
      if (pendingPrompt) {
        const partialResponse = cleanResponse(pendingPrompt.outputBuffer);
        pendingPrompt = null;

        audit({
          level: 'warn',
          category: 'action',
          event: 'claude_terminal_prompt_timeout',
          details: {
            timeoutMs,
            partialResponseLength: partialResponse.length,
            sessionId: streaming?.sessionId,
          },
          actor: 'claude-code-backend',
        });

        // Return partial response on timeout
        if (partialResponse.length > 0) {
          resolve(partialResponse);
        } else {
          reject(new Error(`Claude terminal timeout after ${timeoutMs}ms`));
        }
      }
    }, timeoutMs);

    // Set up pending prompt tracking
    pendingPrompt = {
      prompt,
      resolve,
      reject,
      outputBuffer: '',
      startTime: Date.now(),
      timeout,
      streaming,
    };

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_terminal_prompt_sent',
      details: {
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 100),
        sessionId: streaming?.sessionId,
      },
      actor: 'claude-code-backend',
    });

    // Send prompt to terminal via WebSocket
    const success = await bigBrotherTerminal.sendPrompt(prompt);
    if (!success) {
      clearTimeout(timeout);
      pendingPrompt = null;
      reject(new Error('Failed to send prompt to terminal'));
    }
  });
}

// ============================================================================
// Legacy API Compatibility
// ============================================================================

/**
 * Start Claude session (now starts the terminal)
 */
export async function startClaudeSession(_spawnTerminal: boolean = true): Promise<boolean> {
  const started = await ensureBigBrotherTerminal();
  if (started && !isInitialized) {
    initializeOutputCapture();
    isInitialized = true;
  }
  return started;
}

/**
 * Stop Claude session (now stops the terminal)
 */
export function stopClaudeSession(): void {
  if (outputUnsubscribe) {
    outputUnsubscribe();
    outputUnsubscribe = null;
  }
  isInitialized = false;
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
    activeSessionId: pendingPrompt?.streaming?.sessionId,
  };
}

/**
 * Send user input (now sends to terminal)
 */
export function sendStdinInput(input: string): boolean {
  bigBrotherTerminal.sendPrompt(input);
  return true;
}

/**
 * Check if waiting for input
 */
export function isWaitingForInput(): boolean {
  return false; // Terminal mode handles this differently
}

/**
 * Send a prompt (now sends to terminal)
 */
export async function sendPrompt(
  prompt: string,
  timeoutMs: number = 600000,
  streaming?: {
    onReasoningStep?: (step: ReasoningStep) => void;
    onChunk?: (chunk: string) => void;
    onWaitingForInput?: (question: string) => void;
    sessionId?: string;
  }
): Promise<string> {
  // Ensure terminal is started
  if (!isBigBrotherReady()) {
    await startClaudeSession(true);
  }

  return sendPromptToTerminal(prompt, timeoutMs, streaming);
}

// ============================================================================
// Export Singleton and Register
// ============================================================================

export const claudeCodeBackend = new ClaudeCodeBackendImpl();

// Auto-register when imported
registerBackend(claudeCodeBackend);
