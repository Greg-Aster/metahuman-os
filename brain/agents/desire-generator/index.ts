/**
 * Desire Generator Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-generator',
  name: 'Desire Generator',
  description: 'Synthesizes desires from persona goals, tasks, memories, and other sources',
  usesLLM: true,
  priority: 'medium',
  defaultInterval: 1800, // 30 minutes
  tags: ['agency', 'llm', 'background', 'desire'],
};

const agent: AgentModule = { meta, run };
export default agent;

export {
  runCycle,
  generateDesiresForUser,
  gatherInputs,
  identifyDesires,
  type DesireGeneratorOptions,
  type DesireGeneratorResult,
} from './core.js';
