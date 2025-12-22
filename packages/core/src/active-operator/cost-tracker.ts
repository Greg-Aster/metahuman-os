/**
 * Cost Tracker for Active Operator
 *
 * Tracks token usage and enforces energy budget limits.
 * Provides metrics for monitoring LLM costs.
 */

import type { OperatorMetrics, TaskType, TaskResult } from './types.js';
import { loadMetrics, saveMetrics, loadConfig } from './state-persister.js';

/**
 * Record tokens used for a task.
 */
export function recordTokenUsage(tokens: number): void {
  const metrics = loadMetrics();
  const currentHour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH

  // Update total
  metrics.totalTokensUsed += tokens;

  // Update hourly tracking
  if (!metrics.tokensPerHour[currentHour]) {
    metrics.tokensPerHour[currentHour] = 0;
  }
  metrics.tokensPerHour[currentHour] += tokens;

  // Clean up old hourly entries (keep last 24 hours)
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);
  const cutoffHour = cutoff.toISOString().slice(0, 13);

  for (const hour of Object.keys(metrics.tokensPerHour)) {
    if (hour < cutoffHour) {
      delete metrics.tokensPerHour[hour];
    }
  }

  saveMetrics(metrics);
}

/**
 * Record a task execution result.
 */
export function recordTaskExecution(
  taskType: TaskType,
  result: TaskResult
): void {
  const metrics = loadMetrics();

  // Update task counts
  metrics.totalTasksExecuted++;

  if (!metrics.tasksByType[taskType]) {
    metrics.tasksByType[taskType] = 0;
  }
  metrics.tasksByType[taskType]++;

  // Update success/failure counts
  if (result.success) {
    metrics.successCount++;
    metrics.consecutiveErrors = 0;
  } else {
    metrics.failureCount++;
    metrics.consecutiveErrors++;
    metrics.lastError = result.error;
    metrics.lastErrorAt = result.completedAt;
  }

  // Record token usage if available
  if (result.tokensUsed) {
    recordTokenUsage(result.tokensUsed);
  }

  // Update average duration
  const totalDuration =
    metrics.averageDurationMs * (metrics.totalTasksExecuted - 1) + result.durationMs;
  metrics.averageDurationMs = totalDuration / metrics.totalTasksExecuted;

  saveMetrics(metrics);
}

/**
 * Get tokens used in the current hour.
 */
export function getTokensUsedThisHour(): number {
  const metrics = loadMetrics();
  const currentHour = new Date().toISOString().slice(0, 13);
  return metrics.tokensPerHour[currentHour] || 0;
}

/**
 * Check if we're within the energy budget.
 * Returns true if OK to proceed, false if budget exceeded.
 */
export function isWithinBudget(): boolean {
  const config = loadConfig();

  // If budget not enabled, always within budget
  if (!config.energyBudget.enabled) {
    return true;
  }

  // If no limit set (0 = unlimited), always within budget
  if (config.energyBudget.tokensPerHour <= 0) {
    return true;
  }

  const tokensUsed = getTokensUsedThisHour();
  return tokensUsed < config.energyBudget.tokensPerHour;
}

/**
 * Get remaining budget for this hour.
 * Returns -1 if budget is unlimited.
 */
export function getRemainingBudget(): number {
  const config = loadConfig();

  if (!config.energyBudget.enabled || config.energyBudget.tokensPerHour <= 0) {
    return -1; // Unlimited
  }

  const tokensUsed = getTokensUsedThisHour();
  return Math.max(0, config.energyBudget.tokensPerHour - tokensUsed);
}

/**
 * Get budget utilization percentage.
 * Returns 0 if unlimited.
 */
export function getBudgetUtilization(): number {
  const config = loadConfig();

  if (!config.energyBudget.enabled || config.energyBudget.tokensPerHour <= 0) {
    return 0;
  }

  const tokensUsed = getTokensUsedThisHour();
  return (tokensUsed / config.energyBudget.tokensPerHour) * 100;
}

/**
 * Get a cost summary for display.
 */
export function getCostSummary(): {
  totalTokens: number;
  tokensThisHour: number;
  budgetEnabled: boolean;
  budgetLimit: number;
  budgetRemaining: number;
  budgetUtilization: number;
  tasksExecuted: number;
  successRate: number;
  averageDurationMs: number;
} {
  const config = loadConfig();
  const metrics = loadMetrics();

  const tokensThisHour = getTokensUsedThisHour();
  const totalTasks = metrics.successCount + metrics.failureCount;
  const successRate = totalTasks > 0 ? (metrics.successCount / totalTasks) * 100 : 100;

  return {
    totalTokens: metrics.totalTokensUsed,
    tokensThisHour,
    budgetEnabled: config.energyBudget.enabled,
    budgetLimit: config.energyBudget.tokensPerHour,
    budgetRemaining: getRemainingBudget(),
    budgetUtilization: getBudgetUtilization(),
    tasksExecuted: metrics.totalTasksExecuted,
    successRate,
    averageDurationMs: metrics.averageDurationMs,
  };
}

/**
 * Check if we should pause due to consecutive errors.
 */
export function shouldPauseDueToErrors(): boolean {
  const config = loadConfig();
  const metrics = loadMetrics();

  return metrics.consecutiveErrors >= config.maxConsecutiveErrors;
}

/**
 * Get error status.
 */
export function getErrorStatus(): {
  consecutiveErrors: number;
  maxErrors: number;
  shouldPause: boolean;
  lastError?: string;
  lastErrorAt?: string;
} {
  const config = loadConfig();
  const metrics = loadMetrics();

  return {
    consecutiveErrors: metrics.consecutiveErrors,
    maxErrors: config.maxConsecutiveErrors,
    shouldPause: shouldPauseDueToErrors(),
    lastError: metrics.lastError,
    lastErrorAt: metrics.lastErrorAt,
  };
}

/**
 * Reset error counter (call after successful recovery).
 */
export function resetErrorCounter(): void {
  const metrics = loadMetrics();
  metrics.consecutiveErrors = 0;
  delete metrics.lastError;
  delete metrics.lastErrorAt;
  saveMetrics(metrics);
}
