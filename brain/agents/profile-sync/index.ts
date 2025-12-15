/**
 * Profile Sync Agent — Module Definition
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
  id: 'profile-sync',
  name: 'Profile Sync',
  description: 'Synchronizes profile, memories, and credentials with remote server',
  usesLLM: false,
  priority: 'high',
  tags: ['sync', 'network', 'profile'],
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
  syncUserProfile,
  loadSyncCredentials,
  type SyncOptions,
  type SyncResult,
  type SyncProgress,
} from './core.js';
