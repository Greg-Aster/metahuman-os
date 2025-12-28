/**
 * State Persister for Active Operator
 *
 * Handles saving and loading operator state to/from disk:
 * - Queue state (tasks waiting to be processed)
 * - Metrics (usage statistics)
 * - Decision scratchpad (LLM reasoning history)
 * - Current execution context
 */

import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '../paths.js';
import type {
  QueuedTask,
  OperatorMetrics,
  ActiveOperatorConfig,
  TaskDecision,
  TaskResult,
} from './types.js';
import { DEFAULT_CONFIG, DEFAULT_METRICS } from './types.js';

// State file paths
const STATE_DIR = path.join(systemPaths.logs, 'run', 'active-operator');
const QUEUE_STATE_FILE = path.join(STATE_DIR, 'queue.json');
const METRICS_FILE = path.join(STATE_DIR, 'metrics.json');
const CURRENT_TASK_FILE = path.join(STATE_DIR, 'current-task.json');
const SCRATCHPAD_FILE = path.join(STATE_DIR, 'scratchpad.json');
const CONFIG_FILE = path.join(systemPaths.etc, 'active-operator.json');

/**
 * Ensure state directory exists.
 */
function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

// ============================================================================
// Decision Scratchpad
// ============================================================================

/**
 * A single entry in the decision scratchpad.
 */
export interface ScratchpadEntry {
  /** Entry timestamp */
  timestamp: string;
  /** Entry type */
  type: 'decision' | 'execution' | 'observation' | 'thought';
  /** Entry content */
  content: string;
  /** Optional structured data */
  data?: unknown;
}

/**
 * The decision scratchpad - tracks LLM reasoning history.
 */
export interface DecisionScratchpad {
  /** When the scratchpad was started */
  startedAt: string;
  /** Current cycle number */
  cycleNumber: number;
  /** Recent entries (trimmed to last N) */
  entries: ScratchpadEntry[];
  /** Last decision made */
  lastDecision?: TaskDecision;
  /** Last task result */
  lastResult?: TaskResult;
  /** Summary of recent activity (for context) */
  activitySummary?: string;
}

const MAX_SCRATCHPAD_ENTRIES = 50;

/**
 * Load scratchpad from disk.
 */
export function loadScratchpad(): DecisionScratchpad {
  try {
    if (!fs.existsSync(SCRATCHPAD_FILE)) {
      return createFreshScratchpad();
    }
    const data = fs.readFileSync(SCRATCHPAD_FILE, 'utf-8');
    return JSON.parse(data) as DecisionScratchpad;
  } catch (error) {
    console.error('[active-operator] Failed to load scratchpad:', error);
    return createFreshScratchpad();
  }
}

/**
 * Save scratchpad to disk.
 */
export function saveScratchpad(scratchpad: DecisionScratchpad): void {
  ensureStateDir();
  try {
    // Trim entries to max size
    if (scratchpad.entries.length > MAX_SCRATCHPAD_ENTRIES) {
      scratchpad.entries = scratchpad.entries.slice(-MAX_SCRATCHPAD_ENTRIES);
    }
    fs.writeFileSync(SCRATCHPAD_FILE, JSON.stringify(scratchpad, null, 2));
  } catch (error) {
    console.error('[active-operator] Failed to save scratchpad:', error);
  }
}

/**
 * Add an entry to the scratchpad.
 */
export function addScratchpadEntry(
  type: ScratchpadEntry['type'],
  content: string,
  data?: unknown
): void {
  const scratchpad = loadScratchpad();
  scratchpad.entries.push({
    timestamp: new Date().toISOString(),
    type,
    content,
    data,
  });
  saveScratchpad(scratchpad);
}

/**
 * Record a decision in the scratchpad.
 */
export function recordDecision(decision: TaskDecision): void {
  const scratchpad = loadScratchpad();
  scratchpad.lastDecision = decision;
  scratchpad.cycleNumber++;
  scratchpad.entries.push({
    timestamp: new Date().toISOString(),
    type: 'decision',
    content: `Cycle ${scratchpad.cycleNumber}: Decided to run "${decision.task}" - ${decision.reasoning}`,
    data: decision,
  });
  saveScratchpad(scratchpad);
}

/**
 * Record task execution start.
 */
export function recordExecutionStart(task: QueuedTask): void {
  addScratchpadEntry(
    'execution',
    `Started executing ${task.type} (${task.id})`,
    { taskId: task.id, type: task.type }
  );
}

/**
 * Record task result in the scratchpad.
 * Includes detailed outcome data so the LLM knows what actually happened.
 */
export function recordTaskResult(result: TaskResult): void {
  const scratchpad = loadScratchpad();
  scratchpad.lastResult = result;

  // Build a detailed observation message
  let content: string;
  if (result.success) {
    // Include key outcome data if available
    const data = result.data as Record<string, unknown> | undefined;
    if (data) {
      // Format outcome based on common result patterns
      const details: string[] = [];
      if ('processed' in data) details.push(`processed=${data.processed}`);
      if ('autoApproved' in data) details.push(`auto-approved=${data.autoApproved}`);
      if ('awaitingApproval' in data) details.push(`awaiting-approval=${data.awaitingApproval}`);
      if ('reason' in data) details.push(`reason: ${data.reason}`);
      if ('memoriesProcessed' in data) details.push(`memories=${data.memoriesProcessed}`);
      if ('entriesAdded' in data) details.push(`entries=${data.entriesAdded}`);
      if ('questionsGenerated' in data) details.push(`questions=${data.questionsGenerated}`);

      content = details.length > 0
        ? `Task completed (${result.durationMs}ms): ${details.join(', ')}`
        : `Task completed successfully in ${result.durationMs}ms`;
    } else {
      content = `Task completed successfully in ${result.durationMs}ms`;
    }
  } else {
    content = `Task FAILED: ${result.error}`;
  }

  scratchpad.entries.push({
    timestamp: new Date().toISOString(),
    type: 'observation',
    content,
    data: result,
  });
  saveScratchpad(scratchpad);
}

/**
 * Add a thought entry (LLM reasoning).
 */
export function recordThought(thought: string): void {
  addScratchpadEntry('thought', thought);
}

/**
 * Update activity summary.
 */
export function updateActivitySummary(summary: string): void {
  const scratchpad = loadScratchpad();
  scratchpad.activitySummary = summary;
  saveScratchpad(scratchpad);
}

/**
 * Create a fresh scratchpad.
 */
export function createFreshScratchpad(): DecisionScratchpad {
  return {
    startedAt: new Date().toISOString(),
    cycleNumber: 0,
    entries: [],
  };
}

/**
 * Clear the scratchpad.
 */
export function clearScratchpad(): void {
  const fresh = createFreshScratchpad();
  saveScratchpad(fresh);
}

/**
 * Get recent scratchpad context for LLM decision prompt.
 */
export function getScratchpadContext(maxEntries: number = 10): string {
  const scratchpad = loadScratchpad();
  const recentEntries = scratchpad.entries.slice(-maxEntries);

  if (recentEntries.length === 0) {
    return 'No previous activity in this session.';
  }

  const lines = recentEntries.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString();
    return `[${time}] ${e.type.toUpperCase()}: ${e.content}`;
  });

  return lines.join('\n');
}

// ============================================================================
// Queue State
// ============================================================================

/**
 * Save queue state to disk.
 */
export function saveQueueState(queue: QueuedTask[]): void {
  ensureStateDir();
  try {
    fs.writeFileSync(QUEUE_STATE_FILE, JSON.stringify(queue, null, 2));
  } catch (error) {
    console.error('[active-operator] Failed to save queue state:', error);
  }
}

/**
 * Load queue state from disk.
 */
export function loadQueueState(): QueuedTask[] | null {
  try {
    if (!fs.existsSync(QUEUE_STATE_FILE)) {
      return null;
    }
    const data = fs.readFileSync(QUEUE_STATE_FILE, 'utf-8');
    return JSON.parse(data) as QueuedTask[];
  } catch (error) {
    console.error('[active-operator] Failed to load queue state:', error);
    return null;
  }
}

/**
 * Clear queue state file.
 */
export function clearQueueState(): void {
  try {
    if (fs.existsSync(QUEUE_STATE_FILE)) {
      fs.unlinkSync(QUEUE_STATE_FILE);
    }
  } catch (error) {
    console.error('[active-operator] Failed to clear queue state:', error);
  }
}

// ============================================================================
// Current Task (for crash recovery)
// ============================================================================

/**
 * Save current task being executed.
 */
export function saveCurrentTask(task: QueuedTask): void {
  ensureStateDir();
  try {
    fs.writeFileSync(
      CURRENT_TASK_FILE,
      JSON.stringify({ task, startedAt: new Date().toISOString() }, null, 2)
    );
  } catch (error) {
    console.error('[active-operator] Failed to save current task:', error);
  }
}

/**
 * Load current task if one was in progress during crash.
 */
export function loadCurrentTask(): { task: QueuedTask; startedAt: string } | null {
  try {
    if (!fs.existsSync(CURRENT_TASK_FILE)) {
      return null;
    }
    const data = fs.readFileSync(CURRENT_TASK_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[active-operator] Failed to load current task:', error);
    return null;
  }
}

/**
 * Clear current task file.
 */
export function clearCurrentTask(): void {
  try {
    if (fs.existsSync(CURRENT_TASK_FILE)) {
      fs.unlinkSync(CURRENT_TASK_FILE);
    }
  } catch (error) {
    console.error('[active-operator] Failed to clear current task:', error);
  }
}

// ============================================================================
// Metrics
// ============================================================================

/**
 * Save metrics to disk.
 */
export function saveMetrics(metrics: OperatorMetrics): void {
  ensureStateDir();
  try {
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
  } catch (error) {
    console.error('[active-operator] Failed to save metrics:', error);
  }
}

/**
 * Load metrics from disk.
 */
export function loadMetrics(): OperatorMetrics {
  try {
    if (!fs.existsSync(METRICS_FILE)) {
      return { ...DEFAULT_METRICS };
    }
    const data = fs.readFileSync(METRICS_FILE, 'utf-8');
    return JSON.parse(data) as OperatorMetrics;
  } catch (error) {
    console.error('[active-operator] Failed to load metrics:', error);
    return { ...DEFAULT_METRICS };
  }
}

/**
 * Reset metrics.
 */
export function resetMetrics(): OperatorMetrics {
  const fresh: OperatorMetrics = {
    ...DEFAULT_METRICS,
    startedAt: new Date().toISOString(),
  };
  saveMetrics(fresh);
  return fresh;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Load configuration from disk.
 */
export function loadConfig(): ActiveOperatorConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG };
    }
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const loaded = JSON.parse(data) as Partial<ActiveOperatorConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...loaded,
      energyBudget: {
        ...DEFAULT_CONFIG.energyBudget,
        ...(loaded.energyBudget || {}),
      },
    };
  } catch (error) {
    console.error('[active-operator] Failed to load config:', error);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration to disk.
 */
export function saveConfig(config: ActiveOperatorConfig): void {
  try {
    const etcDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(etcDir)) {
      fs.mkdirSync(etcDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('[active-operator] Failed to save config:', error);
  }
}

/**
 * Update specific config fields.
 */
export function updateConfig(updates: Partial<ActiveOperatorConfig>): ActiveOperatorConfig {
  const current = loadConfig();
  const updated: ActiveOperatorConfig = {
    ...current,
    ...updates,
    energyBudget: {
      ...current.energyBudget,
      ...(updates.energyBudget || {}),
    },
  };
  saveConfig(updated);
  return updated;
}

// ============================================================================
// Full State Management
// ============================================================================

/**
 * Clear all operator state.
 */
export function clearAllState(): void {
  clearQueueState();
  clearCurrentTask();
  clearScratchpad();
  resetMetrics();
}

/**
 * Get state directory path.
 */
export function getStateDir(): string {
  ensureStateDir();
  return STATE_DIR;
}
