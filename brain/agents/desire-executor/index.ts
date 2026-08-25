import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-executor', name: 'Desire Executor',
  description: 'Admits approved desire execution to the Work Coordinator',
  usesLLM: true, priority: 'normal',
  tags: ['agency', 'desire', 'execution', 'manual'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, type DesireExecutorOptions, type DesireExecutorResult } from './core.js';
