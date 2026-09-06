/**
 * Desire Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-agent',
  name: 'Desire Agent',
  description: 'Sole controller for Desire generation, planning, execution, and outcome review',
  usesLLM: true,
  priority: 'normal',
  tags: ['agency', 'llm', 'background', 'desire'],
};

const agent: AgentModule = { meta, run };
export default agent;

export {
  runCycle,
  generateDesiresForUser,
  gatherInputs,
  identifyDesires,
  parseDesireGeneratorArgs,
  selectRecentUserRequests,
  type DesireGeneratorOptions,
  type DesireGeneratorResult,
} from './core.js';
