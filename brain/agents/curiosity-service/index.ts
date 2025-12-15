/**
 * Curiosity Service Agent — Module Definition
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
  id: 'curiosity-service',
  name: 'Curiosity Service',
  description: 'Monitors user inactivity and asks thoughtful questions',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 900, // 15 minutes
  tags: ['curiosity', 'llm', 'background', 'user-facing'],
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
  generateUserQuestion,
  loadCuriosityGraph,
  type CuriosityServiceOptions,
  type CuriosityServiceResult,
} from './core.js';
