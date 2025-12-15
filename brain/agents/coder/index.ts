import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'coder', name: 'System Coder',
  description: 'Monitors, maintains, and fixes the MetaHuman OS codebase using Big Brother',
  usesLLM: true, priority: 'low', defaultInterval: 3600,
  tags: ['maintenance', 'llm', 'background', 'code', 'fixes'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, type CoderOptions, type CoderResult } from './core.js';
