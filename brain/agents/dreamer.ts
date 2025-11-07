/**
 * Dreamer Agent
 * Enhanced version that:
 * 1. Curates a weighted sample of diverse memories
 * 2. Generates surreal dream narratives
 * 3. Extracts preferences and heuristics using LLM
 * 4. Writes overnight learnings to procedural memory
 */

import {
  callLLM,
  type RouterMessage,
  captureEvent,
  paths,
  acquireLock,
  isLocked,
  audit,
  listUsers,
  withUserContext,
  initGlobalLogger,
} from '../../packages/core/src/index.js';
import fs from 'node:fs';
import path from 'node:path';

interface Memory {
  id: string;
  timestamp: string;
  content: string;
  metadata?: {
    type?: string;
    tags?: string[];
    entities?: string[];
    processed?: boolean;
  };
}

interface SleepConfig {
  enabled: boolean;
  maxDreamsPerNight: number;
  evaluate: boolean;
}

function loadSleepConfig(): SleepConfig {
  try {
    const configPath = path.join(paths.etc, 'sleep.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('[dreamer] Could not load sleep.json, using defaults');
    return {
      enabled: true,
      maxDreamsPerNight: 3,
      evaluate: true,
    };
  }
}

/**
 * Get a weighted random sample of memories from the last N days
 * Newer memories get higher weight, diverse topics preferred
 */
async function curateMemories(days: number = 7, sampleSize: number = 15): Promise<Memory[]> {
  const memories: Array<Memory & { weight: number; age: number }> = [];
  const now = new Date();

  audit({
    level: 'info',
    category: 'action',
    event: 'dream_curation_started',
    details: { days, sampleSize },
    actor: 'dreamer',
  });

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const year = date.getFullYear().toString();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const datePrefix = `${year}-${month}-${day}`;

    const episodicDirForYear = path.join(paths.episodic, year);

    try {
      if (!fs.existsSync(episodicDirForYear)) continue;

      const files = fs.readdirSync(episodicDirForYear);
      for (const file of files) {
        if (file.startsWith(`evt-${year}${month}${day}`) || file.startsWith(datePrefix)) {
          const filepath = path.join(episodicDirForYear, file);
          const content = fs.readFileSync(filepath, 'utf-8');
          const memory = JSON.parse(content) as Memory;

          // Skip dreams and low-confidence memories
          if (memory.metadata?.type === 'dream') continue;

          // Weight: newer = higher, decay over time
          const ageInDays = i;
          const weight = Math.max(0.1, 1.0 - (ageInDays / days) * 0.7);

          memories.push({ ...memory, weight, age: ageInDays });
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        console.error(`[dreamer] Error reading memories for ${datePrefix}:`, error);
      }
    }
  }

  if (memories.length === 0) {
    audit({
      level: 'info',
      category: 'action',
      event: 'dream_curation_completed',
      details: { memoriesFound: 0, curated: 0 },
      actor: 'dreamer',
    });
    return [];
  }

  // Weighted random sampling
  const curated: Memory[] = [];
  const tempMemories = [...memories];

  while (curated.length < sampleSize && tempMemories.length > 0) {
    const totalWeight = tempMemories.reduce((sum, m) => sum + m.weight, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < tempMemories.length; i++) {
      random -= tempMemories[i].weight;
      if (random <= 0) {
        const { weight, age, ...memory } = tempMemories[i];
        curated.push(memory);
        tempMemories.splice(i, 1);
        break;
      }
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'dream_curation_completed',
    details: { memoriesFound: memories.length, curated: curated.length },
    actor: 'dreamer',
  });

  return curated;
}

/**
 * Generate a surreal dream from memory fragments
 */
async function generateDream(memories: Memory[]): Promise<string | null> {
  if (memories.length < 3) {
    console.log('[dreamer] Not enough memory fragments to form a dream.');
    return null;
  }

  const memoriesText = memories
    .map(m => `- A fragment: ${m.content.substring(0, 300)}`)
    .join('\n');

  const systemPrompt = `
    You are the dreamer. You are processing recent experiences into a surreal, metaphorical dream.
    Do not be literal. Weave the following memory fragments into a short, abstract narrative.
    Use symbolism and look for unexpected connections. The output should feel like a dream.
    Start the dream directly, without any preamble. Keep it under 200 words.
  `.trim();

  const prompt = `Memory Fragments:\n${memoriesText}`;

  try {
    const response = await callLLM({
      role: 'persona',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      options: { temperature: 0.95 },
    });

    const dream = response.content.trim();
    return dream || null;
  } catch (error) {
    console.error('[dreamer] Error while generating dream:', error);
    return null;
  }
}

/**
 * Extract preferences, heuristics, and learnings from memories
 */
async function extractLearnings(memories: Memory[]): Promise<{
  preferences: string[];
  heuristics: string[];
  styleNotes: string[];
  avoidances: string[];
}> {
  if (memories.length === 0) {
    return { preferences: [], heuristics: [], styleNotes: [], avoidances: [] };
  }

  const memoriesText = memories
    .map(m => `[${m.timestamp}] ${m.content}`)
    .join('\n\n');

  const systemPrompt = `You are analyzing recent episodic memories to extract implicit and explicit preferences, decision heuristics, writing style patterns, and things to avoid.

Be specific and cite examples where possible. Extract:
1. **Preferences**: What does the person value, prefer, or prioritize?
2. **Heuristics**: What decision rules or patterns emerge?
3. **Style Notes**: What communication or writing style is evident?
4. **Avoidances**: What does the person dislike or avoid?

Respond with JSON only.`;

  const userPrompt = `Analyze these memories and extract learnings:

${memoriesText}

Respond with JSON:
{
  "preferences": ["preference 1 (with example if possible)", "preference 2", ...],
  "heuristics": ["heuristic 1", "heuristic 2", ...],
  "styleNotes": ["style note 1", "style note 2", ...],
  "avoidances": ["avoidance 1", "avoidance 2", ...]
}`;

  try {
    const llmResponse = await callLLM({
      role: 'curator',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.3 },
    });

    const response = JSON.parse(llmResponse.content) as {
      preferences: string[];
      heuristics: string[];
      styleNotes: string[];
      avoidances: string[];
    };

    return {
      preferences: response.preferences || [],
      heuristics: response.heuristics || [],
      styleNotes: response.styleNotes || [],
      avoidances: response.avoidances || [],
    };
  } catch (error) {
    console.error('[dreamer] Error extracting learnings:', error);
    return { preferences: [], heuristics: [], styleNotes: [], avoidances: [] };
  }
}

/**
 * Write overnight learnings to procedural memory
 */
function writeOvernightLearnings(
  date: string,
  learnings: {
    preferences: string[];
    heuristics: string[];
    styleNotes: string[];
    avoidances: string[];
  },
  memoryCitations: string[]
): string {
  const filename = `overnight-learnings-${date.replace(/-/g, '')}.md`;
  const filepath = path.join(paths.proceduralOvernight, filename);

  // Ensure directory exists
  fs.mkdirSync(paths.proceduralOvernight, { recursive: true });

  const content = `# Overnight Learnings — ${date}

Generated from ${memoryCitations.length} recent memories during the nightly sleep cycle.

## Preferences
${learnings.preferences.length > 0 ? learnings.preferences.map(p => `- ${p}`).join('\n') : '- None extracted'}

## Decision Heuristics
${learnings.heuristics.length > 0 ? learnings.heuristics.map(h => `- ${h}`).join('\n') : '- None extracted'}

## Writing Style Notes
${learnings.styleNotes.length > 0 ? learnings.styleNotes.map(s => `- ${s}`).join('\n') : '- None extracted'}

## Avoidances
${learnings.avoidances.length > 0 ? learnings.avoidances.map(a => `- ${a}`).join('\n') : '- None extracted'}

## Citations
${memoryCitations.map(id => `- ${id}`).join('\n')}

---
*This file is generated automatically by the dreamer agent during the nightly sleep cycle.*
*It is used by the morning-loader agent to compose the daily operator profile.*
`;

  fs.writeFileSync(filepath, content, 'utf-8');

  audit({
    level: 'info',
    category: 'data',
    event: 'overnight_learnings_written',
    details: {
      date,
      filepath,
      preferencesCount: learnings.preferences.length,
      heuristicsCount: learnings.heuristics.length,
      styleNotesCount: learnings.styleNotes.length,
      avoidancesCount: learnings.avoidances.length,
      citations: memoryCitations.length,
    },
    actor: 'dreamer',
  });

  return filepath;
}

/**
 * Generate dreams and learnings for a single user
 */
async function generateUserDreams(username: string): Promise<{
  dreamsGenerated: number;
  memoriesCurated: number;
  preferencesExtracted: number;
  heuristicsExtracted: number;
}> {
  console.log(`[dreamer] Processing user: ${username}`);

  const config = loadSleepConfig();

  if (!config.enabled) {
    console.log(`[dreamer]   Sleep system disabled for ${username}`);
    return { dreamsGenerated: 0, memoriesCurated: 0, preferencesExtracted: 0, heuristicsExtracted: 0 };
  }

  // Step 1: Curate memories (uses user context!)
  const curatedMemories = await curateMemories(7, 15);

  if (curatedMemories.length < 3) {
    console.log(`[dreamer]   Not enough memories for ${username} (found ${curatedMemories.length})`);
    audit({
      level: 'info',
      category: 'action',
      event: 'sleep_skipped',
      details: { reason: 'insufficient_memories', memoriesFound: curatedMemories.length },
      actor: 'dreamer',
    });
    return { dreamsGenerated: 0, memoriesCurated: curatedMemories.length, preferencesExtracted: 0, heuristicsExtracted: 0 };
  }

  // Step 2: Generate dreams (1-3 per night)
  const dreamCount = Math.min(config.maxDreamsPerNight, Math.floor(Math.random() * 3) + 1);
  let dreamsGenerated = 0;

  for (let i = 0; i < dreamCount; i++) {
    const dreamMemories = curatedMemories.slice(i * 5, (i + 1) * 5);
    if (dreamMemories.length < 3) break;

    const dream = await generateDream(dreamMemories);
    if (dream) {
      const sourceIds = dreamMemories.map(m => m.id);
      await captureEvent(dream, { type: 'dream', sources: sourceIds, confidence: 0.7 });
      dreamsGenerated++;
      console.log(`[dreamer]   Dream ${i + 1}/${dreamCount} generated for ${username}`);

      // Log dream to audit stream for inner dialogue display
      audit({
        level: 'info',
        category: 'decision',
        event: 'dream_generated',
        message: 'Dreamer generated new dream',
        details: { dream, sourceCount: sourceIds.length },
        metadata: { dream },
        actor: 'dreamer',
      });
    }
  }

  // Step 3: Extract preferences and learnings
  console.log(`[dreamer]   Extracting preferences and learnings for ${username}...`);
  const learnings = await extractLearnings(curatedMemories);

  // Step 4: Write overnight learnings
  const today = new Date().toISOString().split('T')[0];
  const memoryCitations = curatedMemories.map(m => m.id);
  const learningsFile = writeOvernightLearnings(today, learnings, memoryCitations);

  console.log(`[dreamer]   Overnight learnings written: ${path.basename(learningsFile)}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'sleep_completed',
    details: {
      dreamsGenerated,
      memoriesCurated: curatedMemories.length,
      learningsFile: path.basename(learningsFile),
      preferencesExtracted: learnings.preferences.length,
      heuristicsExtracted: learnings.heuristics.length,
    },
    actor: 'dreamer',
  });

  console.log(`[dreamer]   Completed ${username} ✅`);

  return {
    dreamsGenerated,
    memoriesCurated: curatedMemories.length,
    preferencesExtracted: learnings.preferences.length,
    heuristicsExtracted: learnings.heuristics.length,
  };
}

/**
 * Main dreaming cycle (multi-user)
 */
async function run() {
  initGlobalLogger('dreamer');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-dreamer')) {
      console.log('[dreamer] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-dreamer');
  } catch {
    console.log('[dreamer] Failed to acquire lock. Exiting.');
    return;
  }

  try {
    console.log('[dreamer] Drifting into a dream (multi-user)...');

    // Audit cycle start (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'sleep_started',
      details: { agent: 'dreamer', mode: 'multi-user' },
      actor: 'dreamer',
    });

    // Get all users
    const users = listUsers();
    console.log(`[dreamer] Found ${users.length} users to process`);

    let totalDreams = 0;
    let totalMemories = 0;
    let totalPreferences = 0;
    let totalHeuristics = 0;

    // Process each user with isolated context
    for (const user of users) {
      try {
        const stats = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => {
            return await generateUserDreams(user.username);
          }
        );

        totalDreams += stats.dreamsGenerated;
        totalMemories += stats.memoriesCurated;
        totalPreferences += stats.preferencesExtracted;
        totalHeuristics += stats.heuristicsExtracted;
      } catch (error) {
        console.error(`[dreamer] Failed to process user ${user.username}:`, (error as Error).message);
        // Continue with next user
      }
    }

    console.log(`[dreamer] Cycle finished. Generated ${totalDreams} dreams across ${users.length} users. ✅`);

    // Audit completion (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'sleep_cycle_completed',
      details: {
        agent: 'dreamer',
        mode: 'multi-user',
        totalDreams,
        totalMemories,
        totalPreferences,
        totalHeuristics,
        userCount: users.length,
      },
      actor: 'dreamer',
    });
  } catch (error) {
    console.error('[dreamer] Error during sleep cycle:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'sleep_failed',
      details: { error: (error as Error).message },
      actor: 'dreamer',
    });
  } finally {
    lock.release();
  }
}

run().catch(console.error);
