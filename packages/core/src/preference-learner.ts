/**
 * Preference Learner - Continual Learning System
 *
 * Learns and tracks user preferences from interactions.
 * Part of Phase 4: Continual Learning
 *
 * Features:
 * - Extract preferences from conversations and decisions
 * - Track confidence scores for each preference
 * - Allow user validation (confirm/reject learned preferences)
 * - Detect and resolve preference contradictions
 * - Apply learned preferences to decision-making
 */

import * as fs from 'fs';
import * as path from 'path';
import { storageClient } from './storage-client.js';
import { audit } from './audit.js';
import { listEpisodicFiles, type EpisodicEvent } from './memory.js';
import { safeWriteJSON } from './safe-file.js';
import { getUserContext } from './context.js';
import {
  cognitiveGraphPath,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
} from './graph-runtime.js';
import type { SvelteFlowGraph } from './cognitive-graph-schema.js';
import type {
  ExtractedPreference,
  PreferenceContradiction,
  PreferenceLearningOperation,
} from './nodes/persona/preference-learning.node.js';

// ============================================================================
// Types
// ============================================================================

export type PreferenceCategory =
  | 'communication' // How to communicate
  | 'decision' // How decisions are made
  | 'workflow' // Work patterns and habits
  | 'interaction' // How to interact with user
  | 'content' // Content preferences (topics, styles)
  | 'timing' // Time-related preferences
  | 'style' // Writing/response style
  | 'avoidance'; // Things to avoid

export interface LearnedPreference {
  id: string;
  category: PreferenceCategory;
  description: string;
  /** Specific behavior or pattern */
  behavior: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Number of supporting observations */
  evidenceCount: number;
  /** IDs of supporting events */
  evidenceIds: string[];
  /** User validation status */
  validationStatus: 'pending' | 'confirmed' | 'rejected' | 'modified';
  /** User's modification if they modified it */
  userModification?: string;
  /** When first learned */
  learnedAt: string;
  /** Last updated */
  updatedAt: string;
  /** Contradicting preferences (if any) */
  contradicts?: string[];
}

export interface PreferenceSnapshot {
  version: number;
  generatedAt: string;
  preferences: LearnedPreference[];
  stats: {
    total: number;
    confirmed: number;
    pending: number;
    rejected: number;
    averageConfidence: number;
  };
}

export interface ExtractionResult {
  preferences: LearnedPreference[];
  eventsProcessed: number;
  newPreferences: number;
  updatedPreferences: number;
}

export interface LearningOptions {
  /** Maximum events to process */
  maxEvents?: number;
  /** Only process events from last N days */
  daysBack?: number;
  /** Minimum confidence to keep a preference */
  minConfidence?: number;
  /** Categories to extract */
  categories?: PreferenceCategory[];
  username?: string;
  signal?: AbortSignal;
}

// ============================================================================
// Storage
// ============================================================================

function getPreferencesPath(): string {
  const stateResult = storageClient.resolvePath({
    category: 'state',
  });
  if (!stateResult.success || !stateResult.path) {
    throw new Error('Cannot resolve state path');
  }
  return path.join(stateResult.path, 'preferences');
}

function ensurePreferencesDir(): string {
  const dir = getPreferencesPath();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generatePreferenceId(): string {
  return `pref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadPreferences(): LearnedPreference[] {
  const dir = getPreferencesPath();
  const filepath = path.join(dir, 'learned-preferences.json');

  if (!fs.existsSync(filepath)) {
    return [];
  }

  const data = JSON.parse(fs.readFileSync(filepath, 'utf8')) as { preferences?: unknown };
  if (!Array.isArray(data.preferences)) {
    throw new Error(`Invalid preference store: ${filepath}`);
  }
  for (const [index, preference] of data.preferences.entries()) {
    if (!preference || typeof preference !== 'object' || Array.isArray(preference)) {
      throw new Error(`Invalid preference at index ${index}: ${filepath}`);
    }
    const candidate = preference as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.description !== 'string'
      || typeof candidate.behavior !== 'string'
      || !['pending', 'confirmed', 'rejected', 'modified'].includes(String(candidate.validationStatus))) {
      throw new Error(`Invalid preference at index ${index}: ${filepath}`);
    }
  }
  return data.preferences as LearnedPreference[];
}

function savePreferences(preferences: LearnedPreference[]): void {
  const dir = ensurePreferencesDir();
  const filepath = path.join(dir, 'learned-preferences.json');

  const snapshot: PreferenceSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    preferences,
    stats: calculateStats(preferences),
  };

  safeWriteJSON(filepath, snapshot);
}

function calculateStats(preferences: LearnedPreference[]): PreferenceSnapshot['stats'] {
  const confirmed = preferences.filter((p) => p.validationStatus === 'confirmed').length;
  const pending = preferences.filter((p) => p.validationStatus === 'pending').length;
  const rejected = preferences.filter((p) => p.validationStatus === 'rejected').length;
  const avgConfidence =
    preferences.length > 0
      ? preferences.reduce((sum, p) => sum + p.confidence, 0) / preferences.length
      : 0;

  return {
    total: preferences.length,
    confirmed,
    pending,
    rejected,
    averageConfidence: Math.round(avgConfidence * 100) / 100,
  };
}

// ============================================================================
// Event Loading
// ============================================================================

function loadRecentEvents(options: LearningOptions = {}): EpisodicEvent[] {
  const { maxEvents = 100, daysBack = 14 } = options;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const allFiles = listEpisodicFiles();
  const events: EpisodicEvent[] = [];

  for (const filepath of allFiles) {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const event = JSON.parse(content) as EpisodicEvent;

      // Only process conversations and observations
      if (event.type !== 'conversation' && event.type !== 'observation') {
        continue;
      }

      // Check date
      const eventDate = new Date(event.timestamp);
      if (eventDate < cutoffDate) {
        continue;
      }

      events.push({
        ...event,
        id: path.basename(filepath, '.json'),
      } as EpisodicEvent);

      if (events.length >= maxEvents) {
        break;
      }
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp (newest first)
  events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return events;
}

async function loadPreferenceGraph(): Promise<SvelteFlowGraph> {
  const loaded = await loadGraphFile(cognitiveGraphPath('preference-learning.json'), {
    cacheKey: 'preference-learning',
    logPrefix: '[preference-learner]',
  });
  if (!loaded) throw new Error('Preference learning graph is unavailable');
  return loaded.graph;
}

async function runPreferenceGraph(
  graph: SvelteFlowGraph,
  username: string,
  operation: PreferenceLearningOperation,
  input: {
    events?: EpisodicEvent[];
    categories?: PreferenceCategory[];
    preference1?: LearnedPreference;
    preference2?: LearnedPreference;
  },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const activeUser = getUserContext();
  if (!activeUser || (activeUser.username !== username && activeUser.activeProfile !== username)) {
    throw new Error(`Preference learning requires an authenticated context for ${username}`);
  }
  const state = await runGraph({
    graph,
    signal,
    context: {
      userId: activeUser.userId,
      username,
      preferenceOperation: operation,
      events: input.events,
      preferenceCategories: input.categories,
      preference1: input.preference1,
      preference2: input.preference2,
      cognitiveMode: 'agent',
      allowMemoryWrites: false,
      recordPersonaMemory: false,
      abortSignal: signal,
    },
  });
  if (state.status !== 'completed') {
    throw new Error(`Preference learning graph ended with status ${state.status}`);
  }
  return requireGraphNodeOutput(state, 'preference_learning');
}

async function extractPreferencesFromEvents(
  events: EpisodicEvent[],
  graph: SvelteFlowGraph,
  username: string,
  categories?: PreferenceCategory[],
  signal?: AbortSignal,
): Promise<ExtractedPreference[]> {
  if (events.length === 0) return [];
  const output = await runPreferenceGraph(
    graph,
    username,
    'extract',
    { events: events.slice(0, 20), categories },
    signal,
  );
  if (!Array.isArray(output.preferences)) {
    throw new Error('Preference learning graph returned no preferences array');
  }
  return output.preferences as ExtractedPreference[];
}

// ============================================================================
// Preference Merging
// ============================================================================

function findSimilarPreference(
  newPref: ExtractedPreference,
  existing: LearnedPreference[]
): LearnedPreference | null {
  // Look for preferences with similar descriptions
  for (const pref of existing) {
    if (pref.category !== newPref.category) continue;

    // Simple similarity check - could be improved with embeddings
    const descSimilar =
      pref.description.toLowerCase().includes(newPref.description.toLowerCase().slice(0, 30)) ||
      newPref.description.toLowerCase().includes(pref.description.toLowerCase().slice(0, 30));

    const behaviorSimilar =
      pref.behavior.toLowerCase().includes(newPref.behavior.toLowerCase().slice(0, 30)) ||
      newPref.behavior.toLowerCase().includes(pref.behavior.toLowerCase().slice(0, 30));

    if (descSimilar || behaviorSimilar) {
      return pref;
    }
  }

  return null;
}

function mergePreference(
  existing: LearnedPreference,
  newPref: ExtractedPreference,
  eventIds: string[]
): LearnedPreference {
  // Increase confidence with more evidence
  const newConfidence = Math.min(
    1.0,
    existing.confidence * 0.7 + newPref.confidence * 0.3 + 0.05
  );

  // Add new evidence
  const allEvidence = [...new Set([...existing.evidenceIds, ...eventIds])];

  return {
    ...existing,
    confidence: Math.round(newConfidence * 100) / 100,
    evidenceCount: allEvidence.length,
    evidenceIds: allEvidence.slice(-20), // Keep last 20 evidence IDs
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Contradiction Detection
// ============================================================================

async function checkContradiction(
  pref1: LearnedPreference,
  pref2: LearnedPreference,
  graph: SvelteFlowGraph,
  username: string,
  signal?: AbortSignal,
): Promise<PreferenceContradiction> {
  const output = await runPreferenceGraph(
    graph,
    username,
    'contradiction',
    { preference1: pref1, preference2: pref2 },
    signal,
  );
  const contradiction = output.contradiction;
  if (!contradiction || typeof contradiction !== 'object' || Array.isArray(contradiction)
    || typeof (contradiction as PreferenceContradiction).contradicts !== 'boolean') {
    throw new Error('Preference learning graph returned an invalid contradiction decision');
  }
  return contradiction as PreferenceContradiction;
}

async function detectContradictions(
  preferences: LearnedPreference[],
  graph: SvelteFlowGraph,
  username: string,
  signal?: AbortSignal,
): Promise<void> {
  // Only check pending/confirmed preferences
  const active = preferences.filter(
    (p) => p.validationStatus === 'pending' || p.validationStatus === 'confirmed'
  );

  // Check each pair
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const result = await checkContradiction(active[i], active[j], graph, username, signal);
      if (result.contradicts) {
        const iContradicts = active[i].contradicts || [];
        const jContradicts = active[j].contradicts || [];
        active[i].contradicts = iContradicts;
        active[j].contradicts = jContradicts;

        if (!iContradicts.includes(active[j].id)) {
          iContradicts.push(active[j].id);
        }
        if (!jContradicts.includes(active[i].id)) {
          jContradicts.push(active[i].id);
        }
      }
    }
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Extract and learn preferences from recent events.
 */
export async function learnPreferences(
  options: LearningOptions = {}
): Promise<ExtractionResult> {
  const { minConfidence = 0.5 } = options;
  const activeUser = getUserContext();
  const username = options.username?.trim() || activeUser?.activeProfile || activeUser?.username || '';
  if (!username) throw new Error('Preference learning requires an authenticated profile');

  const events = loadRecentEvents(options);
  const existingPrefs = loadPreferences();
  const graph = await loadPreferenceGraph();
  const extracted = await extractPreferencesFromEvents(
    events,
    graph,
    username,
    options.categories,
    options.signal,
  );

  let newCount = 0;
  let updatedCount = 0;

  const eventIds = events.map((e) => e.id).filter((id): id is string => !!id);

  for (const pref of extracted) {
    if (pref.confidence < minConfidence) continue;

    const similar = findSimilarPreference(pref, existingPrefs);

    if (similar) {
      // Update existing preference
      const idx = existingPrefs.findIndex((p) => p.id === similar.id);
      if (idx >= 0) {
        existingPrefs[idx] = mergePreference(similar, pref, eventIds);
        updatedCount++;
      }
    } else {
      // Create new preference
      const newPref: LearnedPreference = {
        id: generatePreferenceId(),
        category: pref.category,
        description: pref.description,
        behavior: pref.behavior,
        confidence: pref.confidence,
        evidenceCount: 1,
        evidenceIds: eventIds.slice(0, 5),
        validationStatus: 'pending',
        learnedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      existingPrefs.push(newPref);
      newCount++;
    }
  }

  // Decay confidence for preferences not seen recently
  const now = new Date();
  for (const pref of existingPrefs) {
    const lastUpdated = new Date(pref.updatedAt);
    const daysSince = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSince > 30 && pref.validationStatus !== 'confirmed') {
      // Decay unconfirmed preferences over time
      pref.confidence = Math.max(0.1, pref.confidence - 0.05);
    }
  }

  // Remove very low confidence preferences
  const filteredPrefs = existingPrefs.filter(
    (p) => p.confidence >= 0.1 || p.validationStatus === 'confirmed'
  );

  savePreferences(filteredPrefs);

  audit({
    category: 'action',
    level: 'info',
    event: 'preferences_learned',
    actor: 'preference-learner',
    details: {
      eventsProcessed: events.length,
      newPreferences: newCount,
      updatedPreferences: updatedCount,
      totalPreferences: filteredPrefs.length,
    },
  });

  return {
    preferences: filteredPrefs,
    eventsProcessed: events.length,
    newPreferences: newCount,
    updatedPreferences: updatedCount,
  };
}

/**
 * Get all learned preferences.
 */
export function getPreferences(
  status?: LearnedPreference['validationStatus']
): LearnedPreference[] {
  const prefs = loadPreferences();

  if (status) {
    return prefs.filter((p) => p.validationStatus === status);
  }

  return prefs.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get a specific preference.
 */
export function getPreference(id: string): LearnedPreference | null {
  const prefs = loadPreferences();
  return prefs.find((p) => p.id === id) || null;
}

/**
 * Confirm a learned preference.
 */
export function confirmPreference(id: string): boolean {
  const prefs = loadPreferences();
  const idx = prefs.findIndex((p) => p.id === id);

  if (idx < 0) return false;

  prefs[idx].validationStatus = 'confirmed';
  prefs[idx].confidence = Math.min(1.0, prefs[idx].confidence + 0.1);
  prefs[idx].updatedAt = new Date().toISOString();

  savePreferences(prefs);

  audit({
    category: 'data_change',
    level: 'info',
    event: 'preference_confirmed',
    actor: 'preference-learner',
    details: { preferenceId: id, description: prefs[idx].description },
  });

  return true;
}

/**
 * Reject a learned preference.
 */
export function rejectPreference(id: string): boolean {
  const prefs = loadPreferences();
  const idx = prefs.findIndex((p) => p.id === id);

  if (idx < 0) return false;

  prefs[idx].validationStatus = 'rejected';
  prefs[idx].updatedAt = new Date().toISOString();

  savePreferences(prefs);

  audit({
    category: 'data_change',
    level: 'info',
    event: 'preference_rejected',
    actor: 'preference-learner',
    details: { preferenceId: id, description: prefs[idx].description },
  });

  return true;
}

/**
 * Modify a learned preference.
 */
export function modifyPreference(
  id: string,
  modification: { behavior?: string; description?: string }
): boolean {
  const prefs = loadPreferences();
  const idx = prefs.findIndex((p) => p.id === id);

  if (idx < 0) return false;

  if (modification.behavior) {
    prefs[idx].userModification = modification.behavior;
    prefs[idx].behavior = modification.behavior;
  }
  if (modification.description) {
    prefs[idx].description = modification.description;
  }

  prefs[idx].validationStatus = 'modified';
  prefs[idx].confidence = 1.0; // User-modified = maximum confidence
  prefs[idx].updatedAt = new Date().toISOString();

  savePreferences(prefs);

  audit({
    category: 'data_change',
    level: 'info',
    event: 'preference_modified',
    actor: 'preference-learner',
    details: { preferenceId: id, modification },
  });

  return true;
}

/**
 * Get preference statistics.
 */
export function getPreferenceStats(): PreferenceSnapshot['stats'] {
  return calculateStats(loadPreferences());
}

/**
 * Get preferences by category.
 */
export function getPreferencesByCategory(): Record<PreferenceCategory, LearnedPreference[]> {
  const prefs = loadPreferences();
  const result: Record<PreferenceCategory, LearnedPreference[]> = {
    communication: [],
    decision: [],
    workflow: [],
    interaction: [],
    content: [],
    timing: [],
    style: [],
    avoidance: [],
  };

  for (const pref of prefs) {
    result[pref.category].push(pref);
  }

  return result;
}

/**
 * Get active preferences for decision-making.
 * Returns only confirmed or high-confidence pending preferences.
 */
export function getActivePreferences(): LearnedPreference[] {
  const prefs = loadPreferences();

  return prefs.filter(
    (p) =>
      p.validationStatus === 'confirmed' ||
      p.validationStatus === 'modified' ||
      (p.validationStatus === 'pending' && p.confidence >= 0.8)
  );
}

/**
 * Get preferences that the user has explicitly confirmed or modified.
 * Pending inferences must not be injected into persona-facing chat context.
 */
export function getConfirmedPreferences(): LearnedPreference[] {
  return loadPreferences().filter(
    preference => preference.validationStatus === 'confirmed' || preference.validationStatus === 'modified'
  );
}

/**
 * Find contradicting preferences.
 */
export async function findContradictions(options: { username?: string; signal?: AbortSignal } = {}): Promise<
  Array<{ pref1: LearnedPreference; pref2: LearnedPreference; explanation?: string }>
> {
  const activeUser = getUserContext();
  const username = options.username?.trim() || activeUser?.activeProfile || activeUser?.username || '';
  if (!username) throw new Error('Preference contradiction detection requires an authenticated profile');
  const prefs = loadPreferences();
  const graph = await loadPreferenceGraph();
  await detectContradictions(prefs, graph, username, options.signal);
  savePreferences(prefs);

  const contradictions: Array<{
    pref1: LearnedPreference;
    pref2: LearnedPreference;
    explanation?: string;
  }> = [];

  for (const pref of prefs) {
    if (pref.contradicts?.length) {
      for (const contradictId of pref.contradicts) {
        const other = prefs.find((p) => p.id === contradictId);
        if (other && !contradictions.some((c) => c.pref1.id === other.id && c.pref2.id === pref.id)) {
          contradictions.push({ pref1: pref, pref2: other });
        }
      }
    }
  }

  return contradictions;
}

/**
 * Clean up old rejected preferences.
 */
export function cleanupPreferences(daysOld = 30): number {
  const prefs = loadPreferences();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const before = prefs.length;
  const filtered = prefs.filter((p) => {
    if (p.validationStatus === 'rejected' && new Date(p.updatedAt) < cutoff) {
      return false;
    }
    return true;
  });

  savePreferences(filtered);
  return before - filtered.length;
}

// ============================================================================
// Export
// ============================================================================

export const preferenceLearner = {
  learnPreferences,
  getPreferences,
  getPreference,
  confirmPreference,
  rejectPreference,
  modifyPreference,
  getPreferenceStats,
  getPreferencesByCategory,
  getActivePreferences,
  findContradictions,
  cleanupPreferences,
};
