import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-outcome-reviewer', name: 'Desire Outcome Reviewer',
  description: 'Post-execution review of desires using LLM analysis',
  usesLLM: true, priority: 'low', defaultInterval: 600,
  tags: ['agency', 'llm', 'background', 'desire', 'review'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, processDesires, reviewOutcome, type DesireOutcomeReviewerOptions, type DesireOutcomeReviewerResult } from './core.js';
