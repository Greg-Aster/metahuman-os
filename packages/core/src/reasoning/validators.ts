/**
 * Reasoning Service - Validators
 *
 * Validation logic for reasoning steps (failure loop detection, etc.).
 * Extracted from Operator V2.
 */

import type { ScratchpadEntry, FailureTracker } from './types';

/**
 * Detect if we're in a failure loop (same action failing repeatedly).
 *
 * Tracks failures per unique action (tool + args).
 * After 2 failures of the same action, warns the planner.
 *
 * @param scratchpad - Current scratchpad entries
 * @param currentAction - Action about to be executed
 * @returns Loop detection result with suggestion
 */
export function detectFailureLoop(
  scratchpad: ScratchpadEntry[],
  currentAction: { tool: string; args: any }
): { isLoop: boolean; suggestion: string } {
  const failures: FailureTracker = {};

  // Count failures for each unique action
  for (const entry of scratchpad) {
    if (entry.observation && !entry.observation.success && entry.action) {
      const key = `${entry.action.tool}:${JSON.stringify(entry.action.args)}`;

      if (!failures[key]) {
        failures[key] = { count: 0, lastError: '' };
      }

      failures[key].count++;
      failures[key].lastError = entry.observation.error?.message || '';
    }
  }

  // Check if current action has already failed
  const currentKey = `${currentAction.tool}:${JSON.stringify(currentAction.args)}`;
  const currentFailures = failures[currentKey];

  if (currentFailures && currentFailures.count >= 2) {
    return {
      isLoop: true,
      suggestion: `⚠️ This action (${currentAction.tool}) has already failed ${currentFailures.count} times. Consider trying a different approach. Last error: ${currentFailures.lastError}`,
    };
  }

  return { isLoop: false, suggestion: '' };
}

/**
 * Check if scratchpad indicates we're making progress.
 *
 * @param scratchpad - Current scratchpad entries
 * @returns True if at least one successful observation exists
 */
export function hasProgress(scratchpad: ScratchpadEntry[]): boolean {
  return scratchpad.some((e) => e.observation && e.observation.success);
}

/**
 * Check if we should stop early (all errors, no progress).
 *
 * @param scratchpad - Current scratchpad entries
 * @param minSteps - Minimum steps before early stopping
 * @returns True if should stop
 */
export function shouldStopEarly(scratchpad: ScratchpadEntry[], minSteps: number = 3): boolean {
  if (scratchpad.length < minSteps) {
    return false;
  }

  // If all observations are errors, stop
  const observations = scratchpad.filter((e) => e.observation);
  if (observations.length === 0) {
    return false;
  }

  const allErrors = observations.every((e) => !e.observation!.success);
  return allErrors;
}
