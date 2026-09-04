/**
 * Inner Curiosity Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime. The run
 * function is a thin adapter to the catalog-owned cognitive graph.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

/**
 * Agent metadata
 */
export const meta: AgentMeta = {
  id: 'inner-curiosity',
  name: 'Inner Curiosity',
  description: 'Generates self-directed questions and answers them using local memory',
  usesLLM: true,
  priority: 'low',
  tags: ['curiosity', 'llm', 'background', 'inner-dialogue'],
};

/**
 * Complete agent module for registration
 */
const agent: AgentModule = {
  meta,
  run,
};

export default agent;

// Re-export the one canonical execution contract for interface adapters.
export {
  runCycle,
  runInnerCuriosity,
  type InnerCuriosityOptions,
  type InnerCuriosityOutcome,
  type InnerCuriosityResult,
} from './core.js';
