import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-outcome-reviewer', name: 'Desire Outcome Reviewer',
  description: 'Post-execution review of desires through the canonical outcome graph',
  usesLLM: true, priority: 'low', defaultInterval: 600,
  tags: ['agency', 'llm', 'background', 'desire', 'review'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, processDesires, type DesireOutcomeReviewerOptions, type DesireOutcomeReviewerResult } from './core.js';
