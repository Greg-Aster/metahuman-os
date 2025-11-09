/**
 * Summary State Management
 *
 * Workstream C1-C3 from memory-continuity-performance-directive.md
 *
 * Prevents duplicate concurrent summarization calls by tracking
 * which sessions are currently being summarized.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { paths } from './paths.js';
import { audit } from './audit.js';

export type SummaryMarker = 'idle' | 'summarizing' | 'completed';

export interface SummaryStateEntry {
  sessionId: string;
  marker: SummaryMarker;
  startedAt?: string;
  completedAt?: string;
  lastUpdated: string;
}

/**
 * Get the summary state file path for a user profile
 */
function getSummaryStatePath(username: string): string {
  return path.join(paths.root, 'profiles', username, 'state', 'summary-state.json');
}

/**
 * Load summary state for a user
 */
async function loadSummaryState(username: string): Promise<Record<string, SummaryStateEntry>> {
  const statePath = getSummaryStatePath(username);

  try {
    const exists = fsSync.existsSync(statePath);
    if (!exists) {
      return {};
    }

    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    audit({
      level: 'warn',
      category: 'system',
      event: 'summary_state_load_failed',
      details: { username, error: (error as Error).message },
      actor: 'system',
    });
    return {};
  }
}

/**
 * Save summary state for a user
 */
async function saveSummaryState(username: string, state: Record<string, SummaryStateEntry>): Promise<void> {
  const statePath = getSummaryStatePath(username);
  const stateDir = path.dirname(statePath);

  try {
    // Ensure state directory exists
    await fs.mkdir(stateDir, { recursive: true });

    // Write state file
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    audit({
      level: 'warn',
      category: 'system',
      event: 'summary_state_save_failed',
      details: { username, error: (error as Error).message },
      actor: 'system',
    });
  }
}

/**
 * C2: Mark a session as currently being summarized
 * Call this BEFORE starting the LLM summary generation
 */
export async function markSummarizing(username: string, sessionId: string): Promise<void> {
  const state = await loadSummaryState(username);

  state[sessionId] = {
    sessionId,
    marker: 'summarizing',
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  await saveSummaryState(username, state);

  audit({
    level: 'info',
    category: 'system',
    event: 'summary_marker_set_summarizing',
    details: { username, sessionId },
    actor: 'summarizer',
  });
}

/**
 * C2: Mark a session summary as completed
 * Call this AFTER successfully generating and saving the summary
 */
export async function markSummaryCompleted(username: string, sessionId: string): Promise<void> {
  const state = await loadSummaryState(username);

  if (state[sessionId]) {
    state[sessionId].marker = 'completed';
    state[sessionId].completedAt = new Date().toISOString();
    state[sessionId].lastUpdated = new Date().toISOString();

    await saveSummaryState(username, state);

    audit({
      level: 'info',
      category: 'system',
      event: 'summary_marker_set_completed',
      details: { username, sessionId },
      actor: 'summarizer',
    });
  }
}

/**
 * C2: Clear summary marker (on error/timeout)
 */
export async function clearSummaryMarker(username: string, sessionId: string): Promise<void> {
  const state = await loadSummaryState(username);

  if (state[sessionId]) {
    delete state[sessionId];
    await saveSummaryState(username, state);

    audit({
      level: 'info',
      category: 'system',
      event: 'summary_marker_cleared',
      details: { username, sessionId },
      actor: 'summarizer',
    });
  }
}

/**
 * C3: Check if a session is currently being summarized
 * Used by context builder to skip concurrent summarization
 */
export async function isSummarizing(username: string, sessionId: string): Promise<boolean> {
  const state = await loadSummaryState(username);
  const entry = state[sessionId];

  if (!entry) return false;

  // If marked as summarizing, check if it's stale (> 5 minutes)
  if (entry.marker === 'summarizing' && entry.startedAt) {
    const startTime = new Date(entry.startedAt).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // If stale, clear it and return false
    if (now - startTime > fiveMinutes) {
      await clearSummaryMarker(username, sessionId);

      audit({
        level: 'warn',
        category: 'system',
        event: 'summary_marker_stale_cleared',
        details: {
          username,
          sessionId,
          staleDurationMs: now - startTime,
        },
        actor: 'system',
      });

      return false;
    }

    return true;
  }

  return false;
}

/**
 * Get summary marker for a session
 */
export async function getSummaryMarker(username: string, sessionId: string): Promise<SummaryMarker> {
  const state = await loadSummaryState(username);
  return state[sessionId]?.marker || 'idle';
}

/**
 * Clean up old summary state entries (> 7 days)
 */
export async function cleanupOldSummaryState(username: string): Promise<{ removed: number }> {
  const state = await loadSummaryState(username);
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  let removed = 0;
  for (const [sessionId, entry] of Object.entries(state)) {
    const lastUpdatedTime = new Date(entry.lastUpdated).getTime();

    if (lastUpdatedTime < sevenDaysAgo) {
      delete state[sessionId];
      removed++;
    }
  }

  if (removed > 0) {
    await saveSummaryState(username, state);

    audit({
      level: 'info',
      category: 'system',
      event: 'summary_state_cleaned',
      details: { username, removed },
      actor: 'system',
    });
  }

  return { removed };
}
