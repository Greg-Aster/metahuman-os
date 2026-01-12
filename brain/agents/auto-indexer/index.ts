/**
 * Auto-Indexer Agent — Module Definition
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
  id: 'auto-indexer',
  name: 'Auto-Indexer',
  description: 'Automatically rebuilds vector indexes for semantic search',
  usesLLM: false, // Uses embeddings only, no LLM required
  priority: 'low',
  defaultInterval: 86400, // 24 hours (nightly)
  tags: ['indexing', 'background', 'search', 'embeddings'],
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
  rebuildIndex,
  processUserIndex,
  type AutoIndexerOptions,
  type AutoIndexerResult,
  type IndexRebuildResult,
} from './core.js';
