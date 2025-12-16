/**
 * Update Check Agent — Module Definition
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
  id: 'update-check',
  name: 'Update Check',
  description: 'Check for software updates (git for desktop, APK for mobile)',
  usesLLM: false,
  priority: 'low',
  defaultInterval: 86400, // 24 hours
  tags: ['update', 'version', 'maintenance', 'background'],
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
  runUpdateCheck,
  checkGitUpdates,
  checkMobileUpdates,
  saveUpdateState,
  type UpdateInfo,
  type MobileUpdateInfo,
  type UpdateCheckOptions,
} from './core.js';
