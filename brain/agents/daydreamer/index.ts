/**
 * Daydreamer Agent — Agent Runtime adapter
 *
 * The Work Coordinator launches cli.ts. This module provides the repository-
 * required in-process interface and delegates to the same core graph owner.
 */

import type {
  AgentContext,
  AgentInput,
  AgentMeta,
  AgentModule,
  AgentResult,
} from '@metahuman/agent-runtime';
import { getUserByUsername, withUserContext } from '@metahuman/core';
import { generateUserDaydream } from './core.js';

export const meta: AgentMeta = {
  id: 'daydreamer',
  name: 'Daydreamer',
  description: 'Creates brief internal daydreams during idle periods',
  usesLLM: true,
  priority: 'low',
  tags: ['dream', 'inner-dialogue', 'background'],
};

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const optionNames = Object.keys(input.options || {});
  if (args.length > 0 || optionNames.length > 0) {
    return {
      success: false,
      error: `Daydreamer does not accept runtime options: ${[...args, ...optionNames].join(', ')}`,
      duration: Date.now() - startTime,
    };
  }

  const user = getUserByUsername(ctx.username);
  if (!user) {
    return {
      success: false,
      error: `Daydreamer user does not exist: ${ctx.username}`,
      duration: Date.now() - startTime,
    };
  }

  try {
    const stats = await withUserContext(
      { userId: user.id, username: user.username, role: user.role },
      () => generateUserDaydream(user.username, ctx.signal),
    );
    return {
      success: true,
      data: { ...stats, userCount: 1, errors: [] },
      duration: Date.now() - startTime,
      itemsProcessed: stats.daydreamsGenerated,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

const agent: AgentModule = { meta, run };
export default agent;

export {
  evaluateDaydreamerGraph,
  generateUserDaydream,
  loadDaydreamerGraph,
  normalizeTriggerProfile,
  runCycle,
  type DaydreamerGraphEvaluation,
  type DaydreamerResult,
  type UserDaydreamerStats,
} from './core.js';
