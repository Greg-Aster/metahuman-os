/**
 * Memory Sync Agent — Module Definition
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
  id: 'memory-sync',
  name: 'Memory Sync',
  description: 'Sync memories with remote server (pull/push)',
  usesLLM: false,
  priority: 'normal',
  defaultInterval: 3600, // 1 hour
  tags: ['sync', 'memory', 'remote', 'background'],
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
  run,
  runMemorySync,
  syncUserMemories,
  type SyncResult,
  type MemorySyncOptions,
} from './core.js';
