import type { APIRoute } from 'astro';
import { spawn } from 'child_process';
import { getAuthenticatedUser } from '@metahuman/core/auth';
import { audit } from '@metahuman/core';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(process.cwd(), '../..');
const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
const TTYD_BIN = path.join(REPO_ROOT, 'bin/ttyd');
const CLAUDE_PORT = 3099; // Dedicated port for Big Brother

// Track Big Brother terminal
let bigBrotherTerminal: { pid: number; port: number } | null = null;

/**
 * POST: Spawn a dedicated Claude CLI terminal for Big Brother mode
 */
export const POST: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owners can spawn Big Brother terminal
    if (user.role !== 'owner') {
      return new Response(JSON.stringify({
        error: 'Only owners can spawn Big Brother terminal'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if Big Brother terminal already exists
    if (bigBrotherTerminal) {
      // Verify it's still running
      try {
        process.kill(bigBrotherTerminal.pid, 0); // Signal 0 checks if process exists

        audit({
          level: 'info',
          category: 'action',
          event: 'big_brother_terminal_already_running',
          details: { port: bigBrotherTerminal.port, pid: bigBrotherTerminal.pid },
          actor: user.username
        });

        return new Response(JSON.stringify({
          port: bigBrotherTerminal.port,
          pid: bigBrotherTerminal.pid,
          url: `http://localhost:${bigBrotherTerminal.port}`,
          alreadyRunning: true
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch {
        // Process is dead, clean up
        bigBrotherTerminal = null;
      }
    }

    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Spawn ttyd with Claude CLI
    const logFile = path.join(LOG_DIR, `big-brother-terminal.log`);
    const pidFile = path.join(LOG_DIR, `big-brother-terminal.pid`);

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_spawning',
      details: { port: CLAUDE_PORT },
      actor: user.username
    });

    // Create/clear the session log file
    const sessionLogPath = path.join(LOG_DIR, 'big-brother-session.log');
    fs.writeFileSync(sessionLogPath, `
════════════════════════════════════════════════════════════════════════════════
🤖 BIG BROTHER MODE - Claude Code Session Log
════════════════════════════════════════════════════════════════════════════════
Started: ${new Date().toISOString()}

This terminal shows all Big Brother escalations in real-time.
When the operator gets stuck, it will send prompts to Claude Code for guidance.

Waiting for escalations...
════════════════════════════════════════════════════════════════════════════════

`);

    // Spawn ttyd with tail -f to show the session log
    // Note: --title-format not supported in ttyd 1.7.x
    const ttydProcess = spawn(TTYD_BIN, [
      '--port', CLAUDE_PORT.toString(),
      '--writable',
      '--cwd', REPO_ROOT,
      '/usr/bin/tail', '-f', sessionLogPath // Tail the session log (full path required)
    ], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
    });

    ttydProcess.unref();

    // Store PID
    fs.writeFileSync(pidFile, ttydProcess.pid!.toString());
    bigBrotherTerminal = { pid: ttydProcess.pid!, port: CLAUDE_PORT };

    // Wait a moment for ttyd to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_spawned',
      details: { port: CLAUDE_PORT, pid: ttydProcess.pid },
      actor: user.username
    });

    return new Response(JSON.stringify({
      port: CLAUDE_PORT,
      pid: ttydProcess.pid,
      url: `http://localhost:${CLAUDE_PORT}`,
      alreadyRunning: false
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_terminal_spawn_failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
      actor: 'system'
    });

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to spawn Big Brother terminal'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * DELETE: Kill the Big Brother terminal
 */
export const DELETE: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    if (!bigBrotherTerminal) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No Big Brother terminal running'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      // Kill the process group
      process.kill(-bigBrotherTerminal.pid, 'SIGTERM');

      // Clean up PID file
      const pidFile = path.join(LOG_DIR, `big-brother-terminal.pid`);
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_terminal_killed',
        details: { port: bigBrotherTerminal.port, pid: bigBrotherTerminal.pid },
        actor: user.username
      });

      bigBrotherTerminal = null;

      return new Response(JSON.stringify({
        success: true,
        message: 'Big Brother terminal killed'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      audit({
        level: 'error',
        category: 'action',
        event: 'big_brother_terminal_kill_failed',
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
        actor: user.username
      });

      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to kill terminal'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Authentication failed'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
