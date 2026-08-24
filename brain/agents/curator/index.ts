/**
 * Curator Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 * Optional in-process Agent Runtime adapter around the canonical core.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

/**
 * Agent metadata
 */
export const meta: AgentMeta = {
  id: 'curator',
  name: 'Curator',
  description: 'Prepares clean, persona-friendly training data from memories',
  usesLLM: true,
  priority: 'normal',
  tags: ['curator', 'llm', 'training', 'background'],
};

/**
 * Complete agent module for registration
 */
const agent: AgentModule = {
  meta,
  run,
};

export default agent;

// Re-export core functions for direct usage
export {
  runCycle,
  runCuratorForUser,
  loadCuratorGraph,
  parseCuratorArgs,
  normalizeCuratorOptions,
  type CuratorOptions,
  type CuratorResult,
  type UserCuratorStats,
} from './core.js';
