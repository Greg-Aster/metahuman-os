import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-planner', name: 'Desire Planner',
  description: 'Generates execution plans for desires using cognitive graphs',
  usesLLM: true, priority: 'medium', defaultInterval: 1800,
  tags: ['agency', 'llm', 'background', 'desire', 'planning'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, processPlanningDesires, type DesirePlannerOptions, type DesirePlannerResult } from './core.js';
