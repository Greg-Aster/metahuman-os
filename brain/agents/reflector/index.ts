/**
 * Reflector Agent — Module Definition
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
  id: 'reflector',
  name: 'Reflector',
  description: 'Generates internal reflections from associative memory chains',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 600, // 10 minutes
  tags: ['reflection', 'llm', 'background', 'inner-dialogue'],
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
  generateUserReflection,
  getAssociativeMemoryChain,
  getAllMemories,
  extractKeywords,
  type ReflectorOptions,
  type ReflectorResult,
} from './core.js';
