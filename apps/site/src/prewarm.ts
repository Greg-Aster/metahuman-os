/**
 * Pre-warm expensive modules during dev server startup
 * This ensures the first user request doesn't trigger 50+ second module loading
 */

// Force import of node executors (heaviest module)
import('@metahuman/core/node-executors').then(({ getNodeExecutor }) => {
  if (getNodeExecutor('user_input')) {
    console.log('[prewarm] ✅ Node executors loaded successfully');
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to pre-warm executors:', err);
});

// DISABLED: Legacy skills system not used by cognitive graph pipeline (dual-mode.json v2.3)
// ReAct operator nodes were removed - skills are never executed
// Keeping code for reference in case skills are re-enabled in future
// import('@brain/skills/index.js').then(({ initializeSkills }) => {
//   initializeSkills();
//   console.log('[prewarm] ✅ Skills registry loaded successfully');
// }).catch(err => {
//   console.error('[prewarm] ⚠️ Failed to pre-warm skills:', err);
// });

// Auto-start Big Brother mode if enabled in config
import('@metahuman/core/config').then(async ({ loadOperatorConfig }) => {
  const config = loadOperatorConfig();
  const bigBrotherEnabled = config.bigBrotherMode?.enabled === true;

  if (bigBrotherEnabled) {
    console.log('[prewarm] 🤖 Big Brother mode enabled - auto-starting Claude session...');

    try {
      // Start Claude session
      const { startClaudeSession, isClaudeSessionReady } = await import('@metahuman/core/claude-session');

      if (!isClaudeSessionReady()) {
        const started = await startClaudeSession(true);
        if (started) {
          console.log('[prewarm] ✅ Claude session started automatically');

          // Spawn the Big Brother terminal
          await spawnBigBrotherTerminal();
        } else {
          console.warn('[prewarm] ⚠️ Failed to start Claude session - Claude CLI may not be installed');
        }
      } else {
        console.log('[prewarm] ✅ Claude session already running');
      }
    } catch (err) {
      console.error('[prewarm] ⚠️ Failed to auto-start Big Brother mode:', err);
    }
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to check Big Brother config:', err);
});

/**
 * Spawn the Big Brother terminal (ttyd with tail -f)
 */
async function spawnBigBrotherTerminal(): Promise<void> {
  try {
    const { spawn, execSync } = await import('child_process');
    const fs = await import('fs');
    const path = await import('path');

    const REPO_ROOT = process.cwd().includes('/apps/site')
      ? path.resolve(process.cwd(), '../..')
      : process.cwd();
    const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
    const TTYD_BIN = path.join(REPO_ROOT, 'bin/ttyd');
    const CLAUDE_PORT = 3099;

    // Check if ttyd is already running on this port
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep :${CLAUDE_PORT}`, { encoding: 'utf8' });
      if (result.includes('ttyd')) {
        console.log('[prewarm] ✅ Big Brother terminal already running on port', CLAUDE_PORT);
        return;
      }
    } catch {
      // Port not in use, continue to spawn
    }

    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

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

    // Spawn ttyd (note: --title-format not supported in ttyd 1.7.x)
    const logFile = path.join(LOG_DIR, 'big-brother-terminal.log');
    const ttydProcess = spawn(TTYD_BIN, [
      '--port', CLAUDE_PORT.toString(),
      '--writable',
      '--cwd', REPO_ROOT,
      '/usr/bin/tail', '-f', sessionLogPath
    ], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
    });

    ttydProcess.unref();

    // Save PID file
    const pidFile = path.join(LOG_DIR, 'big-brother-terminal.pid');
    fs.writeFileSync(pidFile, ttydProcess.pid!.toString());

    console.log('[prewarm] ✅ Big Brother terminal spawned on port', CLAUDE_PORT);
  } catch (err) {
    console.error('[prewarm] ⚠️ Failed to spawn Big Brother terminal:', err);
  }
}
