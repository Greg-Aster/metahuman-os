/**
 * Organizer Agent — Module Definition
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
  id: 'organizer',
  name: 'Memory Organizer',
  description: 'Enriches memories with LLM-extracted tags and entities',
  usesLLM: true,
  priority: 'normal',
  defaultInterval: 300, // 5 minutes
  tags: ['memory', 'llm', 'background'],
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
  processUserMemories,
  processMemory,
  findUnprocessedMemories,
  analyzeMemoryContent,
  type OrganizerOptions,
  type OrganizerResult,
  type AnalysisResult,
} from './core.js';
