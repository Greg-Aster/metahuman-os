import type { AgentMeta, AgentModule } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'mood',
  name: 'Mood',
  description: 'Selects an active persona facet from recent conversation and inner-dialogue context.',
  usesLLM: true,
  priority: 'medium',
  tags: ['persona', 'mood', 'graph'],
};

const agent: AgentModule = { meta, run };
export default agent;
export { run, runCycle, reviewMoodForUser, type MoodOptions, type MoodReviewResult } from './core.js';
