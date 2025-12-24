/**
 * Queue Persister
 *
 * Handles saving and loading unified queue state to/from disk.
 * Features:
 * - Persists all lane states separately
 * - Debounced saves to avoid excessive disk writes
 * - Crash recovery support
 * - Atomic writes to prevent corruption
 */

import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '../path-builder.js';
import {
  QueueState,
  QueuedTask,
  PersistedQueueState,
  PersistedCurrentTask,
  ResourceLaneId,
  RemoteTaskHandle,
} from './types.js';
import { audit } from '../audit.js';

// State file paths
const STATE_DIR = path.join(systemPaths.logs, 'run', 'queue');
const LANES_FILE = path.join(STATE_DIR, 'lanes.json');
const IN_FLIGHT_FILE = path.join(STATE_DIR, 'in-flight.json');
const CURRENT_TASK_FILE = path.join(STATE_DIR, 'current-task.json');

// Debounce settings
const SAVE_DEBOUNCE_MS = 1000; // Wait 1 second before saving

// Current version for state format
const STATE_VERSION = 1;

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Ensure state directory exists
 */
function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

/**
 * Get state directory path
 */
export function getQueueStateDir(): string {
  ensureStateDir();
  return STATE_DIR;
}

// ============================================================================
// Lane State Persistence
// ============================================================================

/**
 * Create a PersistedQueueState from a QueueState
 */
export function createPersistedState(state: QueueState): PersistedQueueState {
  return {
    ...state,
    savedAt: new Date().toISOString(),
    version: STATE_VERSION,
  };
}

/**
 * Save full queue state to disk
 */
export function saveQueueState(state: PersistedQueueState): void {
  ensureStateDir();
  try {
    // Write to temp file first, then rename (atomic write)
    const tempFile = `${LANES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
    fs.renameSync(tempFile, LANES_FILE);
  } catch (error) {
    console.error('[queue-persister] Failed to save queue state:', error);
  }
}

/**
 * Save queue state from a QueueState (convenience method)
 */
export function persistQueueState(state: QueueState): void {
  saveQueueState(createPersistedState(state));
}

/**
 * Load queue state from disk
 */
export function loadQueueState(): PersistedQueueState | null {
  try {
    if (!fs.existsSync(LANES_FILE)) {
      return null;
    }
    const data = fs.readFileSync(LANES_FILE, 'utf-8');
    const state = JSON.parse(data) as PersistedQueueState;

    // Validate version
    if (state.version !== STATE_VERSION) {
      console.warn(`[queue-persister] Unknown state version ${state.version}, ignoring`);
      return null;
    }

    return state;
  } catch (error) {
    console.error('[queue-persister] Failed to load queue state:', error);
    return null;
  }
}

/**
 * Clear queue state files
 */
export function clearQueueState(): void {
  try {
    if (fs.existsSync(LANES_FILE)) {
      fs.unlinkSync(LANES_FILE);
    }
    if (fs.existsSync(IN_FLIGHT_FILE)) {
      fs.unlinkSync(IN_FLIGHT_FILE);
    }
    if (fs.existsSync(CURRENT_TASK_FILE)) {
      fs.unlinkSync(CURRENT_TASK_FILE);
    }
  } catch (error) {
    console.error('[queue-persister] Failed to clear queue state:', error);
  }
}

// ============================================================================
// In-Flight Remote Tasks
// ============================================================================

/**
 * Save in-flight remote tasks to disk
 */
export function saveInFlightTasks(tasks: RemoteTaskHandle[]): void {
  ensureStateDir();
  try {
    fs.writeFileSync(IN_FLIGHT_FILE, JSON.stringify(tasks, null, 2));
  } catch (error) {
    console.error('[queue-persister] Failed to save in-flight tasks:', error);
  }
}

/**
 * Load in-flight remote tasks from disk
 */
export function loadInFlightTasks(): RemoteTaskHandle[] {
  try {
    if (!fs.existsSync(IN_FLIGHT_FILE)) {
      return [];
    }
    const data = fs.readFileSync(IN_FLIGHT_FILE, 'utf-8');
    return JSON.parse(data) as RemoteTaskHandle[];
  } catch (error) {
    console.error('[queue-persister] Failed to load in-flight tasks:', error);
    return [];
  }
}

// ============================================================================
// Current Task (Crash Recovery)
// ============================================================================

/**
 * Save current task being executed
 */
export function saveCurrentTask(task: QueuedTask, lane: ResourceLaneId): void {
  ensureStateDir();
  try {
    const state: PersistedCurrentTask = {
      task,
      startedAt: new Date().toISOString(),
      lane,
    };
    fs.writeFileSync(CURRENT_TASK_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('[queue-persister] Failed to save current task:', error);
  }
}

/**
 * Load current task if one was in progress during crash
 */
export function loadCurrentTask(): PersistedCurrentTask | null {
  try {
    if (!fs.existsSync(CURRENT_TASK_FILE)) {
      return null;
    }
    const data = fs.readFileSync(CURRENT_TASK_FILE, 'utf-8');
    return JSON.parse(data) as PersistedCurrentTask;
  } catch (error) {
    console.error('[queue-persister] Failed to load current task:', error);
    return null;
  }
}

/**
 * Clear current task file
 */
export function clearCurrentTask(): void {
  try {
    if (fs.existsSync(CURRENT_TASK_FILE)) {
      fs.unlinkSync(CURRENT_TASK_FILE);
    }
  } catch (error) {
    console.error('[queue-persister] Failed to clear current task:', error);
  }
}

// ============================================================================
// Debounced Save Handler
// ============================================================================

/**
 * Creates a debounced save function for the queue manager
 */
export function createDebouncedSaver(
  getState: () => QueueState,
  debounceMs: number = SAVE_DEBOUNCE_MS
): () => void {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingSave = false;

  return () => {
    pendingSave = true;

    if (timeoutId) {
      return; // Already scheduled
    }

    timeoutId = setTimeout(() => {
      if (pendingSave) {
        const state = getState();
        persistQueueState(state);
        pendingSave = false;
      }
      timeoutId = null;
    }, debounceMs);
  };
}

/**
 * Creates an immediate save function (for shutdown)
 */
export function createImmediateSaver(
  getState: () => QueueState
): () => void {
  return () => {
    const state = getState();
    persistQueueState(state);
  };
}

// ============================================================================
// Recovery Utilities
// ============================================================================

/**
 * Check if there's a crashed task that needs recovery
 */
export function hasUnfinishedTask(): boolean {
  return loadCurrentTask() !== null;
}

/**
 * Get age of persisted state in milliseconds
 */
export function getStateAge(): number | null {
  try {
    if (!fs.existsSync(LANES_FILE)) {
      return null;
    }
    const data = fs.readFileSync(LANES_FILE, 'utf-8');
    const state = JSON.parse(data) as PersistedQueueState;
    const savedAt = new Date(state.savedAt).getTime();
    return Date.now() - savedAt;
  } catch {
    return null;
  }
}

/**
 * Determine if persisted state should be restored
 * Returns false if state is too old (> 1 hour)
 */
export function shouldRestoreState(maxAgeMs: number = 60 * 60 * 1000): boolean {
  const age = getStateAge();
  if (age === null) {
    return false;
  }
  return age < maxAgeMs;
}

/**
 * Log recovery event to audit
 */
export function auditRecovery(
  tasksRestored: number,
  inFlightRestored: number,
  crashedTaskId?: string
): void {
  audit({
    level: 'info',
    category: 'system',
    event: 'queue_state_recovered',
    actor: 'queue_persister',
    details: {
      tasksRestored,
      inFlightRestored,
      crashedTaskId,
    },
  });
}
