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
import { createHash } from 'node:crypto';

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
  loadBufferForUser,
  submitDesireAgent,
  type ConversationMessage,
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
  type DesireReinforcementDecision,
  DESIRE_SOURCE_WEIGHTS,
  createDesireFromCandidate,
  hasDesireActivationCapacity,
  isDesireActivationEligible,
  calculateElapsedDecay,
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
  reinforceDesire,
  depreciateDesire,
  filterUnanalyzedGeneratorInputs,
  markGeneratorInputsAnalyzed,
} from '@metahuman/core';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

const LOG_PREFIX = '[desire-agent]';
const GRAPH_FILE = 'desire-generator.json';
const graphCache: Record<string, CachedGraphEntry | null> = {};
const MAX_USER_REQUESTS = 20;
const MAX_USER_REQUEST_CHARS = 1_000;

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

interface AgencyModelCallReport {
  operation: 'generate' | 'reinforce';
  cognitiveMode: string | null;
  role: string;
  provider: string;
  model: string;
  modelId: string;
  latencyMs?: number;
  tokens?: { prompt: number; completion: number; total: number };
}

interface AgencyStrengthChange {
  desireId: string;
  title: string;
  previousStrength: number;
  newStrength: number;
  change: number;
  reason: string;
  evidence?: DesireReinforcementDecision['evidence'];
}

interface AgencyActivation {
  desireId: string;
  title: string;
  strength: number;
  effectiveStrength: number;
  threshold: number;
}

interface AgencyGoalProposal {
  desireId: string;
  title: string;
  goalId: string;
}

interface AgencyCreatedDesire {
  desireId: string;
  title: string;
  source: DesireSource;
  sourceId?: string;
  strength: number;
  status: Desire['status'];
  reason: string;
}

interface NurtureResult {
  reinforced: AgencyStrengthChange[];
  decayed: AgencyStrengthChange[];
  archived: AgencyStrengthChange[];
  goalsProposed: AgencyGoalProposal[];
}

export interface AgencyReviewReport {
  reviewedAt: string;
  freshEvidenceCount: number;
  evidenceBySource: Record<string, number>;
  modelCalls: AgencyModelCallReport[];
  reinforced: AgencyStrengthChange[];
  decayed: AgencyStrengthChange[];
  archived: AgencyStrengthChange[];
  activated: AgencyActivation[];
  created: AgencyCreatedDesire[];
  goalsProposed: AgencyGoalProposal[];
  candidatesRejectedAsDuplicates: number;
  candidatesBlockedByCapacity: number;
  generationSkippedReason: string | null;
}

function auditCycleOutcome(result: DesireGeneratorResult, username?: string): void {
  const success = result.success
  audit({
    category: 'agent',
    level: success ? 'info' : 'error',
    event: success ? 'desire_agent_completed' : 'desire_agent_failed',
    message: success
      ? 'Desire Agent completed its review and admitted required lifecycle stages'
      : 'Desire Agent failed before completing its lifecycle review',
    actor: 'desire-agent',
    details: {
      username,
      totalGenerated: result.totalGenerated,
      usersProcessed: result.usersProcessed,
      errors: result.errors,
    },
  })
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
 * Convert the bounded canonical conversation buffer into stable Desire Agent
 * evidence. Reading happens only when the Desire Agent is intentionally run;
 * persisting a user message never invokes Desire work.
 */
export function selectRecentUserRequests(
  messages: ConversationMessage[],
  limit = MAX_USER_REQUESTS,
): DesireGeneratorInputs['userRequests'] {
  return messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'user' && message.content.trim().length > 0)
    .slice(-Math.max(1, limit))
    .map(({ message, index }) => {
      const content = message.content.trim().slice(0, MAX_USER_REQUEST_CHARS);
      const persistedId = isRecord(message.meta) && typeof message.meta.idempotencyKey === 'string'
        ? message.meta.idempotencyKey.trim()
        : '';
      const fallbackId = createHash('sha256')
        .update(`${index}\n${message.timestamp ?? ''}\n${content}`)
        .digest('hex')
        .slice(0, 24);
      const timestamp = typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
        ? new Date(message.timestamp).toISOString()
        : '1970-01-01T00:00:00.000Z';
      return {
        id: persistedId || `conversation:${fallbackId}`,
        content,
        timestamp,
      };
    });
}

export function loadRecentUserRequests(): DesireGeneratorInputs['userRequests'] {
  const username = getUserContext()?.username;
  if (!username) throw new Error('Conversation desire input requires an authenticated user context');
  return selectRecentUserRequests(loadBufferForUser(username, 'conversation').messages);
}

/**
 * Load existing desires for duplicate checking
 */
async function loadExistingDesires(): Promise<{
  active: DesireSummary[];
  rejected: DesireSummary[];
}> {
    const active = await listActiveDesires();
    const nascent = await listNascentDesires();
    const rejected = await listDesiresByStatus('rejected');

    const activeSummaries: DesireSummary[] = [...active, ...nascent].map(d => ({
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
    userRequests,
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
    enabledSources.includes('user_request') ? Promise.resolve(loadRecentUserRequests()) : Promise.resolve([]),
    loadExistingDesires(),
  ]);

  // Detect patterns from loaded memories
  const memoryPatterns = enabledSources.includes('memory_pattern')
    ? detectMemoryPatterns(recentMemories)
    : [];

  return {
    userRequests,
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

function readModelCallReport(
  output: Record<string, unknown>,
  operation: 'generate' | 'reinforce',
): AgencyModelCallReport | null {
  const report = output.modelCall
  if (report === undefined || report === null) return null
  if (!isRecord(report)
    || report.operation !== operation
    || (report.cognitiveMode !== null && typeof report.cognitiveMode !== 'string')
    || typeof report.role !== 'string'
    || typeof report.provider !== 'string'
    || typeof report.model !== 'string'
    || typeof report.modelId !== 'string') {
    throw new Error(`Desire Generator graph did not report its ${operation} model call`)
  }
  if (report.latencyMs !== undefined && typeof report.latencyMs !== 'number') {
    throw new Error(`Desire Generator graph reported invalid ${operation} latency`)
  }
  const tokens = report.tokens
  if (tokens !== undefined && (!isRecord(tokens)
    || typeof tokens.prompt !== 'number'
    || typeof tokens.completion !== 'number'
    || typeof tokens.total !== 'number')) {
    throw new Error(`Desire Generator graph reported invalid ${operation} token usage`)
  }
  return {
    operation,
    cognitiveMode: report.cognitiveMode,
    role: report.role,
    provider: report.provider,
    model: report.model,
    modelId: report.modelId,
    latencyMs: report.latencyMs as number | undefined,
    tokens: tokens as AgencyModelCallReport['tokens'],
  }
}

export async function identifyDesires(
  inputs: DesireGeneratorInputs,
  signal?: AbortSignal,
): Promise<{ candidates: DesireCandidate[]; modelCall: AgencyModelCallReport | null }> {
  const output = await runDesireGenerationGraph('generate', inputs, [], signal)
  if (!Array.isArray(output.candidates)) {
    throw new Error('Desire Generator graph returned invalid candidates')
  }
  return {
    candidates: output.candidates as DesireCandidate[],
    modelCall: readModelCallReport(output, 'generate'),
  }
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
): Promise<{
  reinforcements: Map<string, DesireReinforcementDecision>;
  modelCall: AgencyModelCallReport | null;
}> {
  const output = await runDesireGenerationGraph('reinforce', inputs, existingDesires, signal)
  if (!Array.isArray(output.reinforcements)) {
    throw new Error('Desire Generator graph returned invalid reinforcements')
  }
  const validDesireIds = new Set(existingDesires.map(desire => desire.id))
  const result = new Map<string, DesireReinforcementDecision>()
  for (const item of output.reinforcements) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !validDesireIds.has(item.id)
      || result.has(item.id) || typeof item.reason !== 'string' || !item.reason.trim()
      || !Array.isArray(item.evidenceIds) || item.evidenceIds.length === 0
      || item.evidenceIds.some((id: unknown) => typeof id !== 'string' || !id.trim())
      || !Array.isArray(item.evidence) || item.evidence.length === 0
      || item.evidence.some((evidence: unknown) => (
        !isRecord(evidence)
        || typeof evidence.source !== 'string'
        || !Object.hasOwn(DESIRE_SOURCE_WEIGHTS, evidence.source)
        || typeof evidence.sourceId !== 'string' || !evidence.sourceId.trim()
        || typeof evidence.summary !== 'string' || !evidence.summary.trim()
      ))) {
      throw new Error('Desire Generator graph returned an invalid reinforcement')
    }
    result.set(item.id, item as DesireReinforcementDecision)
  }
  return {
    reinforcements: result,
    modelCall: readModelCallReport(output, 'reinforce'),
  }
}

function inputEvidenceToken(prefix: string, item: { id: string }): string {
  const contentHash = createHash('sha256')
    .update(JSON.stringify(item))
    .digest('hex')
    .slice(0, 20)
  return `${prefix}:${item.id}:${contentHash}`
}

function inputEvidenceTokens(inputs: DesireGeneratorInputs): string[] {
  return [
    ...inputs.userRequests.map(item => inputEvidenceToken('user_request', item)),
    ...inputs.personaGoals.map(item => inputEvidenceToken('persona_goal', item)),
    ...inputs.urgentTasks.map(item => inputEvidenceToken('urgent_task', item)),
    ...inputs.activeTasks.map(item => inputEvidenceToken('task', item)),
    ...inputs.recentMemories.map(item => inputEvidenceToken('memory_pattern', item)),
    ...inputs.pendingCuriosityQuestions.map(item => inputEvidenceToken('curiosity', item)),
    ...inputs.recentReflections.map(item => inputEvidenceToken('reflection', item)),
    ...inputs.recentDreams.map(item => inputEvidenceToken('dream', item)),
  ].sort()
}

async function filterFreshGeneratorInputs(
  username: string,
  inputs: DesireGeneratorInputs,
): Promise<{ inputs: DesireGeneratorInputs; tokens: string[] }> {
  const allTokens = inputEvidenceTokens(inputs)
  const freshTokens = await filterUnanalyzedGeneratorInputs(allTokens, username)
  const fresh = new Set(freshTokens)
  const filter = <T extends { id: string }>(prefix: string, items: T[]): T[] =>
    items.filter(item => fresh.has(inputEvidenceToken(prefix, item)))
  const recentMemories = filter('memory_pattern', inputs.recentMemories)
  return {
    tokens: freshTokens,
    inputs: {
      ...inputs,
      userRequests: filter('user_request', inputs.userRequests),
      personaGoals: filter('persona_goal', inputs.personaGoals),
      urgentTasks: filter('urgent_task', inputs.urgentTasks),
      activeTasks: filter('task', inputs.activeTasks),
      recentMemories,
      memoryPatterns: detectMemoryPatterns(recentMemories),
      pendingCuriosityQuestions: filter('curiosity', inputs.pendingCuriosityQuestions),
      recentReflections: filter('reflection', inputs.recentReflections),
      recentDreams: filter('dream', inputs.recentDreams),
    },
  }
}

function reinforcementEvidenceFingerprint(decision: DesireReinforcementDecision): string {
  return createHash('sha256')
    .update(JSON.stringify([...decision.evidenceIds].sort()))
    .digest('hex')
    .slice(0, 24)
}

/**
 * Load the only Desire states governed by reinforcement and decay.
 */
async function loadNurturableDesires(username: string): Promise<Desire[]> {
  const [nascentDesires, pendingDesires] = await Promise.all([
    listNascentDesires(username),
    listPendingDesires(username),
  ])
  return [...nascentDesires, ...pendingDesires]
}

function projectedArchiveCount(
  desires: Desire[],
  reinforcements: Map<string, DesireReinforcementDecision>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  now: string,
): number {
  if (!config.thresholds.decay.enabled) return 0
  return desires.filter(desire => {
    if (reinforcements.has(desire.id)) return false
    const reduction = calculateElapsedDecay(
      desire.lastDecayAt || desire.lastReviewedAt || desire.updatedAt,
      now,
      desire.decayRate ?? config.thresholds.decay.ratePerDay,
    )
    return reduction > 0
      && Math.max(0, desire.strength - reduction) <= config.thresholds.decay.minStrength
  }).length
}

/**
 * Commit already-validated nurture decisions. No model work is allowed here:
 * a malformed generation or reinforcement response must fail before storage changes.
 */
async function applyNurtureDecisions(
  username: string,
  desires: Desire[],
  reinforcements: Map<string, DesireReinforcementDecision>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  now: string,
): Promise<NurtureResult> {
  if (desires.length === 0) {
    console.log(`${LOG_PREFIX} No existing desires to nurture`)
    return { reinforced: [], decayed: [], archived: [], goalsProposed: [] }
  }

  console.log(`${LOG_PREFIX} Nurturing ${desires.length} existing desires...`)
  const reinforced: AgencyStrengthChange[] = [];
  const decayed: AgencyStrengthChange[] = [];
  const archived: AgencyStrengthChange[] = [];
  const goalsProposed: AgencyGoalProposal[] = [];

  for (const desire of desires) {
    const decision = reinforcements.get(desire.id)

    if (decision) {
      const primaryEvidence = decision.evidence[0]
      if (!primaryEvidence) {
        throw new Error(`Reinforcement for desire ${desire.id} has no validated evidence`)
      }
      const evidenceFingerprint = reinforcementEvidenceFingerprint(decision)
      const updated = await reinforceDesire(desire.id, {
        boost: config.thresholds.decay.reinforcementBoost,
        reason: decision.reason,
        sourceInput: decision.evidenceIds.join(', '),
        evidence: {
          id: `generator:${desire.id}:${evidenceFingerprint}`,
          kind: 'reinforcement',
          source: primaryEvidence.source,
          sourceId: primaryEvidence.sourceId,
          summary: decision.reason,
          observedAt: now,
        },
      }, username);
      if (!updated || updated.metrics.reinforcementCount === (desire.metrics?.reinforcementCount || 0)) {
        continue;
      }
      const newStrength = updated.strength;

      console.log(`${LOG_PREFIX} ✓ Reinforced "${desire.title}" → ${newStrength.toFixed(2)} (${updated.reinforcements} times)`);
      reinforced.push({
        desireId: desire.id,
        title: desire.title,
        previousStrength: desire.strength,
        newStrength,
        change: newStrength - desire.strength,
        reason: decision.reason,
        evidence: decision.evidence,
      });

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_reinforced',
        actor: 'desire-agent',
        details: {
          desireId: desire.id,
          title: desire.title,
          newStrength,
          reinforcements: updated.reinforcements,
          reason: decision.reason,
          evidenceIds: decision.evidenceIds,
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
        updated.reinforcements >= GOAL_PROPOSAL_THRESHOLDS.minReinforcements
      ) {
        console.log(`${LOG_PREFIX} 🎯 Desire "${desire.title}" qualifies for goal promotion!`);

        const proposalResult = proposeGoalFromDesire({
          id: desire.id,
          title: desire.title,
          description: desire.description,
          reason: desire.reason,
          strength: newStrength,
          reinforcements: updated.reinforcements,
          source: desire.source,
        });

        if (proposalResult.proposed) {
          if (!proposalResult.goalId) {
            throw new Error(`Goal proposal for desire ${desire.id} did not return a goal ID`)
          }
          goalsProposed.push({
            desireId: desire.id,
            title: desire.title,
            goalId: proposalResult.goalId,
          });
          console.log(`${LOG_PREFIX} 🎯 ${proposalResult.message}`);

          audit({
            category: 'agent',
            level: 'info',
            event: 'goal_proposed_from_desire',
            actor: 'desire-agent',
            details: {
              desireId: desire.id,
              desireTitle: desire.title,
              goalId: proposalResult.goalId,
              strength: newStrength,
              reinforcements: updated.reinforcements,
              source: desire.source,
              username,
            },
          });
        } else {
          console.log(`${LOG_PREFIX}    (Not proposed: ${proposalResult.message})`);
        }
      }
    } else {
      if (!config.thresholds.decay.enabled) continue;
      const reduction = calculateElapsedDecay(
        desire.lastDecayAt || desire.lastReviewedAt || desire.updatedAt,
        now,
        desire.decayRate ?? config.thresholds.decay.ratePerDay,
      );
      if (reduction <= 0) continue;
      const finalStrength = Math.max(0, desire.strength - reduction);
      const shouldAbandon = finalStrength <= config.thresholds.decay.minStrength;
      const updated = await depreciateDesire(desire.id, {
        reduction,
        reason: `Elapsed-time decay through ${now}`,
        terminalStatus: shouldAbandon ? 'archived' : undefined,
      }, username);
      if (!updated) continue;

      if (shouldAbandon) {
        archived.push({
          desireId: desire.id,
          title: desire.title,
          previousStrength: desire.strength,
          newStrength: updated.strength,
          change: updated.strength - desire.strength,
          reason: `Elapsed-time decay through ${now} reduced strength to the archive threshold`,
        });
        console.log(`${LOG_PREFIX} 📦 Archived "${desire.title}" (decayed below minimum)`);

        audit({
          category: 'agent',
          level: 'info',
          event: 'desire_archived_after_decay',
          actor: 'desire-agent',
          details: { desireId: desire.id, title: desire.title, finalStrength: updated.strength, username },
        });
      } else {
        decayed.push({
          desireId: desire.id,
          title: desire.title,
          previousStrength: desire.strength,
          newStrength: updated.strength,
          change: updated.strength - desire.strength,
          reason: `No fresh reinforcing evidence; elapsed-time decay applied through ${now}`,
        });
        console.log(`${LOG_PREFIX} ↓ Decayed "${desire.title}" → ${updated.strength.toFixed(2)}`);
      }
    }
  }

  console.log(`${LOG_PREFIX} Nurture complete: ${reinforced.length} reinforced, ${decayed.length} decayed, ${archived.length} archived, ${goalsProposed.length} goals proposed`);
  if (archived.length > 0) await incrementMetric('totalAbandoned', archived.length, username)
  return { reinforced, decayed, archived, goalsProposed };
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
): Promise<AgencyActivation[]> {
  const nascentDesires = await listNascentDesires(username);
  const activeDesires = await listActiveDesires(username);

  const now = new Date().toISOString();
  const activated: AgencyActivation[] = [];

  // Check limit
  const currentActive = activeDesires.length;
  const maxActive = config.limits.maxActiveDesires;

  for (const desire of nascentDesires) {
    if (!hasDesireActivationCapacity(currentActive + activated.length, config)) {
      console.log(`${LOG_PREFIX} Active desire limit reached (${maxActive})`);
      break;
    }

    // Check if above threshold
    if (isDesireActivationEligible(desire)) {
      const oldStatus = desire.status;
      desire.status = 'pending';
      desire.currentStage = 'strengthening';
      desire.activatedAt = now;
      desire.updatedAt = now;
      // Move from nascent to pending
      await moveDesire(desire, oldStatus, 'pending', username);

      const effectiveStrength = calculateEffectiveStrength(desire.strength, desire.baseWeight);
      activated.push({
        desireId: desire.id,
        title: desire.title,
        strength: desire.strength,
        effectiveStrength,
        threshold: desire.threshold,
      });
      console.log(`${LOG_PREFIX} ⬆ Activated "${desire.title}" (effective: ${effectiveStrength.toFixed(2)}, threshold: ${desire.threshold})`);

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_activated',
        actor: 'desire-agent',
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

  if (activated.length > 0) {
    console.log(`${LOG_PREFIX} ${activated.length} desire(s) activated (crossed threshold)`);
  }

  return activated;
}

function countEvidenceBySource(inputs: DesireGeneratorInputs): Record<string, number> {
  return {
    'user requests': inputs.userRequests.length,
    'persona goals': inputs.personaGoals.length,
    'urgent tasks': inputs.urgentTasks.length,
    tasks: inputs.activeTasks.length,
    memories: inputs.recentMemories.length,
    'memory patterns': inputs.memoryPatterns.length,
    'curiosity questions': inputs.pendingCuriosityQuestions.length,
    reflections: inputs.recentReflections.length,
    dreams: inputs.recentDreams.length,
  }
}

function reportText(value: string, maxLength = 360): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

function reportStrength(value: number): string {
  return value.toFixed(4)
}

export function formatAgencyReview(report: AgencyReviewReport): string {
  const lines = [
    '💭 Agency Review',
    '',
    `Reviewed ${report.freshEvidenceCount} new evidence item(s) at ${report.reviewedAt}.`,
  ]
  const evidenceCounts = Object.entries(report.evidenceBySource)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${count} ${source}`)
  lines.push(evidenceCounts.length > 0
    ? `Evidence: ${evidenceCounts.join(', ')}.`
    : 'Evidence: none; no previously analyzed input was reconsidered.')

  lines.push('', `Model calls (${report.modelCalls.length}):`)
  if (report.modelCalls.length === 0) {
    lines.push('• None.')
  } else {
    for (const call of report.modelCalls) {
      const duration = call.latencyMs === undefined ? '' : `, ${(call.latencyMs / 1_000).toFixed(2)}s`
      const tokens = call.tokens ? `, ${call.tokens.total} tokens` : ''
      lines.push(`• ${call.operation === 'reinforce' ? 'Reinforcement review' : 'New-desire review'}: ${call.provider}/${call.model} (${call.cognitiveMode ?? 'default'} mode, ${call.role} role${duration}${tokens}).`)
    }
  }

  lines.push('', `Reinforced desires (${report.reinforced.length}):`)
  if (report.reinforced.length === 0) {
    lines.push('• None.')
  } else {
    for (const change of report.reinforced) {
      lines.push(`• ${change.title} [${change.desireId}]: ${reportStrength(change.previousStrength)} → ${reportStrength(change.newStrength)} (+${reportStrength(change.change)}).`)
      lines.push(`  Reason: ${reportText(change.reason)}`)
      for (const evidence of change.evidence ?? []) {
        lines.push(`  Evidence (${evidence.source}:${evidence.sourceId}): ${reportText(evidence.summary)}`)
      }
    }
  }

  lines.push('', `Elapsed-time decay (${report.decayed.length}):`)
  if (report.decayed.length === 0) {
    lines.push('• None.')
  } else {
    for (const change of report.decayed) {
      lines.push(`• ${change.title} [${change.desireId}]: ${reportStrength(change.previousStrength)} → ${reportStrength(change.newStrength)} (${reportStrength(change.change)}); no fresh reinforcing evidence.`)
    }
  }

  lines.push('', `Archived after decay (${report.archived.length}):`)
  if (report.archived.length === 0) {
    lines.push('• None.')
  } else {
    for (const change of report.archived) {
      lines.push(`• ${change.title} [${change.desireId}]: ${reportStrength(change.previousStrength)} → ${reportStrength(change.newStrength)}; reached the archive threshold.`)
    }
  }

  lines.push('', `New desires created (${report.created.length}):`)
  if (report.created.length === 0) {
    lines.push('• None.')
  } else {
    for (const desire of report.created) {
      lines.push(`• ${desire.title} [${desire.desireId}]: strength ${reportStrength(desire.strength)}, status ${desire.status}, source ${desire.source}:${desire.sourceId ?? 'unknown'}.`)
      lines.push(`  Reason: ${reportText(desire.reason)}`)
    }
  }

  lines.push(
    '',
    `Lifecycle results: ${report.activated.length} activated; ${report.goalsProposed.length} goal proposal(s); ${report.candidatesRejectedAsDuplicates} candidate(s) rejected as duplicates; ${report.candidatesBlockedByCapacity} candidate(s) blocked by capacity.`,
  )
  for (const desire of report.activated) {
    lines.push(`• Activated ${desire.title} [${desire.desireId}]: effective strength ${reportStrength(desire.effectiveStrength)} crossed threshold ${reportStrength(desire.threshold)}.`)
  }
  for (const proposal of report.goalsProposed) {
    lines.push(`• Proposed goal ${proposal.goalId} from ${proposal.title} [${proposal.desireId}].`)
  }
  if (report.generationSkippedReason) {
    lines.push(`New-desire generation skipped: ${report.generationSkippedReason}.`)
  }

  return lines.join('\n')
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

  // Initialize storage if needed
  await initializeAgencyStorage(username);

  // Get enabled sources
  const enabledSources = await getEnabledSources(username);
  if (enabledSources.length === 0) {
    console.log(`${LOG_PREFIX} No enabled sources`);
    return 0;
  }

  // Gather inputs
  const gatheredInputs = await gatherInputs(enabledSources);
  const fresh = await filterFreshGeneratorInputs(username, gatheredInputs)
  const inputs = fresh.inputs

  const hasGenerationInputs =
    inputs.userRequests.length > 0 ||
    inputs.personaGoals.length > 0 ||
    inputs.urgentTasks.length > 0 ||
    inputs.activeTasks.length > 0 ||
    inputs.recentMemories.length > 0 ||
    inputs.memoryPatterns.length > 0 ||
    inputs.pendingCuriosityQuestions.length > 0 ||
    inputs.recentReflections.length > 0 ||
    inputs.recentDreams.length > 0;

  // =========================================================================
  // DECISION PHASE: all model output is obtained and validated before mutation.
  // =========================================================================
  const cycleNow = new Date().toISOString()
  const [nurturableDesires, currentActiveDesires] = await Promise.all([
    loadNurturableDesires(username),
    listActiveDesires(username),
  ])
  const hasFreshEvidence = inputEvidenceTokens(inputs).length > 0
  const reinforcementDecision = nurturableDesires.length > 0 && hasFreshEvidence
    ? await identifyReinforcedDesires(nurturableDesires, inputs, signal)
    : { reinforcements: new Map<string, DesireReinforcementDecision>(), modelCall: null }
  const reinforcements = reinforcementDecision.reinforcements

  const currentNascentCount = nurturableDesires.filter(desire => desire.status === 'nascent').length
  const projectedOpenCount = currentActiveDesires.length
    + currentNascentCount
    - projectedArchiveCount(nurturableDesires, reinforcements, config, cycleNow)
  const maxOpenDesires = config.limits.maxActiveDesires + config.limits.maxPendingDesires
  const canGenerate = projectedOpenCount < maxOpenDesires
  const generationDecision = hasGenerationInputs && canGenerate
    ? await identifyDesires(inputs, signal)
    : { candidates: [] as DesireCandidate[], modelCall: null }
  const candidates = generationDecision.candidates

  // =========================================================================
  // COMMIT PHASE: apply only the complete, validated cycle decision.
  // =========================================================================
  const nurtureResult = await applyNurtureDecisions(
    username,
    nurturableDesires,
    reinforcements,
    config,
    cycleNow,
  )

  const activated = await checkActivations(username, config);

  if (!hasGenerationInputs) {
    console.log(`${LOG_PREFIX} No inputs available for new desire generation`);
  } else if (!canGenerate) {
    console.log(`${LOG_PREFIX} Desire limit remains reached after projected decay (${projectedOpenCount}), skipping new generation`)
  } else if (candidates.length === 0) {
    console.log(`${LOG_PREFIX} No new desires identified`)
  }

  const [updatedNascent, updatedPending, updatedActive] = await Promise.all([
    listNascentDesires(username),
    listPendingDesires(username),
    listActiveDesires(username),
  ])
  const updatedTotal = updatedActive.length + updatedNascent.length
  const existingSummaries = [
    ...inputs.activeDesires,
    ...inputs.recentlyRejected,
    ...updatedNascent.map(d => ({ id: d.id, title: d.title, source: d.source, status: d.status, strength: d.strength })),
    ...updatedPending.map(d => ({ id: d.id, title: d.title, source: d.source, status: d.status, strength: d.strength })),
  ];
  const uniqueCandidates = candidates.filter(c => !isDuplicate(c, existingSummaries))
  const availableSlots = Math.max(0, maxOpenDesires - updatedTotal)
  const candidatesToCreate = uniqueCandidates.slice(0, availableSlots)
  if (candidates.length > 0) {
    console.log(`${LOG_PREFIX} ${uniqueCandidates.length} unique candidates after deduplication; ${candidatesToCreate.length} fit current capacity`)
  }

  const created: AgencyCreatedDesire[] = [];
  let newlyActive = 0;
  for (const candidate of candidatesToCreate) {
    const desire = createDesireFromCandidate(candidate, config, {
      id: `${candidate.source}:${candidate.sourceId}`,
      kind: 'origin',
      source: candidate.source,
      sourceId: candidate.sourceId,
      summary: candidate.reason,
      observedAt: cycleNow,
    });
    if (desire.status === 'pending') {
      if (hasDesireActivationCapacity(updatedActive.length + newlyActive, config)) {
        newlyActive++;
      } else {
        desire.status = 'nascent';
        desire.currentStage = 'nascent';
        delete desire.activatedAt;
      }
    }

    await saveDesire(desire, username);
    created.push({
      desireId: desire.id,
      title: desire.title,
      source: desire.source,
      sourceId: desire.sourceId,
      strength: desire.strength,
      status: desire.status,
      reason: desire.reason,
    });

    console.log(`${LOG_PREFIX} Created desire: ${desire.title} (strength: ${desire.strength.toFixed(2)})`);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_generated',
      actor: 'desire-agent',
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
  if (created.length > 0) {
    await incrementMetric('totalGenerated', created.length, username);
  }
  await markGeneratorInputsAnalyzed(fresh.tokens, username)

  // Log to inner dialogue if enabled
  if (config.logging.logToInnerDialogue) {
    const generationSkippedReason = !hasGenerationInputs
      ? 'there was no fresh eligible evidence'
      : !canGenerate
        ? `the open-desire limit was reached (${projectedOpenCount}/${maxOpenDesires})`
        : null
    const agencyReview: AgencyReviewReport = {
      reviewedAt: cycleNow,
      freshEvidenceCount: fresh.tokens.length,
      evidenceBySource: countEvidenceBySource(inputs),
      modelCalls: [reinforcementDecision.modelCall, generationDecision.modelCall]
        .filter((call): call is AgencyModelCallReport => call !== null),
      reinforced: nurtureResult.reinforced,
      decayed: nurtureResult.decayed,
      archived: nurtureResult.archived,
      activated,
      created,
      goalsProposed: nurtureResult.goalsProposed,
      candidatesRejectedAsDuplicates: candidates.length - uniqueCandidates.length,
      candidatesBlockedByCapacity: uniqueCandidates.length - candidatesToCreate.length,
      generationSkippedReason,
    }
    const innerDialogue = formatAgencyReview(agencyReview)

    // The admission graph owns both the rolling buffer entry and its matching
    // long-term memory; the agent only supplies semantic metadata.
    await submitInnerReflection(username, innerDialogue, {
      dialogueSource: 'agency-system',
      displayColor: '#10b981', // Emerald for agency
      type: 'desire_generation',
      tags: ['agency', 'desire-generation', 'inner'],
      agency: true,
      agencyReview,
      desiresGenerated: created.length,
      desiresReinforced: nurtureResult.reinforced.length,
      desiresDecayed: nurtureResult.decayed.length,
      desiresAbandoned: nurtureResult.archived.length,
      desiresActivated: activated.length,
      goalsProposed: nurtureResult.goalsProposed.length,
      sources: [...new Set(candidatesToCreate.map(c => c.source))],
    });
  }

  return created.length + nurtureResult.reinforced.length + activated.length;
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
      auditCycleOutcome(result)
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${user.username}`);

    const lock = acquireLock(`desire-agent:${user.username}`, { exitOnSignal: false });
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

      if (await isAgencyEnabled(user.username)) {
        const [pending, planning, reviewing, approved, awaitingReview, completed, failed] = await Promise.all([
          listPendingDesires(user.username),
          listDesiresByStatus('planning', user.username),
          listDesiresByStatus('reviewing', user.username),
          listDesiresByStatus('approved', user.username),
          listDesiresByStatus('awaiting_review', user.username),
          listDesiresByStatus('completed', user.username),
          listDesiresByStatus('failed', user.username),
        ]);
        if (pending.length + planning.length + reviewing.length > 0) {
          await submitDesireAgent({
            operation: 'plan',
            username: user.username,
            source: 'autonomy',
            priority: 'high',
            metadata: { producer: 'desire-agent-cycle' },
          });
        }
        if (approved.length > 0) {
          await submitDesireAgent({
            operation: 'execute',
            username: user.username,
            source: 'autonomy',
            priority: 'normal',
            metadata: { producer: 'desire-agent-cycle' },
          });
        }
        const reviewable = [...awaitingReview, ...completed, ...failed]
          .filter(desire => desire.execution && !desire.outcomeReview);
        if (reviewable.length > 0) {
          await submitDesireAgent({
            operation: 'review',
            username: user.username,
            source: 'autonomy',
            priority: 'low',
            metadata: { producer: 'desire-agent-cycle' },
          });
        }
      }
    } catch (error) {
      result.success = false;
      const errorMsg = `Error processing ${user.username}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
    } finally {
      lock.release();
    }

    auditCycleOutcome(result, user.username)

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    auditCycleOutcome(result, options.username)
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
