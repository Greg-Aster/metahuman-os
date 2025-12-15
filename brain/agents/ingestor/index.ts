/**
 * Ingestor Agent — Module Definition
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
  id: 'ingestor',
  name: 'Inbox Ingestor',
  description: 'Converts files in memory/inbox into episodic memories',
  usesLLM: false,
  priority: 'low',
  defaultInterval: 60, // 1 minute
  tags: ['memory', 'inbox', 'background'],
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
  ingestUserFiles,
  ingestFile,
  resolveInboxPaths,
  readFileAsText,
  chunkText,
  type IngestorOptions,
  type IngestorResult,
} from './core.js';
