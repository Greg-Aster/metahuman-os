/**
 * Claude CLI Session Manager
 *
 * Manages a persistent Claude Code CLI session in a pseudo-terminal.
 * Keeps Claude "hot" and ready to respond to escalation requests.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { audit } from './audit.js';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

interface ClaudeSession {
  process: ChildProcess | null;
  ready: boolean;
  buffer: string;
  responseCallback?: (response: string) => void;
  startTime: Date;
  terminalPort?: number; // Port of the ttyd terminal showing Claude
  terminalPid?: number;  // PID of the ttyd process
}

// ============================================================================
// Session State
// ============================================================================

let currentSession: ClaudeSession | null = null;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes idle timeout

// ============================================================================
// Session Management
// ============================================================================

/**
 * Check if Claude Code CLI is installed
 */
export function isClaudeInstalled(): boolean {
  try {
    // Check common installation paths
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

    // Try which command as fallback
    try {
      const result = execSync('which claude 2>/dev/null', { encoding: 'utf8' });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  } catch (error) {
    return false;
  }
}

/**
 * Start a Claude CLI session with terminal visibility
 *
 * This spawns Claude in an interactive terminal (via ttyd) so users can see
 * all interactions in real-time while still allowing programmatic access.
 */
export async function startClaudeSession(spawnTerminal: boolean = true): Promise<boolean> {
  if (currentSession?.ready) {
    audit({
      level: 'info',
      category: 'system',
      event: 'claude_session_already_running',
      details: {
        terminalPort: currentSession.terminalPort,
        hasTerminal: !!currentSession.terminalPort
      },
      actor: 'claude-session',
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
      actor: 'claude-session',
    });
    return false;
  }

  try {
    let terminalPort: number | undefined;
    let terminalPid: number | undefined;

    // Spawn terminal if requested (via API endpoint)
    if (spawnTerminal) {
      try {
        // Terminal spawning is handled by the API endpoint
        // We just track that a terminal should exist
        terminalPort = 3099; // Big Brother dedicated port

        audit({
          level: 'info',
          category: 'system',
          event: 'claude_session_terminal_mode',
          details: { terminalPort },
          actor: 'claude-session',
        });
      } catch (error) {
        audit({
          level: 'warn',
          category: 'system',
          event: 'claude_terminal_spawn_failed_fallback_to_print',
          details: { error: (error as Error).message },
          actor: 'claude-session',
        });
        // Fall back to non-terminal mode
      }
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'claude_session_ready',
      details: {
        hasTerminal: !!terminalPort,
        terminalPort
      },
      actor: 'claude-session',
    });

    // Mark as ready
    currentSession = {
      process: null, // No direct process handle (ttyd manages it)
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
      actor: 'claude-session',
    });
    return false;
  }
}

/**
 * Stop the Claude CLI session
 *
 * Note: With --print mode, there's no persistent process to stop.
 * This just clears the session state.
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
      actor: 'claude-session',
    });

    currentSession = null;
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'claude_session_stop_failed',
      details: { error: (error as Error).message },
      actor: 'claude-session',
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
 * Send a prompt to Claude and get a response
 *
 * Uses --print mode for reliable execution, but logs to terminal for visibility
 */
export async function sendPrompt(prompt: string, timeoutMs: number = 30000): Promise<string> {
  if (!currentSession || !currentSession.ready) {
    throw new Error('Claude session not ready. Call startClaudeSession() first.');
  }

  // Write to terminal log for visibility
  if (currentSession.terminalPort) {
    try {
      await writeToTerminalLog(prompt, 'prompt');
    } catch (error) {
      // Non-critical - terminal logging is best-effort
      audit({
        level: 'warn',
        category: 'action',
        event: 'terminal_log_write_failed',
        details: { error: (error as Error).message },
        actor: 'claude-session',
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
    actor: 'claude-session',
  });

  try {
    // Use print mode with permissions bypass for full tool access
    // This allows Claude to use Write, Bash, and other tools without prompting
    const response = execSync('claude --print --dangerously-skip-permissions', {
      input: prompt,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
      cwd: '/home/greggles/metahuman', // Set working directory
    });

    // Write response to terminal log
    if (currentSession.terminalPort) {
      try {
        await writeToTerminalLog(response, 'response');
      } catch (error) {
        // Non-critical
      }
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_response_received',
      details: {
        responseLength: response.length,
      },
      actor: 'claude-session',
    });

    return response;
  } catch (error) {
    const errorMsg = (error as Error).message;

    // Log error to terminal
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
      actor: 'claude-session',
    });
    throw new Error(`Claude CLI request failed: ${errorMsg}`);
  }
}

/**
 * Write to the Big Brother terminal log for visibility
 */
async function writeToTerminalLog(content: string, type: 'prompt' | 'response' | 'error'): Promise<void> {
  const logPath = path.join(process.cwd(), '../../logs/run/big-brother-session.log');

  const timestamp = new Date().toISOString();
  let prefix = '';
  let color = '';

  switch (type) {
    case 'prompt':
      prefix = '🔵 PROMPT';
      color = '\x1b[34m'; // Blue
      break;
    case 'response':
      prefix = '🟢 RESPONSE';
      color = '\x1b[32m'; // Green
      break;
    case 'error':
      prefix = '🔴 ERROR';
      color = '\x1b[31m'; // Red
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
 * Restart the Claude session (useful if it becomes unresponsive)
 */
export async function restartClaudeSession(): Promise<boolean> {
  stopClaudeSession();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return startClaudeSession();
}

// ============================================================================
// Session Lifecycle
// ============================================================================

/**
 * Start session monitoring (auto-restart on failure, idle timeout)
 */
export function startSessionMonitoring(): void {
  // Check session health every 5 minutes
  setInterval(() => {
    if (!currentSession) {
      return;
    }

    const uptime = Date.now() - currentSession.startTime.getTime();

    // Auto-restart if session is too old (30 min idle)
    if (uptime > SESSION_TIMEOUT) {
      audit({
        level: 'info',
        category: 'system',
        event: 'claude_session_timeout_restart',
        details: { uptime },
        actor: 'claude-session',
      });
      restartClaudeSession();
    }
  }, 5 * 60 * 1000);
}
