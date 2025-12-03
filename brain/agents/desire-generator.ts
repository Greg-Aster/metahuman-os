#!/usr/bin/env tsx
/**
 * Desire Generator Agent
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
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  ROOT,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  captureEvent,
  loadPersonaCore,
  listActiveTasks,
  searchMemory,
  storageClient,
  ollama,
  callLLM,
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
  getSourceWeight,
  DESIRE_SOURCE_WEIGHTS,
} from '@metahuman/core';

import {
  loadConfig,
  isAgencyEnabled,
  getEnabledSources,
} from '@metahuman/core';

import {
  saveDesire,
  listPendingDesires,
  listActiveDesires,
  listNascentDesires,
  listDesiresByStatus,
  incrementMetric,
  initializeAgencyStorage,
} from '@metahuman/core';

import fs from 'node:fs/promises';
import path from 'node:path';

const LOCK_NAME = 'desire-generator';
const LOG_PREFIX = '[AGENCY:generator]';

// ============================================================================
// Input Gathering
// ============================================================================

/**
 * Load persona goals from core.json
 */
async function loadPersonaGoals(): Promise<PersonaGoal[]> {
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
async function loadTasks(): Promise<{ urgent: TaskSummary[]; regular: TaskSummary[] }> {
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
async function loadRecentMemories(days: number = 7): Promise<MemorySummary[]> {
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
 * Load pending curiosity questions
 */
async function loadCuriosityQuestions(): Promise<CuriosityQuestion[]> {
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
async function loadReflections(count: number = 5): Promise<ReflectionSummary[]> {
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
async function loadDreams(count: number = 3): Promise<DreamSummary[]> {
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
async function gatherInputs(enabledSources: DesireSource[]): Promise<DesireGeneratorInputs> {
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

  return {
    personaGoals,
    urgentTasks: tasks.urgent,
    activeTasks: tasks.regular,
    recentMemories,
    memoryPatterns: [], // TODO: Implement pattern detection
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
    sections.push(`### Recent Memories (Weight: ${DESIRE_SOURCE_WEIGHTS.memory_pattern})
${inputs.recentMemories.slice(0, 10).map(m => `- [${m.type || 'observation'}] ${m.content.substring(0, 100)}...`).join('\n')}`);
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
async function identifyDesires(inputs: DesireGeneratorInputs): Promise<DesireCandidate[]> {
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
      role: 'orchestrator',
      messages,
      options: {
        temperature: 0.4,
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
 * Convert candidate to full desire object
 */
function createDesire(candidate: DesireCandidate, config: Awaited<ReturnType<typeof loadConfig>>): Desire {
  const now = new Date().toISOString();
  const sourceWeight = getSourceWeight(candidate.source);

  return {
    id: generateDesireId(),
    title: candidate.title,
    description: candidate.description,
    reason: candidate.reason,
    source: candidate.source,
    sourceId: candidate.sourceId,
    strength: candidate.initialStrength,
    baseWeight: sourceWeight,
    threshold: config.thresholds.activation,
    decayRate: config.thresholds.decay.ratePerHour,
    lastDecayAt: now,
    reinforcements: 0,
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
// Main Generator Function
// ============================================================================

/**
 * Generate desires for a single user
 */
async function generateDesiresForUser(username: string): Promise<number> {
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

  if (!hasInputs) {
    console.log(`${LOG_PREFIX} No inputs available for desire generation`);
    return 0;
  }

  // Identify desires using LLM
  const candidates = await identifyDesires(inputs);
  if (candidates.length === 0) {
    console.log(`${LOG_PREFIX} No desires identified`);
    return 0;
  }

  // Filter duplicates
  const existingSummaries = [...inputs.activeDesires, ...inputs.recentlyRejected];
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
        category: 'agency',
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
  if (config.logging.logToInnerDialogue && created > 0) {
    const desireList = uniqueCandidates
      .slice(0, created)
      .map(c => `• ${c.title} (${c.source})`)
      .join('\n');

    const innerDialogue = `💭 Agency noticed new intentions forming:\n\n${desireList}\n\nThese desires will be evaluated and may lead to action if they grow stronger.`;

    captureEvent(innerDialogue, {
      type: 'inner_dialogue',
      tags: ['agency', 'desire-generation', 'inner'],
      metadata: {
        agency: true,
        desiresGenerated: created,
        sources: [...new Set(uniqueCandidates.map(c => c.source))],
      },
    });
  }

  return created;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  initGlobalLogger();
  console.log(`${LOG_PREFIX} Starting desire generator agent...`);

  // Check lock
  if (isLocked(LOCK_NAME)) {
    console.log(`${LOG_PREFIX} Another instance is running, exiting`);
    process.exit(0);
  }

  // Acquire lock
  const lock = await acquireLock(LOCK_NAME);
  if (!lock) {
    console.error(`${LOG_PREFIX} Failed to acquire lock`);
    process.exit(1);
  }

  try {
    // Check Ollama
    const running = await ollama.isRunning();
    if (!running) {
      console.warn(`${LOG_PREFIX} Ollama is not running; skipping. Start with: ollama serve`);
      audit({
        category: 'system',
        level: 'warn',
        message: 'Desire generator skipped: Ollama not running',
        actor: 'desire-generator',
      });
      return;
    }

    // Process all users
    const users = listUsers();
    console.log(`${LOG_PREFIX} Processing ${users.length} user(s)`);

    let totalCreated = 0;

    for (const username of users) {
      try {
        const created = await withUserContext({ username, role: 'owner' }, async () => {
          return await generateDesiresForUser(username);
        });
        totalCreated += created;
      } catch (error) {
        console.error(`${LOG_PREFIX} Error processing user ${username}:`, error);
        audit({
          category: 'system',
          level: 'error',
          message: `Desire generator error for user ${username}`,
          actor: 'desire-generator',
          details: { error: String(error) },
        });
      }
    }

    console.log(`${LOG_PREFIX} Complete. Generated ${totalCreated} desire(s) across all users.`);

    audit({
      category: 'system',
      level: 'info',
      message: 'Desire generator completed',
      actor: 'desire-generator',
      details: { totalCreated, usersProcessed: users.length },
    });
  } finally {
    lock.release();
  }
}

main().catch(error => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});
