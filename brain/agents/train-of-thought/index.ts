/**
 * Train of Thought Agent — Module Definition
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
  id: 'train-of-thought',
  name: 'Train of Thought',
  description: 'Performs recursive reasoning by following memory associations',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 1800, // 30 minutes
  tags: ['reasoning', 'llm', 'background', 'inner-dialogue', 'reflection'],
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
  executeTrainOfThoughtForUser,
  loadTrainOfThoughtGraph,
  getAllMemories,
  extractKeywords,
  selectSeedMemory,
  type TrainOfThoughtOptions,
  type TrainOfThoughtResult,
  type UserThoughtStats,
} from './core.js';
