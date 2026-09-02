/**
 * State Management
 *
 * Manages short-term working state for the orchestrator.
 * Part of Phase 5: Conscious/Unconscious State implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';
import { audit } from './audit.js';

// ============================================================================
// Short-Term State (Orchestrator Working Memory)
// ============================================================================

export interface ShortTermState {
  currentFocus: string;
  activeTasks: string[];
  recentToolOutputs: Record<string, {
    cached: string;
    [key: string]: any;
  }>;
  conversationContext: {
    lastTopics: string[];
    userIntent: string;
    sessionStarted?: string;
  };
  lastUpdated: string;
}

export interface ToolOutput {
  cached: string;
  [key: string]: any;
}

const SHORT_TERM_STATE_PATH = path.join(systemPaths.out, 'state', 'short-term.json');

function ensureStateDir() {
  const stateDir = path.dirname(SHORT_TERM_STATE_PATH);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

/**
 * Load short-term state (orchestrator working memory)
 */
export function loadShortTermState(): ShortTermState {
  ensureStateDir();

  if (!fs.existsSync(SHORT_TERM_STATE_PATH)) {
    // Return default state
    return {
      currentFocus: '',
      activeTasks: [],
      recentToolOutputs: {},
      conversationContext: {
        lastTopics: [],
        userIntent: '',
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    const content = fs.readFileSync(SHORT_TERM_STATE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[state] Failed to load short-term state:', error);
    return {
      currentFocus: '',
      activeTasks: [],
      recentToolOutputs: {},
      conversationContext: {
        lastTopics: [],
        userIntent: '',
      },
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save short-term state with audit logging
 */
export function saveShortTermState(state: ShortTermState, actor = 'system') {
  ensureStateDir();

  state.lastUpdated = new Date().toISOString();

  try {
    fs.writeFileSync(SHORT_TERM_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');

    audit({
      level: 'info',
      category: 'data',
      event: 'short_term_state_updated',
      actor,
      details: {
        focus: state.currentFocus,
        activeTasks: state.activeTasks.length,
        toolOutputsCached: Object.keys(state.recentToolOutputs).length,
        topics: state.conversationContext.lastTopics,
      },
    });
  } catch (error) {
    console.error('[state] Failed to save short-term state:', error);
    audit({
      level: 'error',
      category: 'system',
      event: 'short_term_state_save_failed',
      actor,
      details: { error: (error as Error).message },
    });
  }
}

/**
 * Update current focus
 */
export function updateCurrentFocus(focus: string, actor = 'orchestrator') {
  const state = loadShortTermState();
  state.currentFocus = focus;
  saveShortTermState(state, actor);
}

/**
 * Add active task to short-term state
 */
export function addActiveTask(taskId: string, actor = 'orchestrator') {
  const state = loadShortTermState();
  if (!state.activeTasks.includes(taskId)) {
    state.activeTasks.push(taskId);
    saveShortTermState(state, actor);
  }
}

/**
 * Remove active task from short-term state
 */
export function removeActiveTask(taskId: string, actor = 'orchestrator') {
  const state = loadShortTermState();
  state.activeTasks = state.activeTasks.filter(t => t !== taskId);
  saveShortTermState(state, actor);
}

/**
 * Cache tool output for quick reference
 */
export function cacheToolOutput(toolName: string, output: any, actor = 'orchestrator') {
  const state = loadShortTermState();
  state.recentToolOutputs[toolName] = {
    ...output,
    cached: new Date().toISOString(),
  };

  // Keep only last 20 tool outputs
  const keys = Object.keys(state.recentToolOutputs);
  if (keys.length > 20) {
    const sorted = keys.sort((a, b) => {
      const aTime = state.recentToolOutputs[a].cached;
      const bTime = state.recentToolOutputs[b].cached;
      return aTime.localeCompare(bTime);
    });
    // Remove oldest
    delete state.recentToolOutputs[sorted[0]];
  }

  saveShortTermState(state, actor);
}

/**
 * Update conversation context
 */
export function updateConversationContext(
  topics: string[],
  intent: string,
  actor = 'orchestrator'
) {
  const state = loadShortTermState();

  // Keep only last 10 topics
  state.conversationContext.lastTopics = [
    ...new Set([...topics, ...state.conversationContext.lastTopics])
  ].slice(0, 10);

  state.conversationContext.userIntent = intent;

  saveShortTermState(state, actor);
}

/**
 * Get context summary for orchestrator (short-term focus)
 */
export function getOrchestratorContext(): string {
  const state = loadShortTermState();

  const parts: string[] = [];

  if (state.currentFocus) {
    parts.push(`Current focus: ${state.currentFocus}`);
  }

  if (state.activeTasks.length > 0) {
    parts.push(`Active tasks: ${state.activeTasks.join(', ')}`);
  }

  if (state.conversationContext.lastTopics.length > 0) {
    parts.push(`Recent topics: ${state.conversationContext.lastTopics.slice(0, 5).join(', ')}`);
  }

  if (state.conversationContext.userIntent) {
    parts.push(`User intent: ${state.conversationContext.userIntent}`);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * Clear short-term state (session reset)
 */
export function clearShortTermState(actor = 'system') {
  const state: ShortTermState = {
    currentFocus: '',
    activeTasks: [],
    recentToolOutputs: {},
    conversationContext: {
      lastTopics: [],
      userIntent: '',
      sessionStarted: new Date().toISOString(),
    },
    lastUpdated: new Date().toISOString(),
  };

  saveShortTermState(state, actor);

  audit({
    level: 'info',
    category: 'action',
    event: 'short_term_state_cleared',
    actor,
    details: { timestamp: new Date().toISOString() },
  });
}
