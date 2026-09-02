/**
 * Dreamer Agent — Module Definition
 *
 * Exports the AgentModule for agent-runtime registration.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

/**
 * Agent metadata
 */
export const meta: AgentMeta = {
  id: 'dreamer',
  name: 'Dreamer',
  description: 'Creates surreal dream narratives from lifetime memory fragments',
  usesLLM: true,
  priority: 'low',
  tags: ['dream', 'llm', 'background', 'sleep'],
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
  generateUserDreams,
  loadSleepConfig,
  loadDreamerGraph,
  evaluateDreamerGraph,
  parseDreamerArgs,
  taskTriggerKind,
  type DreamerOptions,
  type DreamerResult,
  type DreamerGraphEvaluation,
  type UserDreamerStats,
} from './core.js';

export type { SleepConfig } from '@metahuman/core/sleep-config';
