import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'desire-explorer',
  name: 'Desire Explorer',
  description: 'Explores activated desires and gathers clarifying context before planning',
  usesLLM: true,
  priority: 'medium',
  defaultInterval: 1800,
  tags: ['agency', 'llm', 'background', 'desire', 'exploration'],
};

const agent: AgentModule = { meta, run };
export default agent;

export {
  runDesireExplorer,
  type DesireExplorerOptions,
  type ExplorerStats,
} from './core.js';
