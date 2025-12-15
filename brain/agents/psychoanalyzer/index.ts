/**
 * Psychoanalyzer Agent — Module Definition
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
  id: 'psychoanalyzer',
  name: 'Psychoanalyzer',
  description: 'Reviews memories to extract personality insights and update persona',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 86400, // 24 hours (daily)
  tags: ['psychoanalyzer', 'llm', 'persona', 'background', 'analysis'],
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
  runPsychoanalysis,
  loadConfig,
  selectMemories,
  analyzeMemories,
  updatePersona,
  type PsychoanalyzerConfig,
  type PsychoanalyzerOptions,
  type PsychoanalyzerResult,
  type UserPsychoanalyzerStats,
  type AnalysisResult,
} from './core.js';
