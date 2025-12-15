/**
 * Agent Registry
 *
 * Central registry of all available agents.
 * Agents register themselves here, and the runtime looks them up by ID.
 */

import type { AgentModule, AgentMeta } from './types.js';

/**
 * Registry of all agents
 */
const registry = new Map<string, AgentModule>();

/**
 * Register an agent
 */
export function registerAgent(agent: AgentModule): void {
  if (registry.has(agent.meta.id)) {
    console.warn(`[agent-registry] Agent '${agent.meta.id}' is already registered, overwriting`);
  }
  registry.set(agent.meta.id, agent);
  console.log(`[agent-registry] Registered agent: ${agent.meta.id}`);
}

/**
 * Get an agent by ID
 */
export function getAgent(id: string): AgentModule | undefined {
  return registry.get(id);
}

/**
 * Check if an agent is registered
 */
export function hasAgent(id: string): boolean {
  return registry.has(id);
}

/**
 * Get all registered agent IDs
 */
export function getAgentIds(): string[] {
  return Array.from(registry.keys());
}

/**
 * Get all registered agents
 */
export function getAllAgents(): AgentModule[] {
  return Array.from(registry.values());
}

/**
 * Get agent metadata for all registered agents
 */
export function getAgentMetas(): AgentMeta[] {
  return getAllAgents().map(a => a.meta);
}

/**
 * Unregister an agent
 */
export function unregisterAgent(id: string): boolean {
  return registry.delete(id);
}

/**
 * Clear all registered agents (for testing)
 */
export function clearRegistry(): void {
  registry.clear();
}

/**
 * Get agents by tag
 */
export function getAgentsByTag(tag: string): AgentModule[] {
  return getAllAgents().filter(a => a.meta.tags?.includes(tag));
}

/**
 * Get agents that use LLM
 */
export function getLLMAgents(): AgentModule[] {
  return getAllAgents().filter(a => a.meta.usesLLM);
}

/**
 * Get agents by priority
 */
export function getAgentsByPriority(priority: 'high' | 'normal' | 'low'): AgentModule[] {
  return getAllAgents().filter(a => a.meta.priority === priority);
}
