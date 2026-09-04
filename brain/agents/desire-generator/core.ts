/**
 * Desire Generator Agent — Core Logic
 *
 * Synthesizes desires from multiple sources:
 * - Persona goals (highest priority)
 * - Urgent tasks
 * - Regular tasks
 * - Memory patterns
 * - Curiosity questions
 * - Reflections
 * - Dreams
 *
 * Uses LLM to identify genuine desires that the system wants to act on.
 *
 * This module provides:
 * - generateDesiresForUser() for single-user processing
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 *
 * MULTI-USER: Processes only logged-in users (active sessions) with isolated contexts.
 */

import fs from 'node:fs/promises';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  audit,
  acquireLock,
  cognitiveGraphPath,
  getFirstFailedNode,
  getTargetUser,
  withUserContext,
  submitInnerReflection,
  loadPersonaCore,
  listActiveTasks,
  listEpisodicFiles,
  getActiveBackend,
  loadGraphFile,
  proposeGoalFromDesire,
  requireGraphNodeOutput,
  runGraph,
  GOAL_PROPOSAL_THRESHOLDS,
  loadTrustLevel,
  curiosityQuestionStore,
  getUserContext,
  type CachedGraphEntry,
} from '@metahuman/core';

import {
  type Desire,
  type DesireSource,
  type DesireCandidate,
  type DesireGeneratorInputs,
  type PersonaGoal,
  type TaskSummary,
  type MemorySummary,
  type CuriosityQuestion,
  type ReflectionSummary,
  type DreamSummary,
  type DesireSummary,
  generateDesireId,
  initializeDesireMetrics,
  applyDecay,
  applyReinforcement,
  isAboveThreshold,
  calculateEffectiveStrength,
} from '@metahuman/core';

import {
  loadConfig,
  isAgencyEnabled,
  getEnabledSources,
} from '@metahuman/core';

import {
  saveDesire,
  moveDesire,
  listPendingDesires,
  listActiveDesires,
  listNascentDesires,
  listDesiresByStatus,
  incrementMetric,
  initializeAgencyStorage,
} from '@metahuman/core';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

const LOG_PREFIX = '[desire-generator]';
const GRAPH_FILE = 'desire-generator.json';
const graphCache: Record<string, CachedGraphEntry | null> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface DesireGeneratorOptions {
  username?: string;
  signal?: AbortSignal;
}


export interface DesireGeneratorResult {
  success: boolean;
  usersProcessed: number;
  totalGenerated: number;
  errors: string[];
  stats: Record<string, number>;
}

// ============================================================================
// Input Gathering
// ============================================================================

/**
 * Load persona goals from core.json
 */
export async function loadPersonaGoals(): Promise<PersonaGoal[]> {
    const persona = await loadPersonaCore();
    if (!persona?.goals) return [];

    const goals: PersonaGoal[] = [];

    // Process each goal category
    const categories: Array<{ key: 'shortTerm' | 'midTerm' | 'longTerm'; priority: 'short' | 'mid' | 'long' }> = [
      { key: 'shortTerm', priority: 'short' },
      { key: 'midTerm', priority: 'mid' },
      { key: 'longTerm', priority: 'long' },
    ];

    for (const { key, priority } of categories) {
      const categoryGoals = persona.goals[key];
      if (Array.isArray(categoryGoals)) {
        for (const g of categoryGoals) {
          if (g.status === 'active' || g.status === 'planning') {
            goals.push({
              id: `goal-${priority}-${goals.length}`,
              goal: g.goal,
              status: g.status,
              priority,
            });
          }
        }
      }
    }

    return goals;
}

/**
 * Load active tasks, separating urgent from regular
 */
export async function loadTasks(): Promise<{ urgent: TaskSummary[]; regular: TaskSummary[] }> {
    const tasks = await listActiveTasks();

    const urgent: TaskSummary[] = [];
    const regular: TaskSummary[] = [];

    for (const task of tasks) {
      const summary: TaskSummary = {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        tags: task.tags,
      };

      if (task.priority === 'P0' || task.priority === 'P1') {
        urgent.push(summary);
      } else {
        regular.push(summary);
      }
    }

    return { urgent, regular };
}

/**
 * Load recent memories (last 7 days)
 */
interface EpisodicDocument extends Record<string, unknown> {
  __file: string;
}

async function loadEpisodicDocuments(): Promise<EpisodicDocument[]> {
  return Promise.all(listEpisodicFiles().map(async file => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch (error) {
      throw new Error(`Invalid episodic memory JSON at ${file}: ${(error as Error).message}`);
    }
    if (!isRecord(parsed)) throw new Error(`Episodic memory must be an object: ${file}`);
    return { ...parsed, __file: file };
  }));
}

export async function loadRecentMemories(days: number = 7): Promise<MemorySummary[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const documents = await loadEpisodicDocuments();
  return documents.flatMap(document => {
    if (['inner_dialogue', 'reflection', 'dream'].includes(String(document.type))) return [];
    const timestamp = typeof document.timestamp === 'string' ? Date.parse(document.timestamp) : NaN;
    if (!Number.isFinite(timestamp) || timestamp < cutoff) return [];
    return [{
      id: typeof document.id === 'string' ? document.id : document.__file.split('/').pop()!,
      content: typeof document.content === 'string' ? document.content.substring(0, 500) : '',
      type: typeof document.type === 'string' ? document.type : 'unknown',
      timestamp: document.timestamp as string,
      tags: Array.isArray(document.tags) ? document.tags.filter(tag => typeof tag === 'string') : [],
    }];
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 50);
}

/**
 * Detect patterns in memories based on recurring tags and themes.
 * Analyzes tag frequency and co-occurrences to identify patterns.
 */
export function detectMemoryPatterns(memories: MemorySummary[]): import('@metahuman/core').MemoryPattern[] {
  if (memories.length < 3) {
    // Not enough memories to detect meaningful patterns
    return [];
  }

  // Tags to exclude from pattern detection (too generic or system-level)
  const excludedTags = new Set([
    'processed', 'unprocessed', 'system', 'meta', 'test',
    'conversation', 'observation', 'episodic', 'memory',
  ]);

  // Count tag frequencies and track which memories contain each tag
  const tagFrequency = new Map<string, { count: number; memoryIds: string[] }>();

  for (const memory of memories) {
    const tags = memory.tags || [];
    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase().trim();
      if (excludedTags.has(normalizedTag) || normalizedTag.length < 2) {
        continue;
      }

      const existing = tagFrequency.get(normalizedTag);
      if (existing) {
        existing.count++;
        existing.memoryIds.push(memory.id);
      } else {
        tagFrequency.set(normalizedTag, { count: 1, memoryIds: [memory.id] });
      }
    }
  }

  // Track tag co-occurrences (tags that appear together)
  const coOccurrences = new Map<string, { count: number; memoryIds: string[] }>();

  for (const memory of memories) {
    const tags = (memory.tags || [])
      .map(t => t.toLowerCase().trim())
      .filter(t => !excludedTags.has(t) && t.length >= 2);

    // Generate pairs of co-occurring tags
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        // Sort alphabetically to ensure consistent key
        const pair = [tags[i], tags[j]].sort().join(' + ');
        const existing = coOccurrences.get(pair);
        if (existing) {
          existing.count++;
          if (!existing.memoryIds.includes(memory.id)) {
            existing.memoryIds.push(memory.id);
          }
        } else {
          coOccurrences.set(pair, { count: 1, memoryIds: [memory.id] });
        }
      }
    }
  }

  const patterns: import('@metahuman/core').MemoryPattern[] = [];
  let patternIndex = 0;

  // Pattern 1: High-frequency single tags (appears in 3+ memories)
  const frequentTags = [...tagFrequency.entries()]
    .filter(([_, data]) => data.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  for (const [tag, data] of frequentTags) {
    patterns.push({
      id: `pattern-tag-${patternIndex++}`,
      description: `Recurring theme: "${tag}" appears frequently (${data.count} times)`,
      frequency: data.count,
      relatedMemoryIds: data.memoryIds.slice(0, 10),
    });
  }

  // Pattern 2: Significant co-occurrences (pairs appearing 2+ times)
  const frequentPairs = [...coOccurrences.entries()]
    .filter(([_, data]) => data.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  for (const [pair, data] of frequentPairs) {
    patterns.push({
      id: `pattern-pair-${patternIndex++}`,
      description: `Connected themes: "${pair}" appear together (${data.count} times)`,
      frequency: data.count,
      relatedMemoryIds: data.memoryIds.slice(0, 10),
    });
  }

  // Pattern 3: Time-based patterns (morning/afternoon/evening clustering)
  const timePatterns = detectTimePatterns(memories, tagFrequency);
  patterns.push(...timePatterns.map((tp, idx) => ({
    id: `pattern-time-${idx}`,
    description: tp.description,
    frequency: tp.frequency,
    relatedMemoryIds: tp.memoryIds,
  })));

  console.log(`${LOG_PREFIX} Detected ${patterns.length} memory patterns`);
  return patterns.slice(0, 10); // Limit to 10 patterns
}

/**
 * Detect time-based patterns (tags that cluster at certain times of day)
 */
function detectTimePatterns(
  memories: MemorySummary[],
  tagFrequency: Map<string, { count: number; memoryIds: string[] }>
): Array<{ description: string; frequency: number; memoryIds: string[] }> {
  const timeSlots = {
    morning: { start: 5, end: 12, tags: new Map<string, string[]>() },
    afternoon: { start: 12, end: 17, tags: new Map<string, string[]>() },
    evening: { start: 17, end: 22, tags: new Map<string, string[]>() },
    night: { start: 22, end: 5, tags: new Map<string, string[]>() },
  };

  // Categorize memories by time slot
  for (const memory of memories) {
    const hour = new Date(memory.timestamp).getHours();
    let slot: keyof typeof timeSlots;

    if (hour >= 5 && hour < 12) slot = 'morning';
    else if (hour >= 12 && hour < 17) slot = 'afternoon';
    else if (hour >= 17 && hour < 22) slot = 'evening';
    else slot = 'night';

    const tags = memory.tags || [];
    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase().trim();
      if (normalizedTag.length < 2) continue;

      const existing = timeSlots[slot].tags.get(normalizedTag);
      if (existing) {
        existing.push(memory.id);
      } else {
        timeSlots[slot].tags.set(normalizedTag, [memory.id]);
      }
    }
  }

  const patterns: Array<{ description: string; frequency: number; memoryIds: string[] }> = [];

  // Find tags that cluster significantly in one time slot
  for (const [slotName, slotData] of Object.entries(timeSlots)) {
    for (const [tag, memoryIds] of slotData.tags.entries()) {
      const totalCount = tagFrequency.get(tag)?.count || 0;
      const slotCount = memoryIds.length;

      // If 70%+ of a tag's occurrences are in one time slot (min 3 occurrences)
      if (totalCount >= 3 && slotCount / totalCount >= 0.7) {
        patterns.push({
          description: `"${tag}" tends to occur in the ${slotName} (${slotCount}/${totalCount} times)`,
          frequency: slotCount,
          memoryIds: memoryIds.slice(0, 10),
        });
      }
    }
  }

  return patterns.slice(0, 3); // Limit time patterns
}

/**
 * Load pending curiosity questions
 */
export async function loadCuriosityQuestions(): Promise<CuriosityQuestion[]> {
  const username = getUserContext()?.username;
  if (!username) throw new Error('Curiosity desire input requires an authenticated user context');
  return (await curiosityQuestionStore.listPending(username)).map(record => ({
    id: record.id,
    question: record.question,
    askedAt: record.askedAt,
  }));
}

/**
 * Load recent reflections
 */
export async function loadReflections(count: number = 5): Promise<ReflectionSummary[]> {
  const documents = await loadEpisodicDocuments();
  return documents.flatMap(document => {
    const tags = Array.isArray(document.tags)
      ? document.tags.filter(tag => typeof tag === 'string') as string[]
      : [];
    if (document.type !== 'inner_dialogue' || !tags.includes('idle-thought')) return [];
    if (typeof document.timestamp !== 'string' || !Number.isFinite(Date.parse(document.timestamp))) {
      throw new Error(`Reflection has no valid timestamp: ${document.__file}`);
    }
    return [{
      id: typeof document.id === 'string' ? document.id : document.__file.split('/').pop()!,
      content: typeof document.content === 'string' ? document.content.substring(0, 500) : '',
      timestamp: document.timestamp,
      tags,
    }];
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, count);
}

/**
 * Load recent dreams
 */
export async function loadDreams(count: number = 3): Promise<DreamSummary[]> {
  const documents = await loadEpisodicDocuments();
  return documents.flatMap(document => {
    if (document.type !== 'dream') return [];
    if (typeof document.timestamp !== 'string' || !Number.isFinite(Date.parse(document.timestamp))) {
      throw new Error(`Dream has no valid timestamp: ${document.__file}`);
    }
    const tags = Array.isArray(document.tags)
      ? document.tags.filter(tag => typeof tag === 'string') as string[]
      : [];
    return [{
      id: typeof document.id === 'string' ? document.id : document.__file.split('/').pop()!,
      content: typeof document.content === 'string' ? document.content.substring(0, 500) : '',
      timestamp: document.timestamp,
      themes: tags.filter(tag => !['dream', 'sleep'].includes(tag)),
    }];
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, count);
}

/**
 * Load existing desires for duplicate checking
 */
async function loadExistingDesires(): Promise<{
  active: DesireSummary[];
  rejected: DesireSummary[];
}> {
    const active = await listActiveDesires();
    const pending = await listPendingDesires();
    const nascent = await listNascentDesires();
    const rejected = await listDesiresByStatus('rejected');

    const activeSummaries: DesireSummary[] = [...active, ...pending, ...nascent].map(d => ({
      id: d.id,
      title: d.title,
      source: d.source,
      status: d.status,
      strength: d.strength,
    }));

    const rejectedSummaries: DesireSummary[] = rejected.slice(0, 20).map(d => ({
      id: d.id,
      title: d.title,
      source: d.source,
      status: d.status,
      strength: d.strength,
    }));

    return { active: activeSummaries, rejected: rejectedSummaries };
}

/**
 * Gather all inputs for desire generation
 */
export async function gatherInputs(enabledSources: DesireSource[]): Promise<DesireGeneratorInputs> {
  console.log(`${LOG_PREFIX} Gathering inputs from enabled sources:`, enabledSources);

  const [
    personaGoals,
    tasks,
    recentMemories,
    curiosityQuestions,
    reflections,
    dreams,
    existingDesires,
  ] = await Promise.all([
    enabledSources.includes('persona_goal') ? loadPersonaGoals() : Promise.resolve([]),
    enabledSources.includes('urgent_task') || enabledSources.includes('task')
      ? loadTasks()
      : Promise.resolve({ urgent: [], regular: [] }),
    enabledSources.includes('memory_pattern') ? loadRecentMemories(7) : Promise.resolve([]),
    enabledSources.includes('curiosity') ? loadCuriosityQuestions() : Promise.resolve([]),
    enabledSources.includes('reflection') ? loadReflections(5) : Promise.resolve([]),
    enabledSources.includes('dream') ? loadDreams(3) : Promise.resolve([]),
    loadExistingDesires(),
  ]);

  // Detect patterns from loaded memories
  const memoryPatterns = enabledSources.includes('memory_pattern')
    ? detectMemoryPatterns(recentMemories)
    : [];

  return {
    personaGoals,
    urgentTasks: tasks.urgent,
    activeTasks: tasks.regular,
    recentMemories,
    memoryPatterns,
    pendingCuriosityQuestions: curiosityQuestions,
    recentReflections: reflections,
    recentDreams: dreams,
    currentTrustLevel: loadTrustLevel(),
    recentlyRejected: existingDesires.rejected,
    activeDesires: existingDesires.active,
  };
}

async function runDesireGenerationGraph(
  operation: 'generate' | 'reinforce',
  inputs: DesireGeneratorInputs,
  existingDesires: Desire[] = [],
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const target = getTargetUser()
  if (!target) throw new Error('Desire Generator graph requires an authenticated user context')
  const loaded = await loadGraphFile(cognitiveGraphPath(GRAPH_FILE), {
    cache: graphCache,
    cacheKey: GRAPH_FILE,
    logPrefix: LOG_PREFIX,
  })
  if (!loaded) throw new Error(`Desire Generator graph ${GRAPH_FILE} could not be loaded`)
  const graphState = await runGraph({
    graph: loaded.graph,
    signal,
    context: {
      username: target.username,
      userId: target.userId,
      cognitiveMode: 'agent',
      desireGeneratorInput: { operation, inputs, existingDesires },
      abortSignal: signal,
    },
  })
  if (graphState.status !== 'completed') {
    const failed = getFirstFailedNode(graphState)
    throw new Error(failed
      ? `Desire Generator graph failed at ${failed.nodeId}: ${failed.error}`
      : `Desire Generator graph ended with status ${graphState.status}`)
  }
  return requireGraphNodeOutput(graphState, 'desire_generation')
}

export async function identifyDesires(
  inputs: DesireGeneratorInputs,
  signal?: AbortSignal,
): Promise<DesireCandidate[]> {
  const output = await runDesireGenerationGraph('generate', inputs, [], signal)
  if (!Array.isArray(output.candidates)) {
    throw new Error('Desire Generator graph returned invalid candidates')
  }
  return output.candidates as DesireCandidate[]
}

// ============================================================================
// Desire Creation
// ============================================================================

/**
 * Convert candidate to full desire object.
 * New desires start with LOW initial strength and grow through reinforcement.
 */
function createDesire(candidate: DesireCandidate, config: Awaited<ReturnType<typeof loadConfig>>): Desire {
  const now = new Date().toISOString();
  const sourceConfig = config.sources[candidate.source];
  if (!sourceConfig?.enabled) {
    throw new Error(`Desire source '${candidate.source}' is not enabled in Agency configuration`);
  }
  const sourceWeight = sourceConfig.weight;

  // Calculate initial strength based on source weight:
  // - Base strength from config (0.15 default)
  // - Source weight adds up to 0.5 boost for highest-priority sources
  // - This allows persona_goals (weight 1.0) to start at 0.65, one reinforcement from activation
  // - Low-priority sources (dreams, weight 0.3) start at 0.30, needing more reinforcement
  const baseStrength = config.thresholds.decay.initialStrength;
  const sourceBoost = sourceWeight * 0.5;
  const initialStrength = Math.min(0.80, baseStrength + sourceBoost);

  return {
    id: generateDesireId(),
    title: candidate.title,
    description: candidate.description,
    reason: candidate.reason,
    source: candidate.source,
    sourceId: candidate.sourceId,
    strength: initialStrength,  // Start small!
    baseWeight: sourceWeight,
    threshold: config.thresholds.activation,
    decayRate: config.thresholds.decay.ratePerRun,
    lastReviewedAt: now,
    reinforcements: 0,
    runCount: 1,  // First run
    risk: candidate.risk,
    requiredTrustLevel: candidate.risk === 'none' || candidate.risk === 'low'
      ? 'suggest'
      : candidate.risk === 'medium'
        ? 'supervised_auto'
        : 'bounded_auto',
    status: 'nascent',
    createdAt: now,
    updatedAt: now,
    tags: [candidate.source, candidate.risk],
    metrics: initializeDesireMetrics(),
  };
}

/**
 * Check if a candidate is too similar to existing desires
 */
function isDuplicate(candidate: DesireCandidate, existing: DesireSummary[]): boolean {
  const candidateTitle = candidate.title.toLowerCase();

  for (const desire of existing) {
    const existingTitle = desire.title.toLowerCase();

    // Simple similarity check - could be enhanced with embeddings
    if (
      candidateTitle === existingTitle ||
      candidateTitle.includes(existingTitle) ||
      existingTitle.includes(candidateTitle)
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Desire Nurturing System (Run-Based)
// ============================================================================

/**
 * Use LLM to identify which existing desires are reinforced by current inputs.
 * Returns a map of desire ID -> reinforcement reasons.
 */
async function identifyReinforcedDesires(
  existingDesires: Desire[],
  inputs: DesireGeneratorInputs,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const output = await runDesireGenerationGraph('reinforce', inputs, existingDesires, signal)
  if (!Array.isArray(output.reinforcements)) {
    throw new Error('Desire Generator graph returned invalid reinforcements')
  }
  const result = new Map<string, string>()
  for (const item of output.reinforcements) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || typeof item.reason !== 'string') {
      throw new Error('Desire Generator graph returned an invalid reinforcement')
    }
    result.set(item.id, item.reason)
  }
  return result
}

/**
 * Nurture existing desires: apply decay to unreinforced, boost reinforced.
 * This is the heart of the run-based desire system.
 */
async function nurtureExistingDesires(
  username: string,
  inputs: DesireGeneratorInputs,
  config: Awaited<ReturnType<typeof loadConfig>>,
  signal?: AbortSignal,
): Promise<{ reinforced: number; decayed: number; abandoned: number; goalsProposed: number }> {
  // Load ALL nascent and pending desires
  const nascentDesires = await listNascentDesires(username);
  const pendingDesires = await listPendingDesires(username);
  const allDesires = [...nascentDesires, ...pendingDesires];

  if (allDesires.length === 0) {
    console.log(`${LOG_PREFIX} No existing desires to nurture`);
    return { reinforced: 0, decayed: 0, abandoned: 0, goalsProposed: 0 };
  }

  console.log(`${LOG_PREFIX} Nurturing ${allDesires.length} existing desires...`);

  // Use LLM to identify which desires are reinforced
  const reinforcements = await identifyReinforcedDesires(allDesires, inputs, signal);

  const now = new Date().toISOString();
  let reinforced = 0;
  let decayed = 0;
  let abandoned = 0;
  let goalsProposed = 0;

  for (const desire of allDesires) {
    const isReinforced = reinforcements.has(desire.id);

    if (isReinforced) {
      // Reinforce: boost strength
      const newStrength = applyReinforcement(desire.strength, config.thresholds.decay.reinforcementBoost);
      desire.strength = newStrength;
      desire.reinforcements += 1;
      desire.updatedAt = now;
      desire.lastReviewedAt = now;
      desire.runCount = (desire.runCount || 0) + 1;

      console.log(`${LOG_PREFIX} ✓ Reinforced "${desire.title}" → ${newStrength.toFixed(2)} (${desire.reinforcements} times)`);
      reinforced++;

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_reinforced',
        actor: 'desire-generator',
        details: {
          desireId: desire.id,
          title: desire.title,
          newStrength,
          reinforcements: desire.reinforcements,
          reason: reinforcements.get(desire.id),
          username,
        },
      });

      // =========================================================================
      // Goal-Task-Desire Integration: Strong Desire → Goal Proposal
      // When a desire reaches high strength (>0.9) with 5+ reinforcements,
      // it represents a genuine, persistent want that should become a goal.
      // =========================================================================
      if (
        newStrength >= GOAL_PROPOSAL_THRESHOLDS.minStrength &&
        desire.reinforcements >= GOAL_PROPOSAL_THRESHOLDS.minReinforcements
      ) {
        console.log(`${LOG_PREFIX} 🎯 Desire "${desire.title}" qualifies for goal promotion!`);

        const proposalResult = proposeGoalFromDesire({
          id: desire.id,
          title: desire.title,
          description: desire.description,
          reason: desire.reason,
          strength: newStrength,
          reinforcements: desire.reinforcements,
          source: desire.source,
        });

        if (proposalResult.proposed) {
          goalsProposed++;
          console.log(`${LOG_PREFIX} 🎯 ${proposalResult.message}`);

          audit({
            category: 'agent',
            level: 'info',
            event: 'goal_proposed_from_desire',
            actor: 'desire-generator',
            details: {
              desireId: desire.id,
              desireTitle: desire.title,
              goalId: proposalResult.goalId,
              strength: newStrength,
              reinforcements: desire.reinforcements,
              source: desire.source,
              username,
            },
          });
        } else {
          console.log(`${LOG_PREFIX}    (Not proposed: ${proposalResult.message})`);
        }
      }
    } else {
      // Decay: reduce strength
      const newStrength = applyDecay(
        desire.strength,
        config.thresholds.decay.ratePerRun,
        config.thresholds.decay.minStrength
      );

      desire.strength = newStrength;
      desire.updatedAt = now;
      desire.lastReviewedAt = now;
      desire.runCount = (desire.runCount || 0) + 1;

      // Check for abandonment
      if (newStrength <= config.thresholds.decay.minStrength) {
        desire.status = 'abandoned';
        desire.completedAt = now;
        abandoned++;
        console.log(`${LOG_PREFIX} ✗ Abandoned "${desire.title}" (decayed below minimum)`);

        audit({
          category: 'agent',
          level: 'info',
          event: 'desire_abandoned',
          actor: 'desire-generator',
          details: { desireId: desire.id, title: desire.title, finalStrength: newStrength, username },
        });
      } else {
        decayed++;
        console.log(`${LOG_PREFIX} ↓ Decayed "${desire.title}" → ${newStrength.toFixed(2)}`);
      }
    }

    // Save updated desire
    await saveDesire(desire, username);
  }

  console.log(`${LOG_PREFIX} Nurture complete: ${reinforced} reinforced, ${decayed} decayed, ${abandoned} abandoned, ${goalsProposed} goals proposed`);
  return { reinforced, decayed, abandoned, goalsProposed };
}

// ============================================================================
// Activation Checking (replaces desire-evaluator)
// ============================================================================

/**
 * Check if any desires have crossed the activation threshold.
 * Moves nascent desires to pending when they reach sufficient strength.
 */
async function checkActivations(
  username: string,
  config: Awaited<ReturnType<typeof loadConfig>>
): Promise<number> {
  const nascentDesires = await listNascentDesires(username);
  const pendingDesires = await listPendingDesires(username);
  const activeDesires = await listActiveDesires(username);

  const now = new Date().toISOString();
  let activated = 0;

  // Check limit
  const currentActive = activeDesires.length + pendingDesires.length;
  const maxActive = config.limits.maxActiveDesires;

  for (const desire of nascentDesires) {
    if (currentActive + activated >= maxActive) {
      console.log(`${LOG_PREFIX} Active desire limit reached (${maxActive})`);
      break;
    }

    // Check if above threshold
    if (isAboveThreshold(desire)) {
      const oldStatus = desire.status;
      desire.status = 'pending';
      desire.activatedAt = now;
      desire.updatedAt = now;
      activated++;

      // Move from nascent to pending
      await moveDesire(desire, oldStatus, 'pending', username);

      const effectiveStrength = calculateEffectiveStrength(desire.strength, desire.baseWeight);
      console.log(`${LOG_PREFIX} ⬆ Activated "${desire.title}" (effective: ${effectiveStrength.toFixed(2)}, threshold: ${desire.threshold})`);

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_activated',
        actor: 'desire-generator',
        details: {
          desireId: desire.id,
          title: desire.title,
          strength: desire.strength,
          effectiveStrength,
          threshold: desire.threshold,
          source: desire.source,
          reinforcements: desire.reinforcements,
          runCount: desire.runCount,
          username,
        },
      });
    }
  }

  if (activated > 0) {
    console.log(`${LOG_PREFIX} ${activated} desire(s) activated (crossed threshold)`);
  }

  return activated;
}

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * Generate desires for a single user
 */
export async function generateDesiresForUser(username: string, signal?: AbortSignal): Promise<number> {
  console.log(`${LOG_PREFIX} Processing user: ${username}`);

  // Check if agency is enabled
  const enabled = await isAgencyEnabled(username);
  if (!enabled) {
    console.log(`${LOG_PREFIX} Agency disabled for user ${username}`);
    return 0;
  }

  // Load config
  const config = await loadConfig(username);

  // Check limits
  const activeDesires = await listActiveDesires(username);
  const pendingDesires = await listPendingDesires(username);
  const nascentDesires = await listNascentDesires(username);
  const totalActive = activeDesires.length + pendingDesires.length + nascentDesires.length;

  if (totalActive >= config.limits.maxActiveDesires + config.limits.maxPendingDesires) {
    console.log(`${LOG_PREFIX} Desire limit reached (${totalActive}), skipping generation`);
    return 0;
  }

  // Initialize storage if needed
  await initializeAgencyStorage(username);

  // Get enabled sources
  const enabledSources = await getEnabledSources(username);
  if (enabledSources.length === 0) {
    console.log(`${LOG_PREFIX} No enabled sources`);
    return 0;
  }

  // Gather inputs
  const inputs = await gatherInputs(enabledSources);

  // Check if we have any inputs
  const hasInputs =
    inputs.personaGoals.length > 0 ||
    inputs.urgentTasks.length > 0 ||
    inputs.activeTasks.length > 0 ||
    inputs.recentMemories.length > 0 ||
    inputs.pendingCuriosityQuestions.length > 0 ||
    inputs.recentReflections.length > 0 ||
    inputs.recentDreams.length > 0;

  // =========================================================================
  // PHASE 1: Nurture existing desires (run-based decay/reinforcement)
  // =========================================================================
  // Even if no new inputs, we still apply decay to existing desires
  const nurtureResult = await nurtureExistingDesires(username, inputs, config, signal);

  // =========================================================================
  // PHASE 1.5: Check activations (desires that crossed threshold)
  // =========================================================================
  const activatedCount = await checkActivations(username, config);

  if (!hasInputs) {
    console.log(`${LOG_PREFIX} No inputs available for new desire generation`);
    // Still return nurture stats even if no new desires
    return nurtureResult.reinforced + activatedCount;
  }

  // =========================================================================
  // PHASE 2: Generate new desires (only if capacity available)
  // =========================================================================
  // Re-check limits after nurturing (some may have been abandoned)
  const updatedNascent = await listNascentDesires(username);
  const updatedPending = await listPendingDesires(username);
  const updatedTotal = activeDesires.length + updatedPending.length + updatedNascent.length;

  if (updatedTotal >= config.limits.maxActiveDesires + config.limits.maxPendingDesires) {
    console.log(`${LOG_PREFIX} Desire limit still reached (${updatedTotal}), skipping new generation`);
    return nurtureResult.reinforced;
  }

  // Identify NEW desires using LLM
  const candidates = await identifyDesires(inputs, signal);
  if (candidates.length === 0) {
    console.log(`${LOG_PREFIX} No new desires identified`);
    return nurtureResult.reinforced;
  }

  // Filter duplicates - include currently active desires (post-nurture)
  const existingSummaries = [
    ...inputs.activeDesires,
    ...inputs.recentlyRejected,
    ...updatedNascent.map(d => ({ id: d.id, title: d.title, source: d.source, status: d.status, strength: d.strength })),
    ...updatedPending.map(d => ({ id: d.id, title: d.title, source: d.source, status: d.status, strength: d.strength })),
  ];
  const uniqueCandidates = candidates.filter(c => !isDuplicate(c, existingSummaries));
  console.log(`${LOG_PREFIX} ${uniqueCandidates.length} unique candidates after deduplication`);

  // Create and save desires
  let created = 0;
  for (const candidate of uniqueCandidates) {
    const desire = createDesire(candidate, config);

    await saveDesire(desire, username);
    created++;

      console.log(`${LOG_PREFIX} Created desire: ${desire.title} (strength: ${desire.strength.toFixed(2)})`);

      // Audit
      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_generated',
        actor: 'desire-generator',
        details: {
          desireId: desire.id,
          title: desire.title,
          source: desire.source,
          strength: desire.strength,
          risk: desire.risk,
          username,
        },
      });
  }

  // Update metrics
  if (created > 0) {
    await incrementMetric('totalGenerated', created, username);
  }

  // Log to inner dialogue if enabled
  const anyActivity = created > 0 || nurtureResult.reinforced > 0 || activatedCount > 0 || nurtureResult.goalsProposed > 0 || nurtureResult.decayed > 0 || nurtureResult.abandoned > 0;

  if (config.logging.logToInnerDialogue) {
    const parts: string[] = [];

    // Report on nurtured desires
    if (nurtureResult.reinforced > 0) {
      parts.push(`✓ ${nurtureResult.reinforced} desire(s) grew stronger from recent experiences`);
    }
    if (nurtureResult.decayed > 0) {
      parts.push(`↓ ${nurtureResult.decayed} desire(s) faded slightly`);
    }
    if (nurtureResult.abandoned > 0) {
      parts.push(`✗ ${nurtureResult.abandoned} desire(s) faded away completely`);
    }
    if (activatedCount > 0) {
      parts.push(`⬆ ${activatedCount} desire(s) reached activation threshold!`);
    }
    if (nurtureResult.goalsProposed > 0) {
      parts.push(`🎯 ${nurtureResult.goalsProposed} desire(s) promoted to proposed goals!`);
    }
    if (!anyActivity) {
      parts.push(`No changes - system is content or waiting for new experiences`);
    }

    // Report on new desires
    if (created > 0) {
      const desireList = uniqueCandidates
        .slice(0, created)
        .map(c => `  • ${c.title} (${c.source})`)
        .join('\n');
      parts.push(`🌱 ${created} new seed desire(s) planted:\n${desireList}`);
    }

    const innerDialogue = `💭 Agency Review:\n\n${parts.join('\n')}\n\nDesires grow through repeated reinforcement from experiences and fade without it.`;

    // The admission graph owns both the rolling buffer entry and its matching
    // long-term memory; the agent only supplies semantic metadata.
    await submitInnerReflection(username, innerDialogue, {
      dialogueSource: 'agency-system',
      displayColor: '#10b981', // Emerald for agency
      type: 'desire_generation',
      tags: ['agency', 'desire-generation', 'inner'],
      agency: true,
      desiresGenerated: created,
      desiresReinforced: nurtureResult.reinforced,
      desiresDecayed: nurtureResult.decayed,
      desiresAbandoned: nurtureResult.abandoned,
      desiresActivated: activatedCount,
      goalsProposed: nurtureResult.goalsProposed,
      sources: [...new Set(uniqueCandidates.map(c => c.source))],
    });
  }

  return created + nurtureResult.reinforced + activatedCount;
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Run desire generator cycle (CLI usage)
 */
export async function runCycle(options: DesireGeneratorOptions = {}): Promise<DesireGeneratorResult> {
  const result: DesireGeneratorResult = {
    success: true,
    usersProcessed: 0,
    totalGenerated: 0,
    errors: [],
    stats: {},
  };

  try {
    // Log which backend is active
    try {
      const backend = getActiveBackend();
      console.log(`${LOG_PREFIX} Using LLM backend: ${backend}`);
    } catch {
      console.log(`${LOG_PREFIX} Using model router (backend auto-selected)`);
    }

    const user = getTargetUser({ username: options.username });

    if (!user) {
      result.success = false;
      result.errors.push('Desire generation requires an active or explicit profile');
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${user.username}`);

    const lock = acquireLock(`desire-generator:${user.username}`, { exitOnSignal: false });
    try {
      const created = await withUserContext(
        { userId: user.userId, username: user.username, role: user.role },
        async () => {
          if (options.signal?.aborted) throw options.signal.reason || new DOMException('Desire generation cancelled', 'AbortError');
          return generateDesiresForUser(user!.username, options.signal);
        }
      );

      result.stats[user.username] = created;
      result.totalGenerated += created;
      result.usersProcessed++;
    } catch (error) {
      result.success = false;
      const errorMsg = `Error processing ${user.username}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(`${LOG_PREFIX} ${errorMsg}`);
    } finally {
      lock.release();
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_generator_completed',
      message: 'Desire generator completed',
      actor: 'desire-generator',
      details: { totalGenerated: result.totalGenerated, usersProcessed: result.usersProcessed },
    });

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    return result;
  }
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const parsed = parseDesireGeneratorArgs(args);
  const options: DesireGeneratorOptions = {
    username: typeof opts.username === 'string' ? opts.username : parsed.username || ctx.username,
    signal: ctx.signal,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      totalGenerated: result.totalGenerated,
      stats: result.stats,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}

export function parseDesireGeneratorArgs(args: string[]): DesireGeneratorOptions {
  if (args.length === 0) return {};
  if (args.length !== 2 || args[0] !== '--username' || !args[1]?.trim()) {
    throw new Error('Desire Generator accepts only --username <profile>');
  }
  return { username: args[1].trim() };
}
