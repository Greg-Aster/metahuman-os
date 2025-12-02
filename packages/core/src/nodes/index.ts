/**
 * Node Registry
 *
 * Central registry that collects all node definitions and provides
 * lookup utilities for both frontend (schemas) and backend (executors).
 *
 * This follows the industry standard pattern from ComfyUI/Node-RED:
 * - Each node is a self-contained file with schema + executor
 * - Categories are organized in subdirectories
 * - This index auto-collects and exports everything
 */

import type { NodeDefinition, NodeSchema, NodeExecutor } from './types.js';
import { extractSchema, isNodeDefinition } from './types.js';

// Re-export types
export * from './types.js';

// ============================================================================
// IMPORT ALL NODE CATEGORIES
// ============================================================================

// Input nodes
import * as inputNodes from './input/index.js';

// Output nodes
import * as outputNodes from './output/index.js';

// Routing nodes
import * as routingNodes from './routing/index.js';

// Context nodes
import * as contextNodes from './context/index.js';

// LLM nodes
import * as llmNodes from './llm/index.js';

// Control flow nodes
import * as controlFlowNodes from './control-flow/index.js';

// Operator nodes
import * as operatorNodes from './operator/index.js';

// Skill nodes
import * as skillNodes from './skill/index.js';

// Agent nodes
import * as agentNodes from './agent/index.js';

// Utility nodes
import * as utilityNodes from './utility/index.js';

// Memory nodes (will be added)
// import * as memoryNodes from './memory/index.js';

// Config nodes (will be added)
// import * as configNodes from './config/index.js';

// ============================================================================
// COLLECT ALL NODES
// ============================================================================

function collectNodes(...modules: Record<string, unknown>[]): NodeDefinition[] {
  const nodes: NodeDefinition[] = [];
  for (const mod of modules) {
    for (const exported of Object.values(mod)) {
      if (isNodeDefinition(exported)) {
        nodes.push(exported);
      }
    }
  }
  return nodes;
}

/**
 * All registered node definitions
 */
export const allNodes: NodeDefinition[] = collectNodes(
  inputNodes,
  outputNodes,
  routingNodes,
  contextNodes,
  llmNodes,
  controlFlowNodes,
  operatorNodes,
  skillNodes,
  agentNodes,
  utilityNodes,
  // memoryNodes,
  // configNodes,
);

// ============================================================================
// REGISTRY MAPS
// ============================================================================

/**
 * Map of node ID to full definition
 */
export const nodeRegistry: Map<string, NodeDefinition> = new Map();

/**
 * Map of node ID to executor function
 */
export const nodeExecutors: Map<string, NodeExecutor> = new Map();

/**
 * Map of node ID to schema (for frontend)
 */
export const nodeSchemas: Map<string, NodeSchema> = new Map();

// Populate registries
for (const node of allNodes) {
  nodeRegistry.set(node.id, node);
  nodeExecutors.set(node.id, node.execute);
  nodeSchemas.set(node.id, extractSchema(node));

  // Register aliases
  if (node.aliases) {
    for (const alias of node.aliases) {
      nodeRegistry.set(alias, node);
      nodeExecutors.set(alias, node.execute);
      nodeSchemas.set(alias, extractSchema(node));
    }
  }
}

// ============================================================================
// LOOKUP FUNCTIONS
// ============================================================================

/**
 * Get a node definition by ID
 */
export function getNode(id: string): NodeDefinition | undefined {
  // Strip cognitive/ prefix if present
  const cleanId = id.replace(/^cognitive\//, '');
  return nodeRegistry.get(cleanId);
}

/**
 * Get a node executor by ID
 * Compatible with the old getNodeExecutor() function signature
 */
export function getNodeExecutor(nodeType: string): NodeExecutor | null {
  const cleanType = nodeType.replace(/^(cognitive|plugin)\//, '');
  return nodeExecutors.get(cleanType) ?? null;
}

/**
 * Get a node schema by ID (for frontend)
 */
export function getNodeSchema(id: string): NodeSchema | undefined {
  const cleanId = id.replace(/^cognitive\//, '');
  return nodeSchemas.get(cleanId);
}

/**
 * Get all node schemas as an array (for frontend palette)
 */
export function getAllSchemas(): NodeSchema[] {
  return Array.from(nodeSchemas.values());
}

/**
 * Get all node definitions
 */
export function getAllNodes(): NodeDefinition[] {
  return allNodes;
}

/**
 * Get nodes by category
 */
export function getNodesByCategory(category: string): NodeDefinition[] {
  return allNodes.filter((node) => node.category === category);
}

/**
 * Check if a node type exists
 */
export function hasNode(id: string): boolean {
  const cleanId = id.replace(/^cognitive\//, '');
  return nodeRegistry.has(cleanId);
}

// ============================================================================
// PLUGIN SUPPORT (runtime registration)
// ============================================================================

/**
 * Register a custom node at runtime
 * Used for plugins/extensions
 */
export function registerNode(node: NodeDefinition): void {
  allNodes.push(node);
  nodeRegistry.set(node.id, node);
  nodeExecutors.set(node.id, node.execute);
  nodeSchemas.set(node.id, extractSchema(node));

  if (node.aliases) {
    for (const alias of node.aliases) {
      nodeRegistry.set(alias, node);
      nodeExecutors.set(alias, node.execute);
      nodeSchemas.set(alias, extractSchema(node));
    }
  }
}

/**
 * Register a plugin executor (backward compatibility)
 * @deprecated Use registerNode() instead
 */
export function registerPluginExecutor(pluginId: string, executor: NodeExecutor): void {
  nodeExecutors.set(pluginId, executor);
}

// ============================================================================
// DEBUG / INSPECTION
// ============================================================================

/**
 * Get registry statistics
 */
export function getRegistryStats(): {
  totalNodes: number;
  byCategory: Record<string, number>;
  withAliases: number;
  deprecated: number;
} {
  const byCategory: Record<string, number> = {};
  let withAliases = 0;
  let deprecated = 0;

  for (const node of allNodes) {
    byCategory[node.category] = (byCategory[node.category] || 0) + 1;
    if (node.aliases?.length) withAliases++;
    if (node.deprecated) deprecated++;
  }

  return {
    totalNodes: allNodes.length,
    byCategory,
    withAliases,
    deprecated,
  };
}
