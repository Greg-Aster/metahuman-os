import type { AgentMeta, AgentModule } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'environment-bridge',
  name: 'Environment Bridge',
  description: 'Coordinates environment observations and queued actions between graph nodes and adapters.',
  usesLLM: false,
  priority: 'normal',
  defaultInterval: 0,
  tags: ['environment', 'interface', 'bridge'],
};

const agent: AgentModule = {
  meta,
  run,
};

export default agent;
export { run, runEnvironmentBridgeAgent, type EnvironmentBridgeAgentOptions } from './core.js';
