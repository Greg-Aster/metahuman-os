/**
 * Runtime Mode Management
 *
 * Manages headless mode state for MetaHuman OS. Headless mode keeps the
 * tunnel and web server running while pausing all local agents, allowing
 * remote users to claim full system resources without conflicts.
 *
 * Agent lifecycle is managed directly by enterHeadlessMode/exitHeadlessMode
 * functions - no separate watcher process needed.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { paths } from './paths.js';
import { audit } from './audit.js';
import { stopAllAgents, registerAgent, unregisterAgent } from './agent-monitor.js';

const RUNTIME_CONFIG_PATH = path.join(paths.root, 'etc', 'runtime.json');

export interface RuntimeState {
  /** True if in headless mode (agents paused, waiting for remote claim) */
  headless: boolean;
  /** Who last changed the mode ('local' user or 'remote' session) */
  lastChangedBy: 'local' | 'remote';
  /** ISO timestamp of last mode change */
  changedAt: string;
  /** User ID who claimed runtime (null if not claimed) */
  claimedBy: string | null;
}

/**
 * Load runtime mode configuration
 */
export function getRuntimeMode(): RuntimeState {
  const defaultState: RuntimeState = {
    headless: false,
    lastChangedBy: 'local',
    changedAt: new Date().toISOString(),
    claimedBy: null,
  };

  try {
    if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
      const data = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8');
      return { ...defaultState, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('[runtime-mode] Failed to load config:', error);
  }

  return defaultState;
}

/**
 * Save runtime mode configuration
 */
export function setRuntimeMode(
  partial: Partial<RuntimeState>,
  actor?: string
): void {
  try {
    const current = getRuntimeMode();
    const updated: RuntimeState = {
      ...current,
      ...partial,
      changedAt: new Date().toISOString(),
    };

    // Ensure etc/ directory exists
    const etcDir = path.join(paths.root, 'etc');
    if (!fs.existsSync(etcDir)) {
      fs.mkdirSync(etcDir, { recursive: true });
    }

    // Atomic write with backup
    const tmpPath = RUNTIME_CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2));
    fs.renameSync(tmpPath, RUNTIME_CONFIG_PATH);

    // Audit the state change
    audit({
      category: 'system',
      level: 'info',
      message: `Runtime mode changed: ${current.headless ? 'headless' : 'active'} → ${updated.headless ? 'headless' : 'active'}`,
      metadata: {
        actor: actor || 'system',
        previousState: current,
        newState: updated,
        reason: updated.headless ? 'entering_headless_mode' : 'exiting_headless_mode',
      },
    });
  } catch (error) {
    console.error('[runtime-mode] Failed to save config:', error);
    throw error;
  }
}

/**
 * Check if currently in headless mode
 */
export function isHeadless(): boolean {
  return getRuntimeMode().headless;
}

/**
 * Enter headless mode (stop agents, keep tunnel/server running)
 */
export function enterHeadlessMode(actor?: string): void {
  console.log('[runtime-mode] Entering headless mode - stopping all agents...');

  // Stop all agents gracefully
  const result = stopAllAgents(false);

  console.log(`[runtime-mode] Stopped ${result.stopped.length}/${result.total} agents`);
  if (result.failed.length > 0) {
    console.warn(`[runtime-mode] Failed to stop: ${result.failed.join(', ')}`);
  }

  // Update runtime state
  setRuntimeMode(
    {
      headless: true,
      lastChangedBy: actor?.includes('remote') ? 'remote' : 'local',
      claimedBy: null,
    },
    actor
  );

  audit({
    category: 'system',
    level: 'info',
    message: 'Headless mode activated - agents stopped',
    actor: actor || 'system',
    metadata: {
      stopped: result.stopped,
      failed: result.failed,
      total: result.total,
    }
  });
}

/**
 * Exit headless mode (resume normal operation)
 */
export function exitHeadlessMode(actor?: string, claimedBy?: string): void {
  console.log('[runtime-mode] Exiting headless mode - resuming agents...');

  // Update runtime state first
  setRuntimeMode(
    {
      headless: false,
      lastChangedBy: actor?.includes('remote') ? 'remote' : 'local',
      claimedBy: claimedBy || null,
    },
    actor
  );

  // Start default agents after a brief delay for cleanup
  setTimeout(() => {
    startDefaultAgents(actor);
  }, 2000);
}

/**
 * Start default agents when exiting headless mode
 */
function startDefaultAgents(actor?: string): void {
  const defaultAgents = ['scheduler-service', 'boredom-service', 'audio-organizer'];

  console.log('[runtime-mode] Starting default agents...');

  for (const agentName of defaultAgents) {
    try {
      const agentPath = path.join(paths.brain, 'agents', `${agentName}.ts`);

      // Check if agent file exists
      if (!fs.existsSync(agentPath)) {
        console.warn(`[runtime-mode] Agent not found: ${agentPath}`);
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

      if (child.pid) {
        registerAgent(agentName, child.pid);
        console.log(`[runtime-mode] Started ${agentName} (PID: ${child.pid})`);

        audit({
          level: 'info',
          category: 'system',
          event: 'agent_started',
          details: { agent: agentName, pid: child.pid, source: 'runtime-mode' },
          actor: actor || 'system',
        });

        // Attach event handlers BEFORE unref()
        child.on('close', (code: number) => {
          audit({
            level: code === 0 ? 'info' : 'error',
            category: 'system',
            event: 'agent_stopped',
            details: { agent: agentName, exitCode: code, source: 'runtime-mode' },
            actor: actor || 'system',
          });
          unregisterAgent(agentName);
        });
      }

      // IMPORTANT: unref() AFTER event handlers
      child.unref();
    } catch (error) {
      console.error(`[runtime-mode] Failed to start ${agentName}:`, error);
    }
  }

  audit({
    category: 'system',
    level: 'info',
    message: 'Headless mode deactivated - agents resumed',
    actor: actor || 'system',
  });
}
