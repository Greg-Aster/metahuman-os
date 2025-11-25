/**
 * Claude CLI Session Manager
 *
 * Manages a persistent Claude Code CLI session in a pseudo-terminal.
 * Keeps Claude "hot" and ready to respond to escalation requests.
 */

import { spawn, type ChildProcess } from 'child_process';
import { audit } from './audit.js';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

interface ClaudeSession {
  process: ChildProcess;
  ready: boolean;
  buffer: string;
  responseCallback?: (response: string) => void;
  startTime: Date;
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
    const { execSync } = require('child_process');
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
 * Start a Claude CLI session
 *
 * Note: This now just validates that Claude CLI is installed and ready.
 * We use --print mode for each request instead of maintaining a persistent session.
 */
export async function startClaudeSession(): Promise<boolean> {
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
    audit({
      level: 'info',
      category: 'system',
      event: 'claude_session_ready',
      details: {},
      actor: 'claude-session',
    });

    // Mark as ready (we use --print mode, no persistent process needed)
    currentSession = {
      process: null as any, // No persistent process in --print mode
      ready: true,
      buffer: '',
      startTime: new Date(),
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
 * Uses --print mode for reliable one-off requests
 */
export async function sendPrompt(prompt: string, timeoutMs: number = 30000): Promise<string> {
  if (!currentSession || !currentSession.ready) {
    throw new Error('Claude session not ready. Call startClaudeSession() first.');
  }

  const { execSync } = require('child_process');

  audit({
    level: 'info',
    category: 'action',
    event: 'claude_prompt_sent',
    details: {
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 100),
    },
    actor: 'claude-session',
  });

  try {
    // Use --print mode for reliable one-off requests
    const response = execSync('claude --print', {
      input: prompt,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
    });

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
    audit({
      level: 'error',
      category: 'action',
      event: 'claude_prompt_failed',
      details: {
        error: (error as Error).message,
      },
      actor: 'claude-session',
    });
    throw new Error(`Claude CLI request failed: ${(error as Error).message}`);
  }
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
