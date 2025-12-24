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
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  ROOT,
  audit,
  getTargetUser,
  withUserContext,
  captureEvent,
  loadPersonaCore,
  listActiveTasks,
  searchMemory,
  storageClient,
  getActiveBackend,
  callLLM,
  proposeGoalFromDesire,
  GOAL_PROPOSAL_THRESHOLDS,
  type RouterMessage,
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
  DESIRE_SOURCE_WEIGHTS,
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

export interface DesireGeneratorOptions {
  singleUser?: boolean;
  username?: string;
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
  try {
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
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading persona goals:`, error);
    return [];
  }
}

/**
 * Load active tasks, separating urgent from regular
 */
export async function loadTasks(): Promise<{ urgent: TaskSummary[]; regular: TaskSummary[] }> {
  try {
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
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading tasks:`, error);
    return { urgent: [], regular: [] };
  }
}

/**
 * Load recent memories (last 7 days)
 */
export async function loadRecentMemories(days: number = 7): Promise<MemorySummary[]> {
  try {
    const result = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
    if (!result.success || !result.path) return [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const memories: MemorySummary[] = [];

    // Walk the episodic directory
    async function walk(dir: string) {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.endsWith('.json')) {
          try {
            const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));

            // Skip inner dialogues and reflections
            if (content.type === 'inner_dialogue' || content.type === 'reflection' || content.type === 'dream') {
              continue;
            }

            const timestamp = new Date(content.timestamp);
            if (timestamp >= cutoffDate) {
              memories.push({
                id: content.id || entry,
                content: content.content?.substring(0, 500) || '',
                type: content.type,
                timestamp: content.timestamp,
                tags: content.tags,
              });
            }
          } catch {
            // Skip malformed files
          }
        }
      }
    }

    await walk(result.path);

    // Sort by recency and limit
    return memories
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading memories:`, error);
    return [];
  }
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
  try {
    const result = storageClient.resolvePath({
      category: 'state',
      subcategory: 'curiosity',
      relativePath: 'questions/pending',
    });

    if (!result.success || !result.path) return [];

    const questions: CuriosityQuestion[] = [];
    let files: string[];

    try {
      files = await fs.readdir(result.path);
    } catch {
      return [];
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = JSON.parse(await fs.readFile(path.join(result.path, file), 'utf-8'));
        questions.push({
          id: content.id || file,
          question: content.question,
          askedAt: content.askedAt,
          topic: content.topic,
        });
      } catch {
        // Skip invalid files
      }
    }

    return questions;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading curiosity questions:`, error);
    return [];
  }
}

/**
 * Load recent reflections
 */
export async function loadReflections(count: number = 5): Promise<ReflectionSummary[]> {
  try {
    const result = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
    if (!result.success || !result.path) return [];

    const reflections: ReflectionSummary[] = [];

    async function walk(dir: string) {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.endsWith('.json')) {
          try {
            const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));

            if (content.type === 'inner_dialogue' && content.tags?.includes('idle-thought')) {
              reflections.push({
                id: content.id || entry,
                content: content.content?.substring(0, 500) || '',
                timestamp: content.timestamp,
                tags: content.tags,
              });
            }
          } catch {
            // Skip malformed files
          }
        }
      }
    }

    await walk(result.path);

    return reflections
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, count);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading reflections:`, error);
    return [];
  }
}

/**
 * Load recent dreams
 */
export async function loadDreams(count: number = 3): Promise<DreamSummary[]> {
  try {
    const result = storageClient.resolvePath({
      category: 'memory',
      subcategory: 'episodic',
      relativePath: 'dreams',
    });

    if (!result.success || !result.path) return [];

    const dreams: DreamSummary[] = [];

    async function walk(dir: string) {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.endsWith('.json')) {
          try {
            const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));

            if (content.type === 'dream') {
              dreams.push({
                id: content.id || entry,
                content: content.content?.substring(0, 500) || '',
                timestamp: content.timestamp,
                themes: content.tags?.filter((t: string) => !['dream', 'sleep'].includes(t)),
              });
            }
          } catch {
            // Skip malformed files
          }
        }
      }
    }

    await walk(result.path);

    return dreams
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, count);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading dreams:`, error);
    return [];
  }
}

/**
 * Load existing desires for duplicate checking
 */
async function loadExistingDesires(): Promise<{
  active: DesireSummary[];
  rejected: DesireSummary[];
}> {
  try {
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
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading existing desires:`, error);
    return { active: [], rejected: [] };
  }
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
    currentTrustLevel: 'supervised_auto', // TODO: Load from config
    recentlyRejected: existingDesires.rejected,
    activeDesires: existingDesires.active,
  };
}

// ============================================================================
// LLM Desire Identification
// ============================================================================

/**
 * Format inputs for LLM prompt
 */
function formatInputsForPrompt(inputs: DesireGeneratorInputs): string {
  const sections: string[] = [];

  if (inputs.personaGoals.length > 0) {
    sections.push(`### Persona Goals (Weight: ${DESIRE_SOURCE_WEIGHTS.persona_goal})
${inputs.personaGoals.map(g => `- [${g.priority}] ${g.goal} (${g.status})`).join('\n')}`);
  }

  if (inputs.urgentTasks.length > 0) {
    sections.push(`### Urgent Tasks (Weight: ${DESIRE_SOURCE_WEIGHTS.urgent_task})
${inputs.urgentTasks.map(t => `- [${t.priority}] ${t.title}${t.description ? `: ${t.description.substring(0, 100)}` : ''}`).join('\n')}`);
  }

  if (inputs.activeTasks.length > 0) {
    sections.push(`### Active Tasks (Weight: ${DESIRE_SOURCE_WEIGHTS.task})
${inputs.activeTasks.slice(0, 10).map(t => `- ${t.title}`).join('\n')}`);
  }

  if (inputs.recentMemories.length > 0) {
    sections.push(`### Recent Memories
${inputs.recentMemories.slice(0, 10).map(m => `- [${m.type || 'observation'}] ${m.content.substring(0, 100)}...`).join('\n')}`);
  }

  if (inputs.memoryPatterns.length > 0) {
    sections.push(`### Detected Memory Patterns (Weight: ${DESIRE_SOURCE_WEIGHTS.memory_pattern})
These are recurring themes identified from recent experiences:
${inputs.memoryPatterns.map(p => `- ${p.description} (appears in ${p.relatedMemoryIds.length} memories)`).join('\n')}`);
  }

  if (inputs.pendingCuriosityQuestions.length > 0) {
    sections.push(`### Unanswered Questions (Weight: ${DESIRE_SOURCE_WEIGHTS.curiosity})
${inputs.pendingCuriosityQuestions.map(q => `- ${q.question}`).join('\n')}`);
  }

  if (inputs.recentReflections.length > 0) {
    sections.push(`### Recent Reflections (Weight: ${DESIRE_SOURCE_WEIGHTS.reflection})
${inputs.recentReflections.map(r => `- ${r.content.substring(0, 150)}...`).join('\n')}`);
  }

  if (inputs.recentDreams.length > 0) {
    sections.push(`### Recent Dreams (Weight: ${DESIRE_SOURCE_WEIGHTS.dream})
${inputs.recentDreams.map(d => `- ${d.content.substring(0, 100)}...`).join('\n')}`);
  }

  if (inputs.activeDesires.length > 0) {
    sections.push(`### Already Active Desires (avoid duplicates)
${inputs.activeDesires.map(d => `- ${d.title} [${d.source}]`).join('\n')}`);
  }

  if (inputs.recentlyRejected.length > 0) {
    sections.push(`### Recently Rejected (consider if still relevant)
${inputs.recentlyRejected.map(d => `- ${d.title}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Use LLM to identify desires from inputs
 */
export async function identifyDesires(inputs: DesireGeneratorInputs): Promise<DesireCandidate[]> {
  const formattedInputs = formatInputsForPrompt(inputs);

  if (!formattedInputs.trim()) {
    console.log(`${LOG_PREFIX} No inputs to process`);
    return [];
  }

  const systemPrompt = `You are the Agency module of MetaHuman OS, responsible for identifying what the system genuinely wants to do based on accumulated experiences, goals, and insights.

A desire is not just a task - it's a motivated intention. It represents something the system authentically wants to accomplish, with a clear reason why.

## Guidelines
- Focus on desires that are actionable within the system's capabilities
- Prefer desires that align with persona goals
- **Pay special attention to Detected Memory Patterns** - these recurring themes represent genuine interests and concerns that have emerged organically from experiences
- When a pattern appears frequently (3+ times), consider if it suggests a desire to explore, resolve, or build upon that theme
- Consider patterns in memories and reflections
- Avoid duplicating already active desires
- Be selective - only identify 0-5 genuine desires
- Higher priority sources should have more influence

## Risk Levels
- none: Read-only, information gathering
- low: Reversible actions, local file operations
- medium: External communications, data modifications
- high: Irreversible actions, external system interactions
- critical: Financial, security, or privacy implications`;

  const userPrompt = `## Current Context

${formattedInputs}

## Task

Identify 0-5 genuine desires based on the above context. For each desire, provide:

1. title: Brief name (5-10 words)
2. description: What specifically do I want to do?
3. reason: Why do I want this? What need does it fulfill?
4. source: Which input category primarily inspired this? (persona_goal, urgent_task, task, memory_pattern, curiosity, reflection, dream)
5. sourceId: ID of the specific item if applicable (optional)
6. initialStrength: 0.0-1.0 based on urgency and alignment
7. risk: none/low/medium/high/critical
8. suggestedAction: What would executing this look like?

Respond with a JSON array of desire objects. Return an empty array [] if no genuine desires emerge.

Example response:
[
  {
    "title": "Organize project notes into coherent structure",
    "description": "Consolidate scattered notes about the ML project into a structured document",
    "reason": "Multiple memories mention this project and reflections show concern about losing context",
    "source": "memory_pattern",
    "initialStrength": 0.6,
    "risk": "low",
    "suggestedAction": "Search memories for ML project content, synthesize into document, save to out/"
  }
]`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'persona',  // Use persona model - desires come from identity
      messages,
      options: {
        temperature: 0.6,  // Slightly higher for more creative desire generation
        responseFormat: 'json',
      },
    });

    if (!response.content) {
      console.error(`${LOG_PREFIX} Empty LLM response`);
      return [];
    }

    // Parse JSON response
    const content = response.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error(`${LOG_PREFIX} No JSON array in response:`, content.substring(0, 200));
      return [];
    }

    const candidates = JSON.parse(jsonMatch[0]) as DesireCandidate[];
    console.log(`${LOG_PREFIX} LLM identified ${candidates.length} desire candidates`);

    return candidates;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error calling LLM:`, error);
    return [];
  }
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
  // Use config-based weight or fall back to default weights
  const sourceConfig = config.sources[candidate.source];
  const sourceWeight = sourceConfig?.enabled ? sourceConfig.weight : (DESIRE_SOURCE_WEIGHTS[candidate.source] ?? 0.5);

  // Use config's initial strength, not candidate's - desires must grow organically
  const initialStrength = config.thresholds.decay.initialStrength;

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
  inputs: DesireGeneratorInputs
): Promise<Map<string, string>> {
  if (existingDesires.length === 0) {
    return new Map();
  }

  const formattedDesires = existingDesires
    .map(d => `- [${d.id}] "${d.title}" (strength: ${d.strength.toFixed(2)}, source: ${d.source})`)
    .join('\n');

  const formattedInputs: string[] = [];

  if (inputs.personaGoals.length > 0) {
    formattedInputs.push(`Goals: ${inputs.personaGoals.map(g => g.goal).join('; ')}`);
  }
  if (inputs.urgentTasks.length > 0) {
    formattedInputs.push(`Urgent tasks: ${inputs.urgentTasks.map(t => t.title).join('; ')}`);
  }
  if (inputs.activeTasks.length > 0) {
    formattedInputs.push(`Tasks: ${inputs.activeTasks.slice(0, 5).map(t => t.title).join('; ')}`);
  }
  if (inputs.recentMemories.length > 0) {
    formattedInputs.push(`Recent memories: ${inputs.recentMemories.slice(0, 5).map(m => m.content.substring(0, 80)).join('; ')}`);
  }
  if (inputs.recentReflections.length > 0) {
    formattedInputs.push(`Reflections: ${inputs.recentReflections.slice(0, 3).map(r => r.content.substring(0, 80)).join('; ')}`);
  }
  if (inputs.recentDreams.length > 0) {
    formattedInputs.push(`Dreams: ${inputs.recentDreams.slice(0, 2).map(d => d.content.substring(0, 80)).join('; ')}`);
  }

  if (formattedInputs.length === 0) {
    return new Map();
  }

  const systemPrompt = `You are reviewing existing desires to see if current experiences reinforce them.
A desire is reinforced when current inputs (memories, tasks, goals, reflections) relate to or support that desire.
Reinforcement means the desire becomes more relevant based on recent experience.`;

  const userPrompt = `## Existing Desires
${formattedDesires}

## Current Inputs
${formattedInputs.join('\n')}

## Task
Identify which desires are reinforced by the current inputs. A desire is reinforced if:
- A memory, task, or reflection relates to the desire's theme
- Recent activity supports the desire's goal
- The desire becomes more relevant based on new information

Return JSON array of reinforced desires:
[{"id": "desire-xxx", "reason": "Brief reason why this is reinforced"}]

Return empty array [] if no desires are reinforced. Be selective - only reinforce desires with genuine connections.`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      options: { temperature: 0.3, responseFormat: 'json' },
    });

    if (!response.content) return new Map();

    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return new Map();

    const reinforcements = JSON.parse(jsonMatch[0]) as Array<{ id: string; reason: string }>;
    const result = new Map<string, string>();

    for (const r of reinforcements) {
      result.set(r.id, r.reason);
    }

    console.log(`${LOG_PREFIX} LLM identified ${result.size} reinforced desires`);
    return result;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error identifying reinforcements:`, error);
    return new Map();
  }
}

/**
 * Nurture existing desires: apply decay to unreinforced, boost reinforced.
 * This is the heart of the run-based desire system.
 */
async function nurtureExistingDesires(
  username: string,
  inputs: DesireGeneratorInputs,
  config: Awaited<ReturnType<typeof loadConfig>>
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
  const reinforcements = await identifyReinforcedDesires(allDesires, inputs);

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
export async function generateDesiresForUser(username: string): Promise<number> {
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
  const nurtureResult = await nurtureExistingDesires(username, inputs, config);

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
  const candidates = await identifyDesires(inputs);
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

    try {
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
    } catch (error) {
      console.error(`${LOG_PREFIX} Error saving desire:`, error);
    }
  }

  // Update metrics
  if (created > 0) {
    await incrementMetric('totalGenerated', created, username);
  }

  // Log to inner dialogue if enabled
  if (config.logging.logToInnerDialogue && (created > 0 || nurtureResult.reinforced > 0 || activatedCount > 0 || nurtureResult.goalsProposed > 0)) {
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

    // Report on new desires
    if (created > 0) {
      const desireList = uniqueCandidates
        .slice(0, created)
        .map(c => `  • ${c.title} (${c.source})`)
        .join('\n');
      parts.push(`🌱 ${created} new seed desire(s) planted:\n${desireList}`);
    }

    const innerDialogue = `💭 Agency Review:\n\n${parts.join('\n')}\n\nDesires grow through repeated reinforcement from experiences and fade without it.`;

    captureEvent(innerDialogue, {
      type: 'inner_dialogue',
      tags: ['agency', 'desire-generation', 'inner'],
      metadata: {
        agency: true,
        desiresGenerated: created,
        desiresReinforced: nurtureResult.reinforced,
        desiresDecayed: nurtureResult.decayed,
        desiresAbandoned: nurtureResult.abandoned,
        desiresActivated: activatedCount,
        goalsProposed: nurtureResult.goalsProposed,
        sources: [...new Set(uniqueCandidates.map(c => c.source))],
      },
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

    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    let user = getTargetUser(options);
    if (!user && options.singleUser) {
      user = { userId: 'default', username: 'default', role: 'owner' };
    }

    if (!user) {
      console.log(`${LOG_PREFIX} No active user found`);
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${user.username}`);

    try {
      const created = await withUserContext(
        { userId: user.userId, username: user.username, role: user.role },
        async () => generateDesiresForUser(user!.username)
      );

      result.stats[user.username] = created;
      result.totalGenerated += created;
      result.usersProcessed++;
    } catch (error) {
      const errorMsg = `Error processing ${user.username}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(`${LOG_PREFIX} ${errorMsg}`);
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

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: DesireGeneratorOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  // If context has a specific user, process only that user
  if (ctx.userId && !options.username) {
    options.username = ctx.userId;
  }

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
