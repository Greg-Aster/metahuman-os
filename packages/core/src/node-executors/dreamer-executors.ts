/**
 * Dreamer Agent Node Executors
 * Handles dream generation from weighted memory sampling with surreal narrative synthesis
 */

import fs from 'node:fs';
import path from 'node:path';
import { callLLM, type RouterMessage } from '../model-router.js';
import { audit } from '../audit.js';
import { captureEvent } from '../memory.js';
import { getProfilePaths, paths } from '../paths.js';
import { recordSystemActivity } from '../system-activity.js';
import { scheduler } from '../agent-scheduler.js';
import { appendDreamToBuffer } from '../conversation-buffer.js';
import type { NodeExecutor } from './types.js';

interface Memory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  metadata?: {
    type?: string;
    tags?: string[];
    entities?: string[];
    processed?: boolean;
  };
}

function markBackgroundActivity() {
  try {
    recordSystemActivity();
  } catch {}

  try {
    scheduler.recordActivity();
  } catch {}
}

/**
 * Dreamer Memory Curator Node
 *
 * Curates weighted sample of memories from entire lifetime using exponential decay.
 * Older memories retain meaningful probability (1-year-old memories ~20% weight).
 * Like the human mind: childhood memories can appear in dreams.
 *
 * Properties:
 *   - sampleSize: Number of memories to sample (default: 15)
 *   - decayDays: Days for exponential decay weighting (default: 227)
 *
 * Outputs:
 *   - memories: Array of curated memory objects
 *   - count: Number of memories curated
 *   - avgAgeDays: Average age of curated memories
 *   - oldestAgeDays: Age of oldest curated memory
 */
export const dreamerMemoryCuratorExecutor: NodeExecutor = async (_inputs, context, properties) => {
  const username = context.userId || context.username;
  const sampleSize = properties?.sampleSize || 15;
  const decayDays = properties?.decayDays || 227; // ~20% weight at 1 year

  if (!username) {
    console.error('[DreamerMemoryCurator] No username in context');
    return {
      memories: [],
      count: 0,
      error: 'No username in context',
    };
  }

  const now = new Date();
  const memories: Array<Memory & { weight: number; age: number }> = [];

  audit({
    level: 'info',
    category: 'action',
    event: 'dream_curation_started',
    details: { sampleSize, decayDays, scope: 'lifetime', username },
    actor: 'dreamer',
  });

  try {
    const profilePaths = getProfilePaths(username);
    const episodicDir = profilePaths.episodic;

    // Recursively walk episodic directory
    function walkDir(dir: string): string[] {
      const files: string[] = [];
      if (!fs.existsSync(dir)) return files;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walkDir(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const episodicFiles = walkDir(episodicDir);

    if (episodicFiles.length === 0) {
      audit({
        level: 'info',
        category: 'action',
        event: 'dream_curation_completed',
        details: { memoriesFound: 0, curated: 0, username },
        actor: 'dreamer',
      });
      return { memories: [], count: 0, username };
    }

    for (const filepath of episodicFiles) {
      try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const memory = JSON.parse(content) as Memory;

        // Skip dreams, reflections, and inner dialogue (avoid self-referential content)
        const type = memory.type || memory.metadata?.type;
        if (type === 'dream' || type === 'reflection' || type === 'inner_dialogue') continue;

        // Calculate age in days
        const memoryDate = new Date(memory.timestamp);
        if (Number.isNaN(memoryDate.getTime())) continue;
        const ageInMs = now.getTime() - memoryDate.getTime();
        const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));

        // Exponential decay weighting
        const weight = Math.exp(-ageInDays / decayDays);

        memories.push({ ...memory, weight, age: ageInDays });
      } catch (error) {
        const err = error as Error;
        if (!err.message.includes('Unexpected token')) {
          console.warn(`[DreamerMemoryCurator] Could not parse ${path.basename(filepath)}:`, err.message);
        }
      }
    }

    if (memories.length === 0) {
      audit({
        level: 'info',
        category: 'action',
        event: 'dream_curation_completed',
        details: { memoriesFound: 0, curated: 0, username },
        actor: 'dreamer',
      });
      return { memories: [], count: 0, username };
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

    // Calculate stats about memory ages selected
    const ages = curated.map(m => {
      const memDate = new Date(m.timestamp);
      const ageMs = now.getTime() - memDate.getTime();
      return Math.floor(ageMs / (1000 * 60 * 60 * 24));
    });
    const avgAgeDays = ages.length > 0 ? Math.floor(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    const oldestAgeDays = ages.length > 0 ? Math.max(...ages) : 0;

    audit({
      level: 'info',
      category: 'action',
      event: 'dream_curation_completed',
      details: {
        memoriesFound: memories.length,
        curated: curated.length,
        avgAgeDays,
        oldestAgeDays,
        scope: 'lifetime',
        username,
      },
      actor: 'dreamer',
    });

    console.log(`[DreamerMemoryCurator] Curated ${curated.length} memories (avg age: ${avgAgeDays} days, oldest: ${oldestAgeDays} days)`);

    return {
      memories: curated,
      count: curated.length,
      avgAgeDays,
      oldestAgeDays,
      username,
    };
  } catch (error) {
    console.error('[DreamerMemoryCurator] Error:', error);
    return {
      memories: [],
      count: 0,
      error: (error as Error).message,
      username,
    };
  }
};

/**
 * Dreamer Dream Generator Node
 *
 * Generates a surreal dream narrative from memory fragments using LLM.
 * Dreams are metaphorical, symbolic, and break logical constraints.
 *
 * Inputs:
 *   - [0] memories: Curated memory objects from dreamer_memory_curator
 *   - [1] personaPrompt: Formatted persona string from persona_formatter (optional)
 *
 * Properties:
 *   - temperature: LLM temperature (default: 1.0 for maximum creativity)
 *   - role: LLM role (default: persona)
 *
 * Outputs:
 *   - dream: Generated dream text
 *   - memoryCount: Number of memories used
 */
export const dreamerDreamGeneratorExecutor: NodeExecutor = async (inputs, context, properties) => {
  const memoriesInput = inputs[0]?.memories || inputs[0] || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const personaPrompt = inputs[1]?.formatted || inputs[1] || '';
  const temperature = properties?.temperature || 1.0;
  const role = properties?.role || 'persona';
  const username = context.userId || context.username;

  if (memories.length < 3) {
    console.log('[DreamerDreamGenerator] Not enough memory fragments to form a dream.');
    return {
      dream: null,
      error: 'Not enough memories (need at least 3)',
      memoryCount: memories.length,
    };
  }

  const memoriesText = memories
    .map((m: Memory) => `- A fragment: ${(m.content || '').substring(0, 300)}`)
    .join('\n');

  const systemPrompt = `${personaPrompt ? personaPrompt + '\n\n' : ''}You are the dreamer. You are processing recent experiences into a surreal, metaphorical dream.
Do not be literal. Weave the following memory fragments into an unbound dream narrative.
Use symbolism, look for unexpected connections, break logic, merge impossible things.
The output should feel like a dream—no rules, no structure, pure subconscious flow.
Start the dream directly, without any preamble. Let it be as long or short as it needs to be.`.trim();

  const userPrompt = `Memory Fragments:\n${memoriesText}`;

  try {
    markBackgroundActivity();

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await callLLM({
      role,
      messages,
      options: { temperature },
    });

    const dream = response.content.trim();

    if (!dream) {
      return {
        dream: null,
        error: 'LLM returned empty dream',
        memoryCount: memories.length,
      };
    }

    return {
      dream,
      memoryCount: memories.length,
      sourceIds: memories.map((m: Memory) => m.id).filter(Boolean),
      username,
    };
  } catch (error) {
    console.error('[DreamerDreamGenerator] Error while generating dream:', error);
    return {
      dream: null,
      error: (error as Error).message,
      memoryCount: memories.length,
    };
  }
};

/**
 * Dreamer Dream Saver Node
 *
 * Saves generated dream to episodic memory as type 'dream'.
 * Also emits audit event for SSE streaming to web UI.
 *
 * Inputs:
 *   - [0] dreamData: Object with dream text from dreamer_dream_generator
 *   - [1] memoriesData: Object with source memories for citations (optional)
 *
 * Properties:
 *   - type: Memory type (default: 'dream')
 *
 * Outputs:
 *   - saved: boolean
 *   - eventId: ID of saved event
 */
export const dreamerDreamSaverExecutor: NodeExecutor = async (inputs, context, properties) => {
  const dreamInput = inputs[0];
  const dream = dreamInput?.dream || dreamInput;
  const sourceIds = dreamInput?.sourceIds || inputs[1]?.memories?.map((m: Memory) => m.id) || [];
  const username = context.userId || context.username;
  const type = properties?.type || 'dream';

  if (!dream || typeof dream !== 'string') {
    return {
      saved: false,
      error: 'No dream content provided',
    };
  }

  try {
    markBackgroundActivity();

    // Capture as episodic event
    const eventId = await captureEvent(dream, {
      type,
      sources: sourceIds,
      confidence: 0.7,
    });

    // Emit audit event for logging/debugging
    audit({
      level: 'info',
      category: 'decision',
      event: 'dream_generated',
      message: 'Dreamer generated new dream',
      details: {
        dream,
        sourceCount: sourceIds.length,
        username,
      },
      metadata: { dream },
      actor: 'dreamer',
    });

    // Write to conversation buffer so UI can load without polling
    // This eliminates the need for reflections/stream.ts SSE polling
    if (username) {
      appendDreamToBuffer(username, dream);
    }

    console.log(`[DreamerDreamSaver] Dream saved with ${sourceIds.length} source citations`);

    return {
      saved: true,
      eventId,
      dream,
      sourceCount: sourceIds.length,
      username,
    };
  } catch (error) {
    console.error('[DreamerDreamSaver] Error saving dream:', error);
    return {
      saved: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Dreamer Continuation Generator Node
 *
 * Generates continuation dreams that build on previous dream narrative.
 * Uses probability-based decision to continue or stop.
 *
 * Inputs:
 *   - [0] previousDream: Object with dream text from previous node
 *
 * Properties:
 *   - temperature: LLM temperature (default: 1.0)
 *   - continuationChance: Probability to continue (default: 0.75)
 *   - maxContinuations: Maximum continuation dreams (default: 4)
 *   - delaySeconds: Delay between continuations (default: 60)
 *
 * Outputs:
 *   - dreams: Array of continuation dreams
 *   - count: Number of continuations generated
 */
export const dreamerContinuationGeneratorExecutor: NodeExecutor = async (inputs, context, properties) => {
  const previousDreamInput = inputs[0];
  let lastDream = previousDreamInput?.dream || previousDreamInput;
  const username = context.userId || context.username;
  const temperature = properties?.temperature || 1.0;
  const continuationChance = properties?.continuationChance || 0.75;
  const maxContinuations = properties?.maxContinuations || 4;
  const delaySeconds = properties?.delaySeconds || 60;

  if (!lastDream || typeof lastDream !== 'string') {
    return {
      dreams: [],
      count: 0,
      error: 'No initial dream provided',
    };
  }

  const dreams: string[] = [];
  let continuationIndex = 0;

  const systemPrompt = `You are continuing a surreal dream sequence. You only see the previous dream fragment—use it as inspiration,
but feel free to drift, fracture, merge, or completely transform. No coherence required.
Let the symbols mutate, emotions shift unexpectedly, logic dissolve. Dreams don't follow rules.
Do not summarize; let one dream bleed into another. No length limits.`.trim();

  try {
    while (continuationIndex < maxContinuations) {
      const roll = Math.random();
      console.log(`[DreamerContinuation] Continuation roll: ${roll.toFixed(2)} (threshold ${1 - continuationChance})`);

      if (roll >= continuationChance) {
        console.log(`[DreamerContinuation] Stopping continuations (roll ${roll.toFixed(2)} >= ${continuationChance})`);
        break;
      }

      // Wait before generating next dream
      if (delaySeconds > 0) {
        console.log(`[DreamerContinuation] Waiting ${delaySeconds} seconds before continuation ${continuationIndex + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        markBackgroundActivity();
      }

      const userPrompt = `Previous Dream Fragment:\n${lastDream}\n\nLet the dream continue, building on this fragment alone.`;

      const messages: RouterMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const response = await callLLM({
        role: 'persona',
        messages,
        options: { temperature },
      });

      const continuation = response.content.trim();
      if (!continuation) break;

      lastDream = continuation;
      dreams.push(continuation);
      continuationIndex++;

      // Save continuation dream
      await captureEvent(continuation, {
        type: 'dream',
        continuation: true,
        confidence: 0.6,
        sources: [],
        parentDream: dreams[dreams.length - 2] || lastDream,
      });

      audit({
        level: 'info',
        category: 'decision',
        event: 'dream_continuation_generated',
        details: {
          continuationIndex,
          length: continuation.length,
          username,
        },
        metadata: { dream: continuation },
        actor: 'dreamer',
      });

      console.log(`[DreamerContinuation] Continuation dream ${continuationIndex} generated`);
    }

    return {
      dreams,
      count: dreams.length,
      username,
    };
  } catch (error) {
    console.error('[DreamerContinuation] Error:', error);
    return {
      dreams,
      count: dreams.length,
      error: (error as Error).message,
      username,
    };
  }
};

/**
 * Dreamer Learnings Extractor Node
 *
 * Extracts preferences, heuristics, style notes, and avoidances from memories.
 *
 * Inputs:
 *   - [0] memoriesData: Object with curated memories from dreamer_memory_curator
 *
 * Properties:
 *   - temperature: LLM temperature (default: 0.3)
 *   - role: LLM role (default: persona)
 *
 * Outputs:
 *   - preferences: Array of preference strings
 *   - heuristics: Array of decision heuristic strings
 *   - styleNotes: Array of style note strings
 *   - avoidances: Array of avoidance strings
 */
export const dreamerLearningsExtractorExecutor: NodeExecutor = async (inputs, context, properties) => {
  const memoriesInput = inputs[0]?.memories || inputs[0] || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const temperature = properties?.temperature || 0.3;
  const role = properties?.role || 'persona';
  const username = context.userId || context.username;

  if (memories.length === 0) {
    return {
      preferences: [],
      heuristics: [],
      styleNotes: [],
      avoidances: [],
      error: 'No memories provided',
    };
  }

  const memoriesText = memories
    .map((m: Memory) => `[${m.timestamp}] ${m.content}`)
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
    markBackgroundActivity();

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await callLLM({
      role,
      messages,
      options: { temperature },
    });

    const parsed = JSON.parse(response.content) as {
      preferences: string[];
      heuristics: string[];
      styleNotes: string[];
      avoidances: string[];
    };

    console.log(`[DreamerLearningsExtractor] Extracted ${parsed.preferences?.length || 0} preferences, ${parsed.heuristics?.length || 0} heuristics`);

    return {
      preferences: parsed.preferences || [],
      heuristics: parsed.heuristics || [],
      styleNotes: parsed.styleNotes || [],
      avoidances: parsed.avoidances || [],
      memoryCount: memories.length,
      username,
    };
  } catch (error) {
    console.error('[DreamerLearningsExtractor] Error extracting learnings:', error);
    return {
      preferences: [],
      heuristics: [],
      styleNotes: [],
      avoidances: [],
      error: (error as Error).message,
      username,
    };
  }
};

/**
 * Dreamer Learnings Writer Node
 *
 * Writes overnight learnings to procedural memory as markdown file.
 *
 * Inputs:
 *   - [0] learningsData: Object with preferences, heuristics, etc from extractor
 *   - [1] memoriesData: Object with memories for citations (optional)
 *
 * Properties: None
 *
 * Outputs:
 *   - written: boolean
 *   - filepath: Path to written file
 */
export const dreamerLearningsWriterExecutor: NodeExecutor = async (inputs, context) => {
  const learnings = inputs[0] || {};
  const memoriesInput = inputs[1]?.memories || inputs[0]?.memories || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const username = context.userId || context.username;

  const preferences = learnings.preferences || [];
  const heuristics = learnings.heuristics || [];
  const styleNotes = learnings.styleNotes || [];
  const avoidances = learnings.avoidances || [];

  // Check if there's anything to write
  if (preferences.length === 0 && heuristics.length === 0 && styleNotes.length === 0 && avoidances.length === 0) {
    console.log('[DreamerLearningsWriter] No learnings to write');
    return {
      written: false,
      error: 'No learnings to write',
    };
  }

  try {
    const profilePaths = username ? getProfilePaths(username) : null;
    const proceduralDir = profilePaths
      ? path.join(profilePaths.root, 'memory', 'procedural', 'overnight')
      : paths.proceduralOvernight;

    // Ensure directory exists
    fs.mkdirSync(proceduralDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const filename = `overnight-learnings-${date.replace(/-/g, '')}.md`;
    const filepath = path.join(proceduralDir, filename);
    const memoryCitations = memories.map((m: Memory) => m.id).filter(Boolean);

    const content = `# Overnight Learnings — ${date}

Generated from ${memoryCitations.length} recent memories during the nightly sleep cycle.

## Preferences
${preferences.length > 0 ? preferences.map((p: string) => `- ${p}`).join('\n') : '- None extracted'}

## Decision Heuristics
${heuristics.length > 0 ? heuristics.map((h: string) => `- ${h}`).join('\n') : '- None extracted'}

## Writing Style Notes
${styleNotes.length > 0 ? styleNotes.map((s: string) => `- ${s}`).join('\n') : '- None extracted'}

## Avoidances
${avoidances.length > 0 ? avoidances.map((a: string) => `- ${a}`).join('\n') : '- None extracted'}

## Citations
${memoryCitations.map((id: string) => `- ${id}`).join('\n') || '- No citations'}

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
        preferencesCount: preferences.length,
        heuristicsCount: heuristics.length,
        styleNotesCount: styleNotes.length,
        avoidancesCount: avoidances.length,
        citations: memoryCitations.length,
        username,
      },
      actor: 'dreamer',
    });

    console.log(`[DreamerLearningsWriter] Overnight learnings written: ${filename}`);

    return {
      written: true,
      filepath,
      filename,
      date,
      username,
    };
  } catch (error) {
    console.error('[DreamerLearningsWriter] Error writing learnings:', error);
    return {
      written: false,
      error: (error as Error).message,
    };
  }
};
