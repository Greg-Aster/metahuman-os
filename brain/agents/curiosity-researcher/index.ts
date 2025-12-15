/**
 * Curiosity Researcher Agent — Module Definition
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
  id: 'curiosity-researcher',
  name: 'Curiosity Researcher',
  description: 'Performs deeper research on curiosity questions using memory and web searches',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 1800, // 30 minutes
  tags: ['curiosity', 'research', 'llm', 'background'],
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
  processUserResearch,
  researchQuestion,
  getMostRecentlyActiveUser,
  type CuriosityResearcherOptions,
  type CuriosityResearcherResult,
} from './core.js';
