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
  validateCognitiveGraph,
  audit,
  getLoggedInUsers,
  systemPaths,
  type CognitiveGraph,
} from '@metahuman/core';
import { registerAgent, unregisterAgent } from '@metahuman/core/agent-monitor';

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
export async function loadCuratorGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(systemPaths.etc, 'cognitive-graphs', 'curator-mode.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

/**
 * Run curator for a single user
 */
export async function runCuratorForUser(username: string): Promise<UserCuratorStats> {
  return await withUserContext(username, async () => {
    console.log(`[curator] Processing user: ${username}`);

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

      console.log('[curator] Executing curator workflow graph...');
      const graphResult = await executeGraph(graph, graphContext);

      // Extract results from graph execution
      const curatorLLMNode = graphResult.nodes.get(4);
      const memoriesProcessed = curatorLLMNode?.outputs?.count || 0;

      console.log(`[curator] ✅ Processed ${memoriesProcessed} memories`);

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
  const result: CuratorResult = {
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
      users = getLoggedInUsers().map(u => u.username);
    }

    for (const username of users) {
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
        console.error(`[curator] ${errorMsg}`);

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
    }
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    console.error('[curator] Fatal error:', error);
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
