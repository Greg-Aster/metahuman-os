/**
 * Train of Thought Agent — Core Logic
 *
 * Performs recursive reasoning by following memory associations.
 * One thought triggers related thoughts until natural conclusion.
 *
 * Can be triggered:
 * 1. Directly via CLI
 * 2. From reflector agent (via agent_trigger node)
 * 3. From inner-curiosity for deeper exploration
 * 4. Programmatically via executeTrainOfThoughtForUser()
 *
 * This module provides:
 * - executeTrainOfThoughtForUser() for single-user processing
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  audit,
  getLoggedInUsers,
  withUserContext,
  executeGraph,
  validateCognitiveGraph,
  systemPaths,
  getProfilePaths,
  type CognitiveGraph,
} from '@metahuman/core';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TrainOfThoughtOptions {
  singleUser?: boolean;
  username?: string;
}

export interface TrainOfThoughtResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: Record<string, UserThoughtStats>;
}

export interface UserThoughtStats {
  success: boolean;
  thoughtCount?: number;
  insight?: string;
  error?: string;
}

// Technical keywords to deprioritize
const technicalKeywords = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'train-of-thought',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
];

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

/**
 * Load the train-of-thought cognitive graph
 */
export async function loadTrainOfThoughtGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(systemPaths.etc, 'cognitive-graphs', 'train-of-thought.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

/**
 * Get all episodic memories for weighted sampling
 */
export async function getAllMemories(episodicDir: string) {
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

          // Skip self-referential content (avoid echo chamber)
          if (content.type === 'reflection' || content.type === 'inner_dialogue' ||
              content.type === 'train-of-thought' || content.type === 'dream') {
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
 * Extract keywords from memory for associative linking
 */
export function extractKeywords(memory: any): string[] {
  const content = memory.content || '';
  const tags = memory.tags || [];
  const entities = (memory.entities || []).map((e: any) => e.text || e.name || e);

  // Extract capitalized words from content (proper nouns, concepts)
  const contentWords = content
    .split(/\s+/)
    .filter((w: string) => /^[A-Z][a-z]+/.test(w) && w.length > 2)
    .slice(0, 5);

  const allKeywords = [...tags, ...entities, ...contentWords];

  // Filter out technical keywords (deprioritize, don't exclude)
  return allKeywords.filter((kw: string) =>
    !technicalKeywords.some(tech => kw.toLowerCase().includes(tech.toLowerCase()))
  );
}

/**
 * Select a seed memory using weighted random sampling
 * Uses exponential decay so older memories can still surface
 */
export function selectSeedMemory(memories: Array<{ file: string; timestamp: Date; content: any }>): any | null {
  if (memories.length === 0) return null;

  const now = Date.now();
  const decayFactor = 14; // Days for weight halving

  // Calculate weights
  const weights = memories.map(m => {
    const ageInDays = (now - m.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-ageInDays / decayFactor);
  });

  // Normalize weights
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights = weights.map(w => w / totalWeight);

  // Weighted random selection
  const random = Math.random();
  let cumulative = 0;

  for (let i = 0; i < memories.length; i++) {
    cumulative += normalizedWeights[i];
    if (random <= cumulative) {
      return memories[i].content;
    }
  }

  return memories[0].content;
}

/**
 * Execute train of thought for a specific user
 */
export async function executeTrainOfThoughtForUser(username: string): Promise<UserThoughtStats> {
  return await withUserContext(username, async () => {
    console.log(`[train-of-thought] Starting for user: ${username}`);

    try {
      const profilePaths = getProfilePaths(username);
      const episodicDir = profilePaths.episodic;

      // Get all memories
      const memories = await getAllMemories(episodicDir);

      if (memories.length === 0) {
        console.log('[train-of-thought] No memories found');
        return { success: false, error: 'No memories available' };
      }

      // Select seed memory
      const seedMemory = selectSeedMemory(memories);
      if (!seedMemory) {
        return { success: false, error: 'Could not select seed memory' };
      }

      const seedContent = typeof seedMemory === 'string'
        ? seedMemory
        : seedMemory.content || JSON.stringify(seedMemory);

      console.log(`[train-of-thought] Selected seed memory: ${seedContent.substring(0, 80)}...`);

      // Load and execute the cognitive graph
      const graph = await loadTrainOfThoughtGraph();

      const context = {
        userId: username,
        allowMemoryWrites: true,
        cognitiveMode: 'agent' as const,
        seedMemory: seedContent,
        keywords: extractKeywords(seedMemory),
      };

      console.log('[train-of-thought] Executing cognitive graph...');

      const result = await executeGraph(graph, context);

      // Extract results from graph execution
      const aggregatorState = result.nodes.get(8); // Node 8 is thought_aggregator
      const aggregatorOutput = aggregatorState?.outputs;
      const thoughtCount = aggregatorOutput?.thoughtCount || 0;
      const insight = aggregatorOutput?.insight || '';

      audit({
        level: 'info',
        category: 'decision',
        event: 'train_of_thought_complete',
        actor: 'train-of-thought',
        details: {
          username,
          thoughtCount,
          insightPreview: insight.substring(0, 100),
          seedMemoryPreview: seedContent.substring(0, 50),
        },
      });

      console.log(`[train-of-thought] Complete. Generated ${thoughtCount} thoughts.`);

      return {
        success: true,
        thoughtCount,
        insight,
      };
    } catch (error) {
      console.error('[train-of-thought] Error:', error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Run train of thought cycle for all users (CLI usage)
 */
export async function runCycle(options: TrainOfThoughtOptions = {}): Promise<TrainOfThoughtResult> {
  const result: TrainOfThoughtResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: {},
  };

  try {
    // Get users to process
    let users: string[];

    if (options.username) {
      users = [options.username];
    } else if (options.singleUser) {
      users = ['default'];
    } else {
      const allUsers = getLoggedInUsers();
      users = allUsers.map(u => u.username);
    }

    if (users.length === 0) {
      console.log('[train-of-thought] No users found');
      return result;
    }

    console.log(`[train-of-thought] Processing ${users.length} user(s)...`);

    for (const username of users) {
      try {
        const stats = await executeTrainOfThoughtForUser(username);
        result.stats[username] = stats;
        result.usersProcessed++;
      } catch (error) {
        const errorMsg = `Error processing ${username}: ${(error as Error).message}`;
        result.errors.push(errorMsg);
        console.error(`[train-of-thought] ${errorMsg}`);
      }
    }

    console.log('[train-of-thought] Cycle complete.');

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    console.error('[train-of-thought] Fatal error:', error);
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

  // Extract username from args or options
  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: TrainOfThoughtOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  // If context has a specific user, process only that user
  if (ctx.userId && !options.username) {
    options.username = ctx.userId;
  }

  if (options.username) {
    try {
      const stats = await executeTrainOfThoughtForUser(options.username);

      return {
        success: stats.success,
        data: {
          user: options.username,
          thoughtCount: stats.thoughtCount,
          insight: stats.insight,
        },
        error: stats.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Otherwise run full cycle
  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      stats: result.stats,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
