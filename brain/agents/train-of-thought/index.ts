/**
 * Train of Thought Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 * This is the Agent Runtime registration entry point.
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
  tags: ['reasoning', 'llm', 'follow-on', 'inner-dialogue'],
};

/**
 * Complete agent module for registration
 */
const agent: AgentModule = {
  meta,
  run,
};

export default agent;

export {
  evaluateTrainOfThoughtGraph,
  parseTrainOfThoughtArgs,
  runTrainOfThought,
  type TrainOfThoughtOptions,
  type TrainOfThoughtOutcome,
} from './core.js';
