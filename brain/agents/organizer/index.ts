/**
 * Organizer Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 * This is the entry point for in-process execution.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

/**
 * Agent metadata
 */
export const meta: AgentMeta = {
  id: 'organizer',
  name: 'Memory Organizer',
  description: 'Runs the editable Organizer graph over selected episodic memories',
  usesLLM: true,
  priority: 'normal',
  tags: ['memory', 'llm', 'maintenance'],
};

/**
 * Complete agent module for registration
 */
const agent: AgentModule = {
  meta,
  run,
};

export default agent;

// Re-export the one canonical execution contract and its adapters.
export {
  runOrganizer,
  parseOrganizerArgs,
  normalizeOrganizerOptions,
  type OrganizerOptions,
  type ParsedOrganizerOptions,
  type OrganizerResult,
  type OrganizerMemoryOutcome,
} from './core.js';
