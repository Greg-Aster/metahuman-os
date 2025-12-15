/**
 * Reflector Agent — Core Logic
 *
 * Generates internal reflections from associative memory chains:
 * - Picks a seed memory using weighted random selection
 * - Follows keyword connections to build a chain of related memories
 * - Uses LLM to generate an introspective reflection
 * - Saves as inner_dialogue type (never shown in main chat)
 *
 * This module can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  searchMemory,
  storageClient,
  ROOT,
  audit,
  listActiveTasks,
  listUsers,
  withUserContext,
  executeGraph,
  validateCognitiveGraph,
  getActiveBackend,
  type CognitiveGraph,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// Train of Thought integration
import { executeTrainOfThoughtForUser } from '../train-of-thought.js';

// ============================================================================
// Configuration
// ============================================================================

// Technical keywords to deprioritize (not exclude, just lower weight)
const technicalKeywords = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
];

export interface ReflectorOptions {
  useTrainOfThought?: boolean;
  chainLength?: number;
  singleUser?: boolean;
}

export interface ReflectorResult {
  success: boolean;
  reflectionsGenerated: number;
  userCount: number;
  errors: string[];
}

// ============================================================================
// Cognitive Graph Loading
// ============================================================================

async function loadReflectorGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'reflector-mode.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

// ============================================================================
// Memory Functions
// ============================================================================

/**
 * Get ALL memories (no pool limit)
 */
export async function getAllMemories() {
  const result = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  if (!result.success || !result.path) {
    console.error('[reflector] Cannot resolve episodic path');
    return [];
  }
  const episodicDir = result.path;

  async function walk(dir: string, acc: Array<{ file: string; timestamp: Date; content: any }>) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
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
        await walk(fullPath, acc);
      } else if (stats.isFile() && entry.endsWith('.json')) {
        try {
          const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));

          // Skip self-referential reflections and inner dialogue
          if (content.type === 'reflection' || content.type === 'inner_dialogue' ||
              content.metadata?.type === 'reflection' || content.metadata?.type === 'inner_dialogue') {
            continue;
          }

          acc.push({
            file: fullPath,
            timestamp: new Date(content.timestamp),
            content
          });
        } catch {
          // Skip malformed files
        }
      }
    }
  }

  const allMemories: Array<{ file: string; timestamp: Date; content: any }> = [];
  await walk(episodicDir, allMemories);

  // Sort by timestamp (newest first)
  allMemories.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return allMemories;
}

/**
 * Extract key concepts/entities from a memory
 */
export function extractKeywords(memory: any): string[] {
  const content = memory.content || '';
  const tags = memory.tags || [];
  const entities = memory.entities || [];

  const keywords = [...tags, ...entities.map((e: any) => e.text?.toLowerCase()).filter(Boolean)];

  if (content && typeof content === 'string') {
    const words = content.match(/\b[A-Z][a-z]+\b/g) || [];
    keywords.push(...words.map((w: string) => w.toLowerCase()));
  }

  const stopWords = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'been'];
  const unique = [...new Set(keywords)].filter(kw =>
    kw &&
    typeof kw === 'string' &&
    kw.length > 2 &&
    !stopWords.includes(kw) &&
    !technicalKeywords.some(tech => kw.includes(tech))
  );

  return unique.slice(0, 5);
}

/**
 * Build associative memory chain
 */
export async function getAssociativeMemoryChain(chainLength: number = 3): Promise<any[]> {
  const allMemories = await getAllMemories();
  if (allMemories.length === 0) return [];

  const chain: any[] = [];
  const usedFiles = new Set<string>();

  // Weighted random selection for seed
  const now = Date.now();
  const decayFactor = 14;

  const weights = allMemories.map(mem => {
    const ageInDays = (now - mem.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    let weight = Math.exp(-ageInDays / decayFactor);

    const contentLower = mem.content.content?.toLowerCase() || '';
    const isTechnical = technicalKeywords.some(kw => contentLower.includes(kw));
    if (isTechnical) {
      weight *= 0.3;
    }

    return weight;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let rand = Math.random() * totalWeight;
  let cumulativeWeight = 0;

  let seedMemory = allMemories[0];
  for (let i = 0; i < allMemories.length; i++) {
    cumulativeWeight += weights[i];
    if (rand <= cumulativeWeight) {
      seedMemory = allMemories[i];
      break;
    }
  }

  const seedEvent = { ...seedMemory.content, __file: seedMemory.file };
  chain.push(seedEvent);
  usedFiles.add(seedMemory.file);

  console.log(`[reflector] Seed: "${seedMemory.content.content?.substring(0, 60)}..."`);

  // Follow associative links
  for (let i = 1; i < chainLength; i++) {
    const lastMemory = chain[chain.length - 1];
    const keywords = extractKeywords(lastMemory);

    if (keywords.length === 0) {
      console.log(`[reflector] No keywords found, stopping chain at ${i} memories`);
      break;
    }

    console.log(`[reflector] Searching for: ${keywords.slice(0, 3).join(', ')}...`);

    let relatedMemoryPaths: string[] = [];
    for (const keyword of keywords) {
      try {
        const results = searchMemory(keyword);
        relatedMemoryPaths.push(...results);
      } catch {
        // Ignore search errors
      }
    }

    let relatedMemories: any[] = [];
    for (const relPath of relatedMemoryPaths) {
      const fullPath = path.join(ROOT, relPath);
      if (usedFiles.has(fullPath)) continue;

      try {
        const memContent = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
        (memContent as any).__file = fullPath;
        if (memContent.type !== 'reflection' && memContent.type !== 'inner_dialogue' &&
            memContent.metadata?.type !== 'reflection' && memContent.metadata?.type !== 'inner_dialogue') {
          relatedMemories.push(memContent);
        }
      } catch {
        // Skip invalid files
      }
    }

    if (relatedMemories.length === 0) {
      console.log(`[reflector] No related memories found, stopping chain at ${i} memories`);
      break;
    }

    const nextMemory = relatedMemories[Math.floor(Math.random() * Math.min(10, relatedMemories.length))];
    const nextFilePath = (nextMemory as any).__file as string | undefined;

    chain.push(nextMemory);
    if (nextFilePath) {
      usedFiles.add(nextFilePath);
    }

    console.log(`[reflector] Found: "${nextMemory.content?.substring(0, 60)}..."`);
  }

  console.log(`[reflector] Built chain of ${chain.length} associated memories`);
  return chain;
}

// ============================================================================
// Reflection Generation
// ============================================================================

/**
 * Generate reflection for a single user
 */
export async function generateUserReflection(
  username: string,
  options: ReflectorOptions = {}
): Promise<boolean> {
  console.log(`[reflector] Processing user: ${username}`);

  // Option: Use recursive train-of-thought
  if (options.useTrainOfThought) {
    console.log('[reflector] Using train-of-thought mode');
    const result = await executeTrainOfThoughtForUser(username);
    if (result.success) {
      console.log(`[reflector] Train of thought complete: ${result.thoughtCount} thoughts`);
      return true;
    } else {
      console.log(`[reflector] Train of thought failed: ${result.error}`);
      return false;
    }
  }

  // Default: Use associative chain
  const chainLength = options.chainLength || (Math.floor(Math.random() * 3) + 3);
  const recentMemories = await getAssociativeMemoryChain(chainLength);

  if (recentMemories.length === 0) {
    console.log('[reflector] Not enough memories to reflect on yet.');
    audit({
      category: 'action',
      level: 'info',
      message: 'Reflector agent: insufficient memories to reflect',
      actor: 'reflector',
      metadata: { memoriesFound: 0 }
    });
    return false;
  }

  let systemPrompt: string;
  let prompt: string;

  audit({
    category: 'action',
    level: 'info',
    message: `Reflector analyzing: ${recentMemories.length} memories`,
    actor: 'reflector',
    metadata: { memoriesAnalyzed: recentMemories.length, thinking: true }
  });

  if (recentMemories.length === 1) {
    const singleMemory = recentMemories[0];
    const memoryText = singleMemory.content;

    systemPrompt = `
      You are Greg's inner voice, spontaneously reflecting on a memory that surfaced.
      Write a natural, stream-of-consciousness reflection in first person.
      Let your thoughts flow freely - they can be short or long.
      Stay grounded in the actual memory content, but explore your feelings, questions, or insights.
      This is an intimate, private thought - be authentic.
    `.trim();

    prompt = `
A memory just surfaced:
"${memoryText}"

What comes to mind?
    `.trim();
  } else {
    const memoriesText = recentMemories
      .map((m, i) => `${i + 1}. ${m.content}`)
      .join('\n\n');

    systemPrompt = `
      You are Greg's inner voice, spontaneously connecting memories that surfaced together.
      Write a natural, stream-of-consciousness reflection in first person.
      Explore patterns, feelings, questions, or insights that emerge.
      Don't feel obligated to connect everything perfectly - sometimes thoughts wander.
      This is intimate, private thinking - be authentic.
    `.trim();

    prompt = `
These memories surfaced together in my mind:

${memoriesText}

What am I noticing? What thoughts or feelings are emerging?
    `.trim();
  }

  try {
    const graph = await loadReflectorGraph();

    const reflectionWordCount = prompt.split(/\s+/).filter(Boolean).length;
    const chainIsLong = recentMemories.length >= 3;
    const conciseHint = chainIsLong || reflectionWordCount > 180
      ? 'Keep the response under two sentences (<= 60 words).'
      : 'Keep it to one short sentence (<= 25 words).';

    const graphContext = {
      userId: username,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
      reflectionPrompt: prompt,
      reflectionSystemPrompt: systemPrompt,
      conciseHint,
      reflectionWordCount,
      chainIsLong,
    };

    const graphResult = await executeGraph(graph, graphContext);

    const reflectionNode = graphResult.nodes.get(1);
    const reflection = (reflectionNode?.output?.response || '').trim();

    if (reflection) {
      console.log(`[reflector] Generated: "${reflection.substring(0, 80)}..."`);

      let tasksCount = 0;
      try {
        const tasks = listActiveTasks();
        tasksCount = Array.isArray(tasks) ? tasks.length : 0;
      } catch {}

      audit({
        category: 'decision',
        level: 'info',
        message: 'Reflector generated new insight',
        actor: 'reflector',
        metadata: {
          reflectionPreview: reflection.substring(0, 100) + (reflection.length > 100 ? '...' : ''),
          memoriesConsidered: recentMemories.length,
          tasksConsidered: tasksCount,
          usedGraph: true,
        }
      });
      return true;
    } else {
      console.log('[reflector] Generated empty reflection.');
      audit({
        category: 'action',
        level: 'warn',
        message: 'Reflector generated empty reflection',
        actor: 'reflector'
      });
      return false;
    }
  } catch (error) {
    console.error(`[reflector] Error generating reflection:`, error);
    audit({
      category: 'system',
      level: 'error',
      message: `Reflector error: ${(error as Error).message}`,
      actor: 'reflector',
      metadata: { error: (error as Error).stack }
    });
    return false;
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full reflection cycle (multi-user)
 */
export async function runCycle(options: ReflectorOptions = {}): Promise<ReflectorResult> {
  console.log('[reflector] Starting cycle...');

  audit({
    category: 'action',
    level: 'info',
    message: 'Reflector agent starting',
    actor: 'reflector',
    metadata: { mode: options.singleUser ? 'single-user' : 'multi-user' }
  });

  const result: ReflectorResult = {
    success: false,
    reflectionsGenerated: 0,
    userCount: 0,
    errors: [],
  };

  try {
    const backend = getActiveBackend();
    console.log(`[reflector] Using LLM backend: ${backend}`);
  } catch {
    console.log('[reflector] Using model router');
  }

  try {
    const users = listUsers();
    console.log(`[reflector] Found ${users.length} users to process`);
    result.userCount = users.length;

    for (const user of users) {
      try {
        const success = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => generateUserReflection(user.username, options)
        );

        if (success) {
          result.reflectionsGenerated++;
        }
      } catch (error) {
        const errorMsg = `User ${user.username}: ${(error as Error).message}`;
        console.error(`[reflector] Failed: ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log(`[reflector] Cycle finished. Generated ${result.reflectionsGenerated} reflections.`);

    audit({
      category: 'action',
      level: 'info',
      message: 'Reflector agent completed',
      actor: 'reflector',
      metadata: {
        reflectionsGenerated: result.reflectionsGenerated,
        userCount: result.userCount,
      }
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[reflector] Cycle error:', errorMsg);

    audit({
      category: 'system',
      level: 'error',
      message: `Reflector cycle error: ${errorMsg}`,
      actor: 'reflector'
    });

    result.errors.push(errorMsg);
    return result;
  }
}

// ============================================================================
// Agent Runtime Interface
// ============================================================================

/**
 * Run function for agent-runtime
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: ReflectorOptions = {
    useTrainOfThought: args.includes('--train-of-thought') || opts.useTrainOfThought === true,
    singleUser: args.includes('--single-user') || opts.singleUser === true,
  };

  // Parse chain length from args
  const chainArg = args.find(a => a.startsWith('--chain='));
  if (chainArg) {
    options.chainLength = parseInt(chainArg.split('=')[1], 10);
  }

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const success = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => generateUserReflection(ctx.username, options)
      );

      return {
        success,
        data: { reflectionsGenerated: success ? 1 : 0, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: success ? 1 : 0,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.reflectionsGenerated,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
