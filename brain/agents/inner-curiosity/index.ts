/**
 * Inner Curiosity Agent — Module Definition
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
  id: 'inner-curiosity',
  name: 'Inner Curiosity',
  description: 'Generates self-directed questions and answers them using local memory',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 1200, // 20 minutes
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

// Re-export core functions for direct usage
export {
  runCycle,
  generateInnerQuestion,
  sampleWeightedMemories,
  getAllMemories,
  type InnerCuriosityOptions,
  type InnerCuriosityResult,
} from './core.js';
