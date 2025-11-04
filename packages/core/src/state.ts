/**
 * State Management
 *
 * Manages short-term working state (for orchestrator) and long-term persona cache.
 * Part of Phase 5: Conscious/Unconscious State implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
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

const SHORT_TERM_STATE_PATH = path.join(paths.root, 'out', 'state', 'short-term.json');

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

// ============================================================================
// Persona Cache (Long-Term Frequently Referenced Facts)
// ============================================================================

export interface PersonaCache {
  catchphrases: string[];
  frequentFacts: Record<string, any>;
  quirks: string[];
  recentThemes: Array<{
    theme: string;
    frequency: number;
    lastSeen: string;
  }>;
  lastUpdated: string;
}

const PERSONA_CACHE_PATH = path.join(paths.persona, 'cache.json');

/**
 * Load persona cache
 */
export function loadPersonaCache(): PersonaCache {
  if (!fs.existsSync(PERSONA_CACHE_PATH)) {
    // Return default cache
    return {
      catchphrases: [],
      frequentFacts: {},
      quirks: [],
      recentThemes: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    const content = fs.readFileSync(PERSONA_CACHE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[state] Failed to load persona cache:', error);
    return {
      catchphrases: [],
      frequentFacts: {},
      quirks: [],
      recentThemes: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save persona cache with audit logging
 */
export function savePersonaCache(cache: PersonaCache, actor = 'system') {
  cache.lastUpdated = new Date().toISOString();

  try {
    fs.writeFileSync(PERSONA_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');

    audit({
      level: 'info',
      category: 'data',
      event: 'persona_cache_updated',
      actor,
      details: {
        catchphrases: cache.catchphrases.length,
        facts: Object.keys(cache.frequentFacts).length,
        quirks: cache.quirks.length,
        themes: cache.recentThemes.length,
      },
    });
  } catch (error) {
    console.error('[state] Failed to save persona cache:', error);
    audit({
      level: 'error',
      category: 'system',
      event: 'persona_cache_save_failed',
      actor,
      details: { error: (error as Error).message },
    });
  }
}

/**
 * Add or update a frequent fact
 */
export function updateFrequentFact(key: string, value: any, actor = 'digest_agent') {
  const cache = loadPersonaCache();
  cache.frequentFacts[key] = value;
  savePersonaCache(cache, actor);
}

/**
 * Add a catchphrase if not already present
 */
export function addCatchphrase(phrase: string, actor = 'digest_agent') {
  const cache = loadPersonaCache();
  if (!cache.catchphrases.includes(phrase)) {
    cache.catchphrases.push(phrase);
    // Keep only last 50 catchphrases
    if (cache.catchphrases.length > 50) {
      cache.catchphrases = cache.catchphrases.slice(-50);
    }
    savePersonaCache(cache, actor);
  }
}

/**
 * Add or increment a theme
 */
export function trackTheme(theme: string, actor = 'digest_agent') {
  const cache = loadPersonaCache();
  const existing = cache.recentThemes.find(t => t.theme === theme);

  if (existing) {
    existing.frequency++;
    existing.lastSeen = new Date().toISOString();
  } else {
    cache.recentThemes.push({
      theme,
      frequency: 1,
      lastSeen: new Date().toISOString(),
    });
  }

  // Sort by frequency and keep top 30
  cache.recentThemes.sort((a, b) => b.frequency - a.frequency);
  cache.recentThemes = cache.recentThemes.slice(0, 30);

  savePersonaCache(cache, actor);
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
 * Get context summary for persona (long-term themes and facts)
 */
export function getPersonaContext(): string {
  const cache = loadPersonaCache();

  const parts: string[] = [];

  if (Object.keys(cache.frequentFacts).length > 0) {
    const facts = Object.entries(cache.frequentFacts)
      .map(([key, val]) => `${key}: ${JSON.stringify(val)}`)
      .join(', ');
    parts.push(`Frequent facts: ${facts}`);
  }

  if (cache.recentThemes.length > 0) {
    const themes = cache.recentThemes
      .slice(0, 5)
      .map(t => `${t.theme} (${t.frequency}x)`)
      .join(', ');
    parts.push(`Recent themes: ${themes}`);
  }

  if (cache.quirks.length > 0) {
    parts.push(`Quirks: ${cache.quirks.join(', ')}`);
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
