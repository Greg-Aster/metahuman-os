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
  name: 'Psychotherapist',
  description: 'Reviews saved conversations and other recent memories, then proposes and applies validated persona updates during Sleep or manual review.',
  usesLLM: true,
  priority: 'low',
  tags: ['psychoanalyzer', 'llm', 'persona', 'analysis'],
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
  executePsychoanalysis,
  loadConfig,
  selectMemories,
  analyzePersonaEvidence,
  parsePsychoanalyzerArgs,
  type PsychoanalyzerConfig,
  type PsychoanalyzerOptions,
  type PsychoanalyzerResult,
  type UserPsychoanalyzerStats,
  type PsychoanalyzerMemory,
  type PsychoanalyzerTarget,
} from './core.js';
