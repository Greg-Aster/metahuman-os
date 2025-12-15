/**
 * Digest Agent — Module Definition
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
  id: 'digest',
  name: 'Digest',
  description: 'Builds long-term thematic understanding from memories',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 86400, // 24 hours (daily)
  tags: ['digest', 'llm', 'background', 'themes', 'persona'],
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
  generateUserDigest,
  loadRecentMemories,
  analyzeMemories,
  updatePersonaCacheFromDigest,
  type DigestOptions,
  type DigestResult,
  type DigestOutput,
  type UserDigestStats,
} from './core.js';
