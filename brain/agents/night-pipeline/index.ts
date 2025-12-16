/**
 * Night Pipeline Agent — Module Definition
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
  id: 'night-pipeline',
  name: 'Night Pipeline',
  description: 'Orchestrates nightly processing (dreams, audio, LoRA training)',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 3600, // 1 hour check (actual run depends on sleep window)
  tags: ['night', 'pipeline', 'orchestrator', 'sleep', 'background'],
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
  checkPipelineConditions,
  type NightPipelineOptions,
  type NightPipelineResult,
} from './core.js';

// Re-export sleep-service utilities
export {
  loadSleepConfig,
  isSleepTime,
  isIdle,
  resetDayCounter,
  runNightlyPipeline,
  updateActivity,
  type SleepConfig,
} from '../../services/sleep-service.js';
