/**
 * Train of Thought Agent
 *
 * A standalone agent that performs recursive reasoning by following memory associations.
 * One thought triggers related thoughts until natural conclusion.
 *
 * Can be triggered:
 * 1. Directly via CLI: ./bin/mh agent run train-of-thought
 * 2. From reflector agent (via agent_trigger node)
 * 3. From inner-curiosity for deeper exploration
 * 4. Programmatically via executeTrainOfThought()
 */

import {
  ROOT,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  executeGraph,
  validateCognitiveGraph,
  type CognitiveGraph,
} from '../../packages/core/src/index';
import fs from 'node:fs/promises';
import path from 'node:path';

// Technical keywords to deprioritize
const technicalKeywords = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'train-of-thought',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
];

/**
 * Load the train-of-thought cognitive graph
 */
async function loadTrainOfThoughtGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'train-of-thought.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

/**
 * Get all episodic memories for weighted sampling
 */
async function getAllMemories(episodicDir: string) {
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
function extractKeywords(memory: any): string[] {
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
function selectSeedMemory(memories: Array<{ file: string; timestamp: Date; content: any }>): any | null {
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
async function executeTrainOfThoughtForUser(username: string): Promise<{
  success: boolean;
  thoughtCount?: number;
  insight?: string;
  error?: string;
}> {
  console.log(`[train-of-thought] Starting for user: ${username}`);

  try {
    // Get user-specific paths
    const userRoot = path.join(ROOT, 'profiles', username);
    const episodicDir = path.join(userRoot, 'memory', 'episodic');

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
    // GraphExecutionState has `nodes` map with NodeExecutionState which has `outputs`
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
}

/**
 * Main entry point - runs train of thought for all logged-in users
 */
async function main() {
  initGlobalLogger();
  console.log('[train-of-thought] Starting train of thought cycle...');

  // Check lock
  if (isLocked('train-of-thought')) {
    console.log('[train-of-thought] Another instance is already running');
    process.exit(0);
  }

  const lockHandle = acquireLock('train-of-thought');

  try {
    // Get all users
    const users = listUsers();
    const loggedInUsers = users.filter(u => u.role !== 'anonymous');

    if (loggedInUsers.length === 0) {
      console.log('[train-of-thought] No logged-in users found');
      return;
    }

    console.log(`[train-of-thought] Processing ${loggedInUsers.length} user(s)...`);

    for (const user of loggedInUsers) {
      await withUserContext(
        { userId: user.id, username: user.username, role: user.role },
        async () => {
          await executeTrainOfThoughtForUser(user.username);
        }
      );
    }

    console.log('[train-of-thought] Cycle complete.');
  } catch (error) {
    console.error('[train-of-thought] Fatal error:', error);
    audit({
      level: 'error',
      category: 'system',
      event: 'train_of_thought_error',
      actor: 'train-of-thought',
      details: { error: (error as Error).message },
    });
  } finally {
    lockHandle.release();
  }
}

// Export for programmatic use
export { executeTrainOfThoughtForUser, loadTrainOfThoughtGraph };

// Run if executed directly
main().catch(console.error);
