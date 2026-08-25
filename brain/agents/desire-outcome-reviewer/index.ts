import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-outcome-reviewer', name: 'Desire Outcome Reviewer',
  description: 'Admits post-execution review to the canonical Core Agency outcome graph',
  usesLLM: true, priority: 'low',
  tags: ['agency', 'llm', 'background', 'desire', 'review'],
};

const agent: AgentModule = { meta, run };
export default agent;

export {
  parseDesireOutcomeReviewerArgs,
  runCycle,
  type DesireOutcomeReviewerOptions,
  type DesireOutcomeReviewerResult,
} from './core.js';
