/**
 * Lizard Brain Logger
 *
 * Provides structured logging for Lizard Brain autonomous decisions.
 * Logs are stored in user profiles via storageClient:
 *   profiles/<username>/state/lizard-brain/logs/YYYY-MM-DD.json
 *
 * Features:
 * - Daily log files with decision history
 * - Summary statistics for quick overview
 * - Big Brother review tracking
 * - 7-day rolling retention (configurable)
 */

import { storageClient } from '../storage-client.js';
import { audit } from '../audit.js';
import type { TaskType, TaskResult, SystemState } from './types.js';
import type { DecisionScratchpad } from './state-persister.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A single Lizard Brain decision log entry.
 */
export interface LizardBrainLogEntry {
  /** Unique entry identifier */
  id: string;

  /** ISO timestamp of the decision */
  timestamp: string;

  /** Cycle number from scratchpad */
  cycleNumber: number;

  /** Username context */
  username: string;

  /** Decision details */
  decision: {
    /** Task type chosen (or null if no task) */
    task: TaskType | null;
    /** LLM reasoning for the decision */
    reasoning: string;
    /** Number of triggers evaluated */
    triggersEvaluated: number;
    /** Triggers that fired this cycle */
    triggersFired: string[];
  };

  /** Execution result (populated after task completes) */
  execution?: {
    /** Whether execution succeeded */
    success: boolean;
    /** Duration in milliseconds */
    durationMs: number;
    /** Error message if failed */
    error?: string;
    /** Task result data */
    outputs?: unknown;
  };

  /** System context snapshot at decision time */
  context: {
    /** Tasks in queue */
    queueLength: number;
    /** Key system state metrics */
    systemState: Partial<SystemState>;
    /** Scratchpad entry count */
    scratchpadSize: number;
  };

  /** Big Brother review details (if triggered) */
  bigBrotherReview?: {
    /** When review was triggered */
    triggeredAt: string;
    /** Why review was triggered */
    reason: 'periodic' | 'error_detected' | 'stuck_detected' | 'manual';
    /** Review result/outcome */
    result?: string;
    /** Suggestions from Big Brother */
    suggestions?: string[];
    /** Instructions written to scratchpad */
    scratchpadInstructions?: string;
  };
}

/**
 * Daily log file structure.
 */
export interface LizardBrainLogFile {
  /** Date of the log (YYYY-MM-DD) */
  date: string;

  /** Log entries for the day */
  entries: LizardBrainLogEntry[];

  /** Summary statistics */
  summary: {
    /** Total cycles logged */
    totalCycles: number;
    /** Number of tasks executed */
    tasksExecuted: number;
    /** Success rate (0-1) */
    successRate: number;
    /** Number of Big Brother reviews */
    bigBrotherReviews: number;
    /** Number of errors detected */
    errorsDetected: number;
    /** Tasks by type count */
    tasksByType: Record<string, number>;
  };
}

/**
 * Configuration for the logger.
 */
export interface LizardBrainLoggerConfig {
  /** Days to retain logs (default: 7) */
  retentionDays: number;
  /** Enable verbose logging to console */
  verbose: boolean;
}

const DEFAULT_CONFIG: LizardBrainLoggerConfig = {
  retentionDays: 7,
  verbose: false,
};

// ============================================================================
// Log Management
// ============================================================================

/**
 * Get today's date string (YYYY-MM-DD).
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Generate a unique log entry ID.
 */
function generateEntryId(): string {
  return `lb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create an empty log file structure.
 */
function createEmptyLogFile(date: string): LizardBrainLogFile {
  return {
    date,
    entries: [],
    summary: {
      totalCycles: 0,
      tasksExecuted: 0,
      successRate: 0,
      bigBrotherReviews: 0,
      errorsDetected: 0,
      tasksByType: {},
    },
  };
}

/**
 * Update summary statistics from entries.
 */
function updateSummary(logFile: LizardBrainLogFile): void {
  const { entries, summary } = logFile;

  summary.totalCycles = entries.length;
  summary.tasksExecuted = entries.filter((e) => e.decision.task !== null).length;

  const executed = entries.filter((e) => e.execution);
  const successful = executed.filter((e) => e.execution?.success);
  summary.successRate = executed.length > 0 ? successful.length / executed.length : 0;

  summary.bigBrotherReviews = entries.filter((e) => e.bigBrotherReview).length;
  summary.errorsDetected = entries.filter(
    (e) => e.execution && !e.execution.success
  ).length;

  // Count tasks by type
  summary.tasksByType = {};
  for (const entry of entries) {
    if (entry.decision.task) {
      summary.tasksByType[entry.decision.task] =
        (summary.tasksByType[entry.decision.task] || 0) + 1;
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Load logs for a specific date.
 *
 * @param username - User to load logs for
 * @param date - Date string (YYYY-MM-DD), defaults to today
 */
export async function getLizardBrainLogs(
  username: string,
  date?: string
): Promise<LizardBrainLogFile> {
  const targetDate = date || getTodayDate();
  const logPath = `logs/${targetDate}.json`;

  const result = await storageClient.read({
    username,
    category: 'state',
    subcategory: 'lizard-brain',
    relativePath: logPath,
    encoding: 'utf8',
  });

  if (result.success && result.data) {
    try {
      return JSON.parse(result.data as string) as LizardBrainLogFile;
    } catch {
      console.error('[lizard-brain-logger] Failed to parse log file:', logPath);
    }
  }

  return createEmptyLogFile(targetDate);
}

/**
 * Save a log file.
 *
 * @param username - User to save logs for
 * @param logFile - Log file to save
 */
async function saveLizardBrainLogs(
  username: string,
  logFile: LizardBrainLogFile
): Promise<void> {
  const logPath = `logs/${logFile.date}.json`;

  await storageClient.write({
    username,
    category: 'state',
    subcategory: 'lizard-brain',
    relativePath: logPath,
    data: JSON.stringify(logFile, null, 2),
    encoding: 'utf8',
  });
}

/**
 * Log a Lizard Brain decision cycle.
 *
 * @param entry - Log entry to record
 * @param username - User context
 */
export async function logLizardBrainCycle(
  entry: Omit<LizardBrainLogEntry, 'id'>,
  username: string
): Promise<string> {
  const fullEntry: LizardBrainLogEntry = {
    ...entry,
    id: generateEntryId(),
  };

  const date = fullEntry.timestamp.split('T')[0];
  const logFile = await getLizardBrainLogs(username, date);

  logFile.entries.push(fullEntry);
  updateSummary(logFile);

  await saveLizardBrainLogs(username, logFile);

  audit({
    level: 'info',
    category: 'system',
    event: 'lizard_brain_cycle_logged',
    actor: 'active-operator',
    details: {
      username,
      cycleNumber: fullEntry.cycleNumber,
      task: fullEntry.decision.task,
      entryId: fullEntry.id,
    },
  });

  return fullEntry.id;
}

/**
 * Update an existing log entry (e.g., to add execution result).
 *
 * @param username - User context
 * @param entryId - ID of entry to update
 * @param updates - Fields to update
 */
export async function updateLogEntry(
  username: string,
  entryId: string,
  updates: Partial<Pick<LizardBrainLogEntry, 'execution' | 'bigBrotherReview'>>
): Promise<boolean> {
  // Find the log file containing this entry (check today and yesterday)
  const today = getTodayDate();
  let logFile = await getLizardBrainLogs(username, today);
  let entry = logFile.entries.find((e) => e.id === entryId);

  if (!entry) {
    // Check yesterday's log
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    logFile = await getLizardBrainLogs(username, yesterday);
    entry = logFile.entries.find((e) => e.id === entryId);
  }

  if (!entry) {
    console.warn(`[lizard-brain-logger] Entry not found: ${entryId}`);
    return false;
  }

  // Apply updates
  if (updates.execution) {
    entry.execution = updates.execution;
  }
  if (updates.bigBrotherReview) {
    entry.bigBrotherReview = updates.bigBrotherReview;
  }

  updateSummary(logFile);
  await saveLizardBrainLogs(username, logFile);

  return true;
}

/**
 * Record task execution result for the most recent log entry.
 *
 * @param username - User context
 * @param result - Task execution result
 */
export async function recordExecutionResult(
  username: string,
  result: TaskResult
): Promise<void> {
  const logFile = await getLizardBrainLogs(username);

  // Find the most recent entry without execution result
  const entry = [...logFile.entries]
    .reverse()
    .find((e) => !e.execution && e.decision.task);

  if (entry) {
    entry.execution = {
      success: result.success,
      durationMs: result.durationMs,
      error: result.error,
      outputs: result.data,
    };

    updateSummary(logFile);
    await saveLizardBrainLogs(username, logFile);
  }
}

/**
 * Record a Big Brother review.
 *
 * @param username - User context
 * @param review - Review details
 * @param entryId - Optional specific entry ID (defaults to most recent)
 */
export async function recordBigBrotherReview(
  username: string,
  review: LizardBrainLogEntry['bigBrotherReview'],
  entryId?: string
): Promise<void> {
  const logFile = await getLizardBrainLogs(username);

  let entry: LizardBrainLogEntry | undefined;
  if (entryId) {
    entry = logFile.entries.find((e) => e.id === entryId);
  } else {
    // Get most recent entry
    entry = logFile.entries[logFile.entries.length - 1];
  }

  if (entry) {
    entry.bigBrotherReview = review;
    updateSummary(logFile);
    await saveLizardBrainLogs(username, logFile);

    audit({
      level: 'info',
      category: 'system',
      event: 'lizard_brain_big_brother_review',
      actor: 'active-operator',
      details: {
        username,
        entryId: entry.id,
        reason: review?.reason,
      },
    });
  }
}

/**
 * Get log files available for a user.
 *
 * @param username - User to check
 */
export async function getAvailableLogDates(username: string): Promise<string[]> {
  const result = await storageClient.list({
    username,
    category: 'state',
    subcategory: 'lizard-brain',
    relativePath: 'logs',
  });

  if (!result.success || !result.files) {
    return [];
  }

  return result.files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort()
    .reverse();
}

/**
 * Clean up old log files beyond retention period.
 *
 * @param username - User to clean up
 * @param retentionDays - Days to keep (default: 7)
 */
export async function cleanupOldLogs(
  username: string,
  retentionDays: number = DEFAULT_CONFIG.retentionDays
): Promise<number> {
  const dates = await getAvailableLogDates(username);
  const cutoffDate = new Date(Date.now() - retentionDays * 86400000)
    .toISOString()
    .split('T')[0];

  let deletedCount = 0;

  for (const date of dates) {
    if (date < cutoffDate) {
      await storageClient.delete({
        username,
        category: 'state',
        subcategory: 'lizard-brain',
        relativePath: `logs/${date}.json`,
      });
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    audit({
      level: 'info',
      category: 'system',
      event: 'lizard_brain_logs_cleaned',
      actor: 'active-operator',
      details: {
        username,
        deletedCount,
        retentionDays,
      },
    });
  }

  return deletedCount;
}

/**
 * Get recent entries across multiple days.
 *
 * @param username - User to query
 * @param limit - Maximum entries to return
 */
export async function getRecentEntries(
  username: string,
  limit: number = 50
): Promise<LizardBrainLogEntry[]> {
  const dates = await getAvailableLogDates(username);
  const entries: LizardBrainLogEntry[] = [];

  for (const date of dates) {
    if (entries.length >= limit) break;

    const logFile = await getLizardBrainLogs(username, date);
    entries.push(...logFile.entries);
  }

  return entries.slice(0, limit);
}

/**
 * Get summary statistics across multiple days.
 *
 * @param username - User to query
 * @param days - Number of days to include
 */
export async function getMultiDaySummary(
  username: string,
  days: number = 7
): Promise<{
  totalCycles: number;
  tasksExecuted: number;
  successRate: number;
  bigBrotherReviews: number;
  errorsDetected: number;
  tasksByType: Record<string, number>;
  daysIncluded: number;
}> {
  const dates = await getAvailableLogDates(username);
  const includedDates = dates.slice(0, days);

  const aggregated = {
    totalCycles: 0,
    tasksExecuted: 0,
    successfulTasks: 0,
    bigBrotherReviews: 0,
    errorsDetected: 0,
    tasksByType: {} as Record<string, number>,
    daysIncluded: includedDates.length,
  };

  for (const date of includedDates) {
    const logFile = await getLizardBrainLogs(username, date);
    aggregated.totalCycles += logFile.summary.totalCycles;
    aggregated.tasksExecuted += logFile.summary.tasksExecuted;
    aggregated.successfulTasks += Math.round(
      logFile.summary.tasksExecuted * logFile.summary.successRate
    );
    aggregated.bigBrotherReviews += logFile.summary.bigBrotherReviews;
    aggregated.errorsDetected += logFile.summary.errorsDetected;

    for (const [type, count] of Object.entries(logFile.summary.tasksByType)) {
      aggregated.tasksByType[type] = (aggregated.tasksByType[type] || 0) + count;
    }
  }

  return {
    ...aggregated,
    successRate:
      aggregated.tasksExecuted > 0
        ? aggregated.successfulTasks / aggregated.tasksExecuted
        : 0,
  };
}

/**
 * Create a log entry from current cycle state.
 * Helper function for service-manager integration.
 */
export function createLogEntryFromCycle(
  username: string,
  cycleNumber: number,
  decision: {
    task: TaskType | null;
    reasoning: string;
  },
  triggers: {
    evaluated: number;
    fired: string[];
  },
  systemState: Partial<SystemState>,
  scratchpadSize: number
): Omit<LizardBrainLogEntry, 'id'> {
  return {
    timestamp: new Date().toISOString(),
    cycleNumber,
    username,
    decision: {
      task: decision.task,
      reasoning: decision.reasoning,
      triggersEvaluated: triggers.evaluated,
      triggersFired: triggers.fired,
    },
    context: {
      queueLength: systemState.queueLength || 0,
      systemState: {
        unprocessedMemories: systemState.unprocessedMemories,
        indexAgeHours: systemState.indexAgeHours,
        pendingDesires: systemState.pendingDesires,
        activeDesires: systemState.activeDesires,
        hoursSinceReflection: systemState.hoursSinceReflection,
        userActive: systemState.userActive,
      },
      scratchpadSize,
    },
  };
}
