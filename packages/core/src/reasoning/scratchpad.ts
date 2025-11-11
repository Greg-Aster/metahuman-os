/**
 * Reasoning Service - Scratchpad Management
 *
 * Functions for formatting and managing the reasoning scratchpad.
 * Extracted from Operator V2.
 */

import type { ScratchpadEntry } from './types';

/**
 * Format scratchpad entries for LLM consumption.
 * Trims to last N entries to manage token limits.
 *
 * @param scratchpad - Array of scratchpad entries
 * @param trimToLastN - Number of recent entries to include (default: 10)
 * @returns Formatted text for LLM prompt
 */
export function formatScratchpadForLLM(
  scratchpad: ScratchpadEntry[],
  trimToLastN: number = 10
): string {
  if (scratchpad.length === 0) {
    return '(Empty - this is your first step)';
  }

  // Trim to last N steps to manage token limits
  const recentSteps = scratchpad.slice(-trimToLastN);

  return recentSteps
    .map((entry) => {
      let text = `Thought ${entry.step}: ${entry.thought}\n`;

      if (entry.action) {
        text += `Action ${entry.step}: ${entry.action.tool}(${JSON.stringify(entry.action.args)})\n`;
      }

      if (entry.observation) {
        if (entry.observation.success) {
          text += `Observation ${entry.step}: ${entry.observation.content}`;
        } else {
          text += `Observation ${entry.step}: ❌ ERROR - ${entry.observation.error?.message}`;
        }
      }

      return text;
    })
    .join('\n\n---\n\n');
}

/**
 * Get observations from scratchpad (for final response generation).
 *
 * @param scratchpad - Array of scratchpad entries
 * @returns Concatenated observations
 */
export function getObservations(scratchpad: ScratchpadEntry[]): string {
  return scratchpad
    .filter((e) => e.observation)
    .map((e) => e.observation!.content)
    .join('\n\n');
}

/**
 * Get last successful observation from scratchpad.
 *
 * @param scratchpad - Array of scratchpad entries
 * @returns Last successful observation content, or null
 */
export function getLastSuccessfulObservation(scratchpad: ScratchpadEntry[]): string | null {
  for (let i = scratchpad.length - 1; i >= 0; i--) {
    const entry = scratchpad[i];
    if (entry.observation && entry.observation.success) {
      return entry.observation.content;
    }
  }
  return null;
}

/**
 * Count errors in scratchpad.
 *
 * @param scratchpad - Array of scratchpad entries
 * @returns Number of failed observations
 */
export function countErrors(scratchpad: ScratchpadEntry[]): number {
  return scratchpad.filter((e) => e.observation && !e.observation.success).length;
}

/**
 * Get all tool names used in scratchpad.
 *
 * @param scratchpad - Array of scratchpad entries
 * @returns Array of unique tool names
 */
export function getUsedTools(scratchpad: ScratchpadEntry[]): string[] {
  const tools = scratchpad.filter((e) => e.action).map((e) => e.action!.tool);
  return [...new Set(tools)];
}
