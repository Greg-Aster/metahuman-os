/**
 * Curator Agent — Core Logic
 *
 * Prepares clean, persona-friendly training data:
 * - Processes raw episodic memories into curated summaries (LLM-based)
 * - Removes tool syntax, JSON, and operator transcripts
 * - Extracts conversational essence for LoRA training
 * - Generates training-ready conversation pairs
 * - Flags sensitive data for review
 *
 * This module provides:
 * - runCuratorForUser() for single-user processing
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  withUserContext,
  executeGraph,
  validateSvelteFlowGraph,
  captureEvent,
  audit,
  getTargetUser,
  systemPaths,
  type SvelteFlowGraph,
} from '@metahuman/core';
import { registerAgent, unregisterAgent } from '@metahuman/core/agent-monitor';

const LOG_PREFIX = '[curator-core]';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CuratorOptions {
  singleUser?: boolean;
  username?: string;
}

export interface CuratorResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: Record<string, UserCuratorStats>;
}

export interface UserCuratorStats {
  memoriesProcessed: number;
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

/**
 * Load curator cognitive graph
 */
export async function loadCuratorGraph(): Promise<SvelteFlowGraph> {
  console.log(`${LOG_PREFIX} ========== loadCuratorGraph HIT ==========`);
  const graphPath = path.join(systemPaths.etc, 'cognitive-graphs', 'curator-mode.json');
  console.log(`${LOG_PREFIX} Loading curator graph from: ${graphPath}`);
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  // curator-mode.json is in Svelte Flow format - validate and return it directly
  return validateSvelteFlowGraph(parsed);
}

/**
 * Run curator for a single user
 */
export async function runCuratorForUser(username: string): Promise<UserCuratorStats> {
  console.log(`${LOG_PREFIX} ========== runCuratorForUser HIT ==========`);
  
  // Validate username for security (alphanumeric + underscore/hyphen only)
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
    throw new Error(`Invalid username format: ${username}`);
  }
  
  console.log(`${LOG_PREFIX} Input username: ${username}`);
  
  return await withUserContext(
    { userId: username, username: username, role: 'owner' },
    async () => {
    console.log(`${LOG_PREFIX} Processing user: ${username}`);

    // Register in agent monitor so it shows up while running
    registerAgent('curator', process.pid);

    try {
      // Load curator cognitive graph
      const graph = await loadCuratorGraph();

      // Execute graph with context
      const graphContext = {
        userId: username,
        allowMemoryWrites: true,
        cognitiveMode: 'dual' as const,
      };

      console.log(`${LOG_PREFIX} Executing curator workflow graph...`);
      const graphResult = await executeGraph(graph, graphContext);

      // Extract results from graph execution (node IDs are strings in Svelte Flow format)
      const curatorLLMNode = graphResult.nodes.get('4');
      const memoriesProcessed = curatorLLMNode?.outputs?.count || 0;

      console.log(`${LOG_PREFIX} ✅ Processed ${memoriesProcessed} memories`);

      // Save inner dialogue notification so user can see curation activity
      if (memoriesProcessed > 0) {
        const notification = `📚 Curated ${memoriesProcessed} ${memoriesProcessed === 1 ? 'memory' : 'memories'} for training data preparation.`;

        try {
          captureEvent(notification, {
            type: 'inner_dialogue',
            tags: ['curator', 'training-data', 'background-task'],
            metadata: {
              curator: {
                memoriesProcessed,
                timestamp: new Date().toISOString(),
              },
            },
          });
          console.log(`${LOG_PREFIX} Saved inner dialogue notification`);
        } catch (err) {
          console.warn(`${LOG_PREFIX} Failed to save inner dialogue:`, (err as Error).message);
        }
      }

      return {
        memoriesProcessed,
      };
    } finally {
      unregisterAgent('curator');
    }
  });
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Run curator cycle for all users (CLI usage)
 */
export async function runCycle(options: CuratorOptions = {}): Promise<CuratorResult> {
  console.log(`${LOG_PREFIX} ========== runCycle HIT ==========`);
  console.log(`${LOG_PREFIX} Input options:`, options);
  
  const result: CuratorResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: {},
  };

  try {
    // Get user to process
    let username: string | null = null;

    if (options.username) {
      username = options.username;
    } else if (options.singleUser) {
      username = 'default';
    } else {
      // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
      const activeUser = getTargetUser();
      if (activeUser) {
        username = activeUser.username;
      }
    }

    if (!username) {
      console.log(`${LOG_PREFIX} No active user found`);
      return result;
    }

    // Validate username for security (alphanumeric + underscore/hyphen only)
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
      const errorMsg = `Invalid username format: ${username}`;
      result.errors.push(errorMsg);
      console.error(`${LOG_PREFIX} ${errorMsg}`);
      result.success = false;
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${username}`);

    try {
      const stats = await runCuratorForUser(username);
      result.stats[username] = stats;
      result.usersProcessed++;

      audit({
        category: 'action',
        level: 'info',
        event: 'curator_completed',
        actor: 'curator',
        details: {
          username,
          memoriesProcessed: stats.memoriesProcessed,
        },
      });
    } catch (error) {
      const errorMsg = `Error processing ${username}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(`${LOG_PREFIX} ${errorMsg}`);

      audit({
        category: 'action',
        level: 'error',
        event: 'curator_failed',
        actor: 'curator',
        details: {
          username,
          error: (error as Error).message,
        },
      });
    }
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    console.error(`${LOG_PREFIX} Fatal error:`, error);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  console.log(`${LOG_PREFIX} ========== run HIT ==========`);
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};
  console.log(`${LOG_PREFIX} Agent context:`, { userId: ctx.userId });
  console.log(`${LOG_PREFIX} Input args:`, args);
  console.log(`${LOG_PREFIX} Input options:`, opts);

  // Extract username from args or options
  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  // Don't treat 'system' as a valid username - it's a placeholder from scheduler
  const effectiveUserId = ctx.userId !== 'system' ? ctx.userId : undefined;

  const options: CuratorOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || effectiveUserId,
  };

  // If context has a specific user, process only that user
  if (effectiveUserId && !options.username) {
    options.username = effectiveUserId;
  }

  // Only process single user if we have a real username
  if (options.username) {
    try {
      const stats = await runCuratorForUser(options.username);

      return {
        success: true,
        data: {
          user: options.username,
          stats,
        },
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
