/**
 * Claude Code Backend
 *
 * Escalation backend using Anthropic's Claude Code CLI.
 * Manages a persistent CLI session with terminal visibility.
 *
 * Features:
 * - PTY-based session management
 * - Streaming output with reasoning step parsing
 * - Terminal log visibility
 * - Auto-restart on idle timeout
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
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

// ============================================================================
// Types
// ============================================================================

interface ClaudeSession {
  process: ChildProcess | null;
  ready: boolean;
  buffer: string;
  responseCallback?: (response: string) => void;
  startTime: Date;
  terminalPort?: number;
  terminalPid?: number;
}

// ============================================================================
// Session State
// ============================================================================

let currentSession: ClaudeSession | null = null;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes idle timeout

// ============================================================================
// Claude Code Backend Implementation
// ============================================================================

class ClaudeCodeBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.CLAUDE_CODE;
  readonly name = 'Claude Code CLI';
  readonly description = "Anthropic's official Claude Code command-line interface";
  readonly supportsStreaming = true;

  /**
   * Check if Claude Code CLI is installed
   */
  async isAvailable(): Promise<boolean> {
    return isClaudeInstalled();
  }

  /**
   * Check if session is ready
   */
  isReady(): boolean {
    return currentSession?.ready ?? false;
  }

  /**
   * Start Claude session
   */
  async start(): Promise<boolean> {
    return startClaudeSession(true);
  }

  /**
   * Stop Claude session
   */
  stop(): void {
    stopClaudeSession();
  }

  /**
   * Execute a prompt using Claude CLI
   */
  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();

    try {
      // Ensure session is ready
      if (!this.isReady()) {
        const started = await this.start();
        if (!started) {
          return {
            success: false,
            output: '',
            error: 'Failed to start Claude Code session',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Send prompt and get response
      const output = await sendPrompt(prompt, options?.timeout || 30000, {
        onReasoningStep: options?.onReasoningStep,
        onChunk: options?.onChunk,
        sessionId: options?.sessionId,
      });

      return {
        success: true,
        output,
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
      // Ensure session is ready
      if (!this.isReady()) {
        const started = await this.start();
        if (!started) {
          return {
            success: false,
            output: '',
            error: 'Failed to start Claude Code session',
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Use streaming execution
      const streamPromise = spawnClaudeAsyncStreaming(prompt, options?.timeout || 30000, {
        onReasoningStep: options?.onReasoningStep,
        onChunk: (chunk) => {
          chunks.push(chunk);
          options?.onChunk?.(chunk);
        },
        sessionId: options?.sessionId,
      });

      // Wait for completion
      const output = await streamPromise;

      return {
        success: true,
        output,
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
// Helper Functions (moved from claude-session.ts)
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
 * Start a Claude CLI session with terminal visibility
 */
export async function startClaudeSession(spawnTerminal: boolean = true): Promise<boolean> {
  if (currentSession?.ready) {
    audit({
      level: 'info',
      category: 'system',
      event: 'claude_session_already_running',
      details: {
        terminalPort: currentSession.terminalPort,
        hasTerminal: !!currentSession.terminalPort,
      },
      actor: 'claude-code-backend',
    });
    return true;
  }

  if (!isClaudeInstalled()) {
    audit({
      level: 'error',
      category: 'system',
      event: 'claude_cli_not_installed',
      details: {
        message: 'Claude Code CLI not found. Install from https://claude.com/code',
      },
      actor: 'claude-code-backend',
    });
    return false;
  }

  try {
    let terminalPort: number | undefined;
    let terminalPid: number | undefined;

    if (spawnTerminal) {
      try {
        terminalPort = 3099; // Big Brother dedicated port

        audit({
          level: 'info',
          category: 'system',
          event: 'claude_session_terminal_mode',
          details: { terminalPort },
          actor: 'claude-code-backend',
        });
      } catch (error) {
        audit({
          level: 'warn',
          category: 'system',
          event: 'claude_terminal_spawn_failed_fallback_to_print',
          details: { error: (error as Error).message },
          actor: 'claude-code-backend',
        });
      }
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'claude_session_ready',
      details: {
        hasTerminal: !!terminalPort,
        terminalPort,
      },
      actor: 'claude-code-backend',
    });

    currentSession = {
      process: null,
      ready: true,
      buffer: '',
      startTime: new Date(),
      terminalPort,
      terminalPid,
    };

    return true;
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'claude_session_start_failed',
      details: { error: (error as Error).message },
      actor: 'claude-code-backend',
    });
    return false;
  }
}

/**
 * Stop the Claude CLI session
 */
export function stopClaudeSession(): void {
  if (!currentSession) {
    return;
  }

  try {
    audit({
      level: 'info',
      category: 'system',
      event: 'claude_session_stopped',
      details: {},
      actor: 'claude-code-backend',
    });

    currentSession = null;
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'claude_session_stop_failed',
      details: { error: (error as Error).message },
      actor: 'claude-code-backend',
    });
  }
}

/**
 * Check if Claude session is running and ready
 */
export function isClaudeSessionReady(): boolean {
  return currentSession?.ready ?? false;
}

/**
 * Get session status
 */
export function getSessionStatus(): {
  running: boolean;
  ready: boolean;
  uptime?: number;
  installed: boolean;
} {
  return {
    running: currentSession !== null,
    ready: currentSession?.ready ?? false,
    uptime: currentSession ? Date.now() - currentSession.startTime.getTime() : undefined,
    installed: isClaudeInstalled(),
  };
}

/**
 * Streaming options for sendPrompt
 */
interface StreamingOptions {
  onReasoningStep?: (step: ReasoningStep) => void;
  onChunk?: (chunk: string) => void;
  sessionId?: string;
}

/**
 * Send a prompt to Claude and get a response
 */
export async function sendPrompt(
  prompt: string,
  timeoutMs: number = 30000,
  streaming?: StreamingOptions
): Promise<string> {
  if (!currentSession || !currentSession.ready) {
    throw new Error('Claude session not ready. Call startClaudeSession() first.');
  }

  // Write to terminal log for visibility
  if (currentSession.terminalPort) {
    try {
      await writeToTerminalLog(prompt, 'prompt');
    } catch (error) {
      audit({
        level: 'warn',
        category: 'action',
        event: 'terminal_log_write_failed',
        details: { error: (error as Error).message },
        actor: 'claude-code-backend',
      });
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'claude_prompt_sent',
    details: {
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 100),
      hasTerminal: !!currentSession.terminalPort,
    },
    actor: 'claude-code-backend',
  });

  try {
    const response = await spawnClaudeAsync(prompt, timeoutMs, streaming);

    if (currentSession.terminalPort) {
      try {
        await writeToTerminalLog(response, 'response');
      } catch {
        // Non-critical
      }
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_response_received',
      details: {
        responseLength: response.length,
        sessionId: streaming?.sessionId,
      },
      actor: 'claude-code-backend',
    });

    return response;
  } catch (error) {
    const errorMsg = (error as Error).message;

    if (currentSession.terminalPort) {
      try {
        await writeToTerminalLog(`ERROR: ${errorMsg}`, 'error');
      } catch {
        // Ignore
      }
    }

    audit({
      level: 'error',
      category: 'action',
      event: 'claude_prompt_failed',
      details: {
        error: errorMsg,
      },
      actor: 'claude-code-backend',
    });
    throw new Error(`Claude CLI request failed: ${errorMsg}`);
  }
}

/**
 * Parse Claude CLI output for reasoning steps
 */
function parseReasoningFromChunk(
  buffer: string,
  streaming?: StreamingOptions
): { remainingBuffer: string; stepsEmitted: number } {
  let stepsEmitted = 0;
  let remainingBuffer = buffer;

  // Pattern: Tool use blocks
  const toolUsePattern =
    /⏺\s*(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch)[^\n]*\n([^⏺]*?)(?=⏺|$)/gs;
  let toolMatch;
  while ((toolMatch = toolUsePattern.exec(buffer)) !== null) {
    const toolName = toolMatch[1];
    const toolContent = toolMatch[2].trim();

    if (streaming?.onReasoningStep) {
      streaming.onReasoningStep({
        type: 'tool_use',
        toolName,
        content: toolContent.substring(0, 500),
        timestamp: new Date().toISOString(),
      });
      stepsEmitted++;
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_reasoning_step',
      details: {
        stepType: 'tool_use',
        toolName,
        content: toolContent.substring(0, 200),
        sessionId: streaming?.sessionId,
      },
      actor: 'claude-code-backend',
    });
  }

  // Pattern: Thinking/reasoning text
  const thinkingPatterns = [
    /(?:^|\n)(?:Thinking|Let me|I'll|I need to|First,|Next,|Now|Looking at|Checking|Searching|Reading|The)[^.\n]*\./g,
    /(?:^|\n)(?:I found|I see|This shows|Based on|According to)[^.\n]*\./g,
  ];

  for (const pattern of thinkingPatterns) {
    let thoughtMatch;
    while ((thoughtMatch = pattern.exec(buffer)) !== null) {
      const thought = thoughtMatch[0].trim();
      if (thought.length > 20 && thought.length < 500) {
        if (streaming?.onReasoningStep) {
          streaming.onReasoningStep({
            type: 'thought',
            content: thought,
            timestamp: new Date().toISOString(),
          });
          stepsEmitted++;
        }

        audit({
          level: 'info',
          category: 'action',
          event: 'big_brother_reasoning_step',
          details: {
            stepType: 'thought',
            content: thought.substring(0, 200),
            sessionId: streaming?.sessionId,
          },
          actor: 'claude-code-backend',
        });
      }
    }
  }

  if (buffer.length > 500) {
    remainingBuffer = buffer.slice(-500);
  }

  return { remainingBuffer, stepsEmitted };
}

/**
 * Spawn Claude CLI asynchronously
 */
async function spawnClaudeAsync(
  prompt: string,
  timeoutMs: number,
  streaming?: StreamingOptions
): Promise<string> {
  return spawnClaudeAsyncStreaming(prompt, timeoutMs, streaming);
}

/**
 * Spawn Claude CLI with streaming support
 */
async function spawnClaudeAsyncStreaming(
  prompt: string,
  timeoutMs: number,
  streaming?: StreamingOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let timedOut = false;
    let streamBuffer = '';
    let totalStepsEmitted = 0;

    console.log(`[claude-code-backend] 🚀 Spawning Claude CLI (timeout: ${timeoutMs}ms)...`);

    const child = spawn('claude', ['--print', '--dangerously-skip-permissions'], {
      cwd: '/home/greggles/metahuman',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      console.log(`[claude-code-backend] ⏰ Claude CLI timed out after ${timeoutMs}ms`);

      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);

      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);

        const text = chunk.toString();
        if (streaming?.onChunk) {
          streaming.onChunk(text);
        }

        if (streaming) {
          streamBuffer += text;
          const { remainingBuffer, stepsEmitted } = parseReasoningFromChunk(streamBuffer, streaming);
          streamBuffer = remainingBuffer;
          totalStepsEmitted += stepsEmitted;
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        errorChunks.push(chunk);
        const text = chunk.toString();
        if (text.trim()) {
          console.log(`[claude-code-backend] stderr: ${text.trim()}`);
        }
      });
    }

    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      if (!timedOut) {
        console.log(`[claude-code-backend] ❌ Spawn error: ${error.message}`);
        reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);

      if (timedOut) {
        return;
      }

      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(errorChunks).toString('utf8');

      if (streaming && totalStepsEmitted > 0) {
        console.log(`[claude-code-backend] 📊 Streamed ${totalStepsEmitted} reasoning steps`);
      }

      if (code === 0) {
        console.log(`[claude-code-backend] ✅ Claude CLI completed (${stdout.length} chars)`);
        resolve(stdout);
      } else {
        const errorDetail = stderr || `Exit code ${code}`;
        console.log(`[claude-code-backend] ❌ Claude CLI failed: ${errorDetail}`);
        reject(new Error(`Claude CLI exited with code ${code}: ${errorDetail}`));
      }
    });
  });
}

/**
 * Write to the Big Brother terminal log for visibility
 */
async function writeToTerminalLog(
  content: string,
  type: 'prompt' | 'response' | 'error'
): Promise<void> {
  const logPath = path.join(process.cwd(), '../../logs/run/big-brother-session.log');

  const timestamp = new Date().toISOString();
  let prefix = '';
  let color = '';

  switch (type) {
    case 'prompt':
      prefix = '🔵 PROMPT';
      color = '\x1b[34m';
      break;
    case 'response':
      prefix = '🟢 RESPONSE';
      color = '\x1b[32m';
      break;
    case 'error':
      prefix = '🔴 ERROR';
      color = '\x1b[31m';
      break;
  }

  const reset = '\x1b[0m';
  const separator = '─'.repeat(80);

  const logEntry = `
${color}${separator}${reset}
${color}${prefix} [${timestamp}]${reset}
${color}${separator}${reset}
${content}
${color}${separator}${reset}
`;

  fs.appendFileSync(logPath, logEntry + '\n');
}

/**
 * Restart the Claude session
 */
export async function restartClaudeSession(): Promise<boolean> {
  stopClaudeSession();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return startClaudeSession();
}

/**
 * Start session monitoring (auto-restart on failure, idle timeout)
 */
export function startSessionMonitoring(): void {
  setInterval(() => {
    if (!currentSession) {
      return;
    }

    const uptime = Date.now() - currentSession.startTime.getTime();

    if (uptime > SESSION_TIMEOUT) {
      audit({
        level: 'info',
        category: 'system',
        event: 'claude_session_timeout_restart',
        details: { uptime },
        actor: 'claude-code-backend',
      });
      restartClaudeSession();
    }
  }, 5 * 60 * 1000);
}

// ============================================================================
// Export Singleton and Register
// ============================================================================

export const claudeCodeBackend = new ClaudeCodeBackendImpl();

// Auto-register when imported
registerBackend(claudeCodeBackend);
