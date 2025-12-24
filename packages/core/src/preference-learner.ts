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
import { callLLM } from './model-router.js';
import { audit } from './audit.js';
import { listEpisodicFiles, type EpisodicEvent } from './memory.js';

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

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return data.preferences || [];
  } catch {
    return [];
  }
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

  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
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

// ============================================================================
// LLM Extraction
// ============================================================================

const EXTRACTION_PROMPT = `You are analyzing conversations and observations to extract user preferences.

Look for patterns in:
- Communication style preferences (formal/casual, brevity, humor)
- Decision-making patterns (quick decisions, thorough analysis, risk tolerance)
- Workflow preferences (batching tasks, immediate responses, async work)
- Interaction style (direct feedback, gentle suggestions, detailed explanations)
- Content preferences (topics of interest, writing style, format preferences)
- Timing preferences (response times, meeting preferences, focus hours)
- Style preferences (code style, documentation level, emoji usage)
- Avoidances (topics to avoid, patterns that frustrate)

For each preference:
1. Describe the preference clearly
2. Specify the concrete behavior
3. Rate confidence (0.0-1.0) based on evidence strength
4. Categorize appropriately

Only extract preferences with clear evidence. Be conservative.

Respond in JSON:
{
  "preferences": [
    {
      "category": "communication|decision|workflow|interaction|content|timing|style|avoidance",
      "description": "Brief description of the preference",
      "behavior": "Specific behavior or pattern to follow",
      "confidence": 0.75
    }
  ]
}

If no clear preferences found, respond: {"preferences": []}`;

interface ExtractedPreference {
  category: PreferenceCategory;
  description: string;
  behavior: string;
  confidence: number;
}

async function extractPreferencesFromEvents(
  events: EpisodicEvent[]
): Promise<ExtractedPreference[]> {
  if (events.length === 0) return [];

  // Build context from events
  const context = events
    .slice(0, 20)
    .map((e) => {
      const type = e.type || 'unknown';
      const content = e.content?.substring(0, 500) || '';
      return `[${type}] ${content}`;
    })
    .join('\n\n---\n\n');

  try {
    const response = await callLLM({
      role: 'curator',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        {
          role: 'user',
          content: `Analyze these events for user preferences:\n\n${context}`,
        },
      ],
      options: {
        temperature: 0.3,
        responseFormat: { type: 'json_object' },
      },
    });

    if (!response.success || !response.text) {
      return [];
    }

    const parsed = JSON.parse(response.text);
    return parsed.preferences || [];
  } catch (error) {
    console.warn('[preference-learner] Extraction failed:', (error as Error).message);
    return [];
  }
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

const CONTRADICTION_PROMPT = `You are checking if two preferences contradict each other.

Preference 1:
Category: {cat1}
Description: {desc1}
Behavior: {beh1}

Preference 2:
Category: {cat2}
Description: {desc2}
Behavior: {beh2}

Do these preferences contradict each other? Consider:
- Direct conflicts (e.g., "be brief" vs "provide detailed explanations")
- Implicit conflicts (e.g., "respond immediately" vs "batch communications")
- Partial conflicts (e.g., conflict only in certain contexts)

Respond in JSON:
{
  "contradicts": true|false,
  "explanation": "Brief explanation if they contradict"
}`;

async function checkContradiction(
  pref1: LearnedPreference,
  pref2: LearnedPreference
): Promise<{ contradicts: boolean; explanation?: string }> {
  try {
    const prompt = CONTRADICTION_PROMPT.replace('{cat1}', pref1.category)
      .replace('{desc1}', pref1.description)
      .replace('{beh1}', pref1.behavior)
      .replace('{cat2}', pref2.category)
      .replace('{desc2}', pref2.description)
      .replace('{beh2}', pref2.behavior);

    const response = await callLLM({
      role: 'curator',
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.1,
        responseFormat: { type: 'json_object' },
      },
    });

    if (!response.success || !response.text) {
      return { contradicts: false };
    }

    return JSON.parse(response.text);
  } catch {
    return { contradicts: false };
  }
}

async function detectContradictions(preferences: LearnedPreference[]): Promise<void> {
  // Only check pending/confirmed preferences
  const active = preferences.filter(
    (p) => p.validationStatus === 'pending' || p.validationStatus === 'confirmed'
  );

  // Check each pair
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const result = await checkContradiction(active[i], active[j]);
      if (result.contradicts) {
        active[i].contradicts = active[i].contradicts || [];
        active[j].contradicts = active[j].contradicts || [];

        if (!active[i].contradicts.includes(active[j].id)) {
          active[i].contradicts.push(active[j].id);
        }
        if (!active[j].contradicts.includes(active[i].id)) {
          active[j].contradicts.push(active[i].id);
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

  const events = loadRecentEvents(options);
  const existingPrefs = loadPreferences();
  const extracted = await extractPreferencesFromEvents(events);

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
 * Find contradicting preferences.
 */
export async function findContradictions(): Promise<
  Array<{ pref1: LearnedPreference; pref2: LearnedPreference; explanation?: string }>
> {
  const prefs = loadPreferences();
  await detectContradictions(prefs);
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
