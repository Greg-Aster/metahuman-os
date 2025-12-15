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
 * This module provides:
 * - generateDesiresForUser() for single-user processing
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  audit,
  getLoggedInUsers,
  withUserContext,
  getActiveBackend,
} from '@metahuman/core';

// Re-export the existing implementation
export {
  generateDesiresForUser,
  gatherInputs,
  identifyDesires,
  loadPersonaGoals,
  loadTasks,
  loadRecentMemories,
  loadCuriosityQuestions,
  loadReflections,
  loadDreams,
} from '../desire-generator.js';

import { generateDesiresForUser } from '../desire-generator.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

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
      console.log(`[desire-generator] Using LLM backend: ${backend}`);
    } catch {
      console.log('[desire-generator] Using model router (backend auto-selected)');
    }

    // Determine users to process
    let users: Array<{ userId: string; username: string; role: string }>;

    if (options.username) {
      users = [{ userId: options.username, username: options.username, role: 'owner' }];
    } else if (options.singleUser) {
      users = [{ userId: 'default', username: 'default', role: 'owner' }];
    } else {
      users = getLoggedInUsers();
    }

    console.log(`[desire-generator] Processing ${users.length} user(s)`);

    for (const user of users) {
      try {
        const created = await withUserContext(
          { userId: user.userId, username: user.username, role: user.role },
          async () => generateDesiresForUser(user.username)
        );

        result.stats[user.username] = created;
        result.totalGenerated += created;
        result.usersProcessed++;
      } catch (error) {
        const errorMsg = `Error processing ${user.username}: ${(error as Error).message}`;
        result.errors.push(errorMsg);
        console.error(`[desire-generator] ${errorMsg}`);
      }
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
    console.error('[desire-generator] Fatal error:', error);
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
