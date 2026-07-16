import type { TaskType } from './types.js';
import {
  AGENT_CATALOG_DEFINITIONS,
  getAgentCatalogDefinition,
  type AgentCatalogLifecycle,
} from '../agent-catalog-definitions.js';

export type AgentLifecycleClass = AgentCatalogLifecycle;
export type TriggerStartupPolicy = 'skip' | 'run-once' | 'recover-missed';

export function agentTaskType(agentId: string): TaskType {
  return getAgentCatalogDefinition(agentId)?.taskType || 'generic';
}

export function agentHandlerId(agentId: string): string {
  return getAgentCatalogDefinition(agentId)?.handler || `agent.${agentId}`;
}

export function defaultAgentLifecycle(agentId: string): AgentLifecycleClass {
  return getAgentCatalogDefinition(agentId)?.lifecycle || 'scheduled-work';
}

export function isPersistentService(agentId: string, lifecycle?: AgentLifecycleClass): boolean {
  return lifecycle === 'service' || getAgentCatalogDefinition(agentId)?.lifecycle === 'service';
}

export function knownAgentIds(): string[] {
  return Object.keys(AGENT_CATALOG_DEFINITIONS).sort();
}
