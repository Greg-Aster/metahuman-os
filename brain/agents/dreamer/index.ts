/**
 * Dreamer Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 * This is the entry point for in-process execution on mobile.
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
  defaultInterval: 3600, // 1 hour (dreams are rare)
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
  type SleepConfig,
  type DreamerOptions,
  type DreamerResult,
  type UserDreamerStats,
} from './core.js';
