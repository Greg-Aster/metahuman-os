#!/usr/bin/env tsx
/**
 * Headless Mode Watcher
 *
 * ⚠️  DEPRECATED: This service is no longer needed. Agent lifecycle management
 * is now handled directly by enterHeadlessMode/exitHeadlessMode functions in
 * packages/core/src/runtime-mode.ts.
 *
 * This file is kept for reference but should not be started. The new approach
 * is more efficient (no watcher process) and more reliable (immediate response).
 *
 * Previous behavior:
 * - Monitored runtime.json for headless mode changes
 * - Stopped/started agents based on state changes
 * - Provided keepalive mechanism
 *
 * New behavior (runtime-mode.ts):
 * - enterHeadlessMode() directly calls stopAllAgents()
 * - exitHeadlessMode() directly spawns default agents
 * - No polling, no file watching, no wasted resources
 *
 * MULTI-USER: This was a system-level service that managed global runtime state.
 */

console.warn('⚠️  headless-watcher is deprecated - use runtime-mode.ts functions instead');
console.warn('   Exiting immediately. Remove this agent from your startup scripts.');
process.exit(0);

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  paths,
  audit,
  acquireLock,
  initGlobalLogger,
  getRuntimeMode,
  stopAllAgents,
  getRunningAgents,
  registerAgent,
  unregisterAgent,
} from '@metahuman/core';

const runtimeConfigFile = path.join(paths.root, 'etc', 'runtime.json');

// Track previous state to detect changes
let previousHeadlessState = false;
let watcherRetryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Start default agents when exiting headless mode
 */
function startDefaultAgents() {
  const defaults = ['scheduler-service', 'boredom-service', 'sleep-service'];

  console.log('[headless-watcher] Starting default agents...');

  for (const agentName of defaults) {
    const agentPath = path.join(paths.brain, 'agents', `${agentName}.ts`);

    if (!fs.existsSync(agentPath)) {
      console.warn(`[headless-watcher] Agent not found: ${agentPath}`);
      continue;
    }

    // Use bootstrap wrapper to establish user context for agents
    const bootstrapPath = path.join(paths.brain, 'agents', '_bootstrap.ts');
    const child = spawn('tsx', [bootstrapPath, agentName], {
      detached: true,
      stdio: 'ignore',
      cwd: paths.root,
      env: {
        ...process.env,
        NODE_PATH: [
          path.join(paths.root, 'node_modules'),
          path.join(paths.root, 'packages/cli/node_modules'),
          path.join(paths.root, 'apps/site/node_modules'),
        ].join(':'),
      },
    });

    child.unref();

    if (child.pid) {
      registerAgent(agentName, child.pid);
      console.log(`[headless-watcher] Started ${agentName} (PID: ${child.pid})`);

      audit({
        level: 'info',
        category: 'system',
        event: 'agent_started',
        details: { agent: agentName, pid: child.pid, source: 'headless-watcher' },
        actor: 'system',
      });

      child.on('close', (code: number) => {
        audit({
          level: code === 0 ? 'info' : 'error',
          category: 'system',
          event: 'agent_stopped',
          details: { agent: agentName, exitCode: code, source: 'headless-watcher' },
          actor: 'system',
        });
        unregisterAgent(agentName);
      });
    }
  }
}

/**
 * Handle runtime mode changes with error recovery
 */
function handleRuntimeChange() {
  try {
    // Verify file exists and is readable
    if (!fs.existsSync(runtimeConfigFile)) {
      console.warn('[headless-watcher] Runtime config file missing, will retry...');
      if (watcherRetryCount < MAX_RETRIES) {
        watcherRetryCount++;
        setTimeout(handleRuntimeChange, RETRY_DELAY_MS);
      } else {
        console.error('[headless-watcher] Max retries reached, giving up on this change');
        watcherRetryCount = 0;
      }
      return;
    }

    const runtimeMode = getRuntimeMode();

    // Reset retry counter on successful read
    watcherRetryCount = 0;

    // Check if headless state actually changed
    if (runtimeMode.headless === previousHeadlessState) {
      return; // No change, do nothing
    }

    if (runtimeMode.headless) {
      // Entering headless mode - stop all agents
      console.log('[headless-watcher] Entering headless mode - stopping all agents...');

      const result = stopAllAgents(false); // Graceful stop

      audit({
        category: 'system',
        level: 'info',
        message: 'Headless mode activated - agents stopped',
        actor: 'headless-watcher',
        metadata: {
          stopped: result.stopped,
          failed: result.failed,
          total: result.total,
          changedBy: runtimeMode.lastChangedBy,
        }
      });

      console.log(`[headless-watcher] Stopped ${result.stopped.length}/${result.total} agents`);
      if (result.failed.length > 0) {
        console.warn(`[headless-watcher] Failed to stop: ${result.failed.join(', ')}`);
      }
    } else {
      // Exiting headless mode - restart agents
      console.log('[headless-watcher] Exiting headless mode - resuming agents...');

      // Wait a bit for any cleanup to complete
      setTimeout(() => {
        startDefaultAgents();

        audit({
          category: 'system',
          level: 'info',
          message: 'Headless mode deactivated - agents resumed',
          actor: 'headless-watcher',
          metadata: {
            changedBy: runtimeMode.lastChangedBy,
            claimedBy: runtimeMode.claimedBy,
          }
        });
      }, 2000); // 2 second delay
    }

    previousHeadlessState = runtimeMode.headless;
  } catch (error) {
    console.error('[headless-watcher] Error handling runtime change:', error);

    audit({
      category: 'system',
      level: 'error',
      message: 'Failed to handle runtime mode change',
      actor: 'headless-watcher',
      metadata: {
        error: (error as Error).message,
      }
    });
  }
}

/**
 * Keepalive mechanism to prevent process exit
 *
 * IMPORTANT: This keeps the Node.js process alive (prevents event loop from
 * exiting), but does NOT prevent OS-level system sleep. For true sleep
 * prevention on the host machine, configure OS-level settings:
 *
 * - Linux: `sudo systemctl mask sleep.target suspend.target`
 * - macOS: `caffeinate -s` or System Settings → Energy Saver
 * - Windows: Power settings → Sleep → Never
 *
 * See docs/user-guide for detailed platform-specific instructions.
 */
function startKeepalive() {
  // Heartbeat every 60 seconds to keep the event loop active
  // This ensures the watcher process stays running to monitor mode changes
  setInterval(() => {
    const runtimeMode = getRuntimeMode();
    if (runtimeMode.headless) {
      console.log('[headless-watcher] Keepalive heartbeat (headless mode active)');
    }
  }, 60000); // 60 seconds
}

function main() {
  initGlobalLogger('headless-watcher');
  console.log('[headless-watcher] Initializing headless mode watcher...');

  // Single-instance guard using lock acquisition (heals stale locks)
  try {
    acquireLock('service-headless-watcher');
  } catch {
    console.log('[headless-watcher] Another instance is running. Exiting.');
    return;
  }

  // Initialize previous state
  try {
    const initialMode = getRuntimeMode();
    previousHeadlessState = initialMode.headless;
    console.log(`[headless-watcher] Initial state: ${initialMode.headless ? 'HEADLESS' : 'NORMAL'}`);

    if (initialMode.headless) {
      console.log('[headless-watcher] System is in headless mode - local agents should be stopped');
    }
  } catch (error) {
    console.error('[headless-watcher] Failed to load initial runtime mode:', error);
  }

  // Watch runtime.json for changes with error handling
  let watcher: fs.FSWatcher | null = null;

  function startWatcher() {
    try {
      if (watcher) {
        watcher.close();
      }

      watcher = fs.watch(runtimeConfigFile, (eventType, filename) => {
        if (eventType === 'change') {
          console.log('[headless-watcher] Runtime config changed, processing...');
          // Small delay to ensure file write is complete
          setTimeout(handleRuntimeChange, 100);
        } else if (eventType === 'rename') {
          // File was deleted/renamed, attempt to re-establish watch
          console.warn('[headless-watcher] Config file removed/renamed, attempting to re-watch...');
          setTimeout(startWatcher, 1000);
        }
      });

      watcher.on('error', (error) => {
        console.error('[headless-watcher] Watcher error:', error);
        // Attempt to restart watcher after error
        setTimeout(startWatcher, RETRY_DELAY_MS);
      });

      console.log('[headless-watcher] File watcher (re)started successfully');
    } catch (error) {
      console.error('[headless-watcher] Failed to start watcher:', error);
      // Retry after delay
      setTimeout(startWatcher, RETRY_DELAY_MS);
    }
  }

  startWatcher();

  // Start keepalive mechanism
  startKeepalive();

  console.log('[headless-watcher] Keepalive mechanism active');
  console.log('[headless-watcher] Ready and monitoring for runtime changes');

  audit({
    category: 'system',
    level: 'info',
    message: 'Headless watcher service started',
    actor: 'headless-watcher',
    metadata: {
      currentState: previousHeadlessState ? 'headless' : 'normal',
    }
  });
}

main();
