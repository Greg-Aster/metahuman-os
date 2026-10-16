import type { AgentMeta, AgentModule } from '@metahuman/agent-runtime'
import { run } from './core.js'
export const meta: AgentMeta = { id: 'body-event-trigger', name: 'Body Event Trigger',
  description: 'Analyze the supplied body event, its measurements, Robot Status, and current task.',
  usesLLM: true, priority: 'high', tags: ['robot', 'environment', 'graph'] }
const agent: AgentModule = { meta, run }
export default agent
export { run }
