/**
 * Runtime Mode Management
 *
 * Manages headless mode state for MetaHuman OS. Headless mode keeps the
 * tunnel and web server running while pausing all local agents, allowing
 * remote users to claim full system resources without conflicts.
 */

import fs from 'fs';
import path from 'path';
import { paths } from './paths.js';
import { audit } from './audit.js';

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
  setRuntimeMode(
    {
      headless: true,
      lastChangedBy: actor?.includes('remote') ? 'remote' : 'local',
      claimedBy: null,
    },
    actor
  );
}

/**
 * Exit headless mode (resume normal operation)
 */
export function exitHeadlessMode(actor?: string, claimedBy?: string): void {
  setRuntimeMode(
    {
      headless: false,
      lastChangedBy: actor?.includes('remote') ? 'remote' : 'local',
      claimedBy: claimedBy || null,
    },
    actor
  );
}
