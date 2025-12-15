import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-executor', name: 'Desire Executor',
  description: 'Executes approved desires through the operator system',
  usesLLM: true, priority: 'medium', defaultInterval: 300,
  tags: ['agency', 'llm', 'background', 'desire', 'execution'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, processApprovedDesires, type DesireExecutorOptions, type DesireExecutorResult } from './core.js';
