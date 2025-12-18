/**
 * Node Component Map
 *
 * Maps cognitive node type IDs to Svelte Flow component types.
 * Uses category-based components for maintainability.
 */

import type { NodeCategory } from '@metahuman/core/nodes/types';

// Special node ID to component mapping (for nodes that need custom rendering)
const nodeIdToComponent: Record<string, string> = {
  graph_note: 'noteNode',
  'cognitive/graph_note': 'noteNode',
};

// Category to component name mapping
const categoryToComponent: Record<NodeCategory, string> = {
  input: 'inputNode',
  output: 'outputNode',
  router: 'routerNode',
  control_flow: 'routerNode',
  context: 'contextNode',
  operator: 'operatorNode',
  chat: 'llmNode',
  model: 'llmNode',
  skill: 'skillNode',
  memory: 'memoryNode',
  utility: 'utilityNode',
  agent: 'agentNode',
  config: 'utilityNode',
  persona: 'personaNode',
  thought: 'cognitiveNode',
  dreamer: 'cognitiveNode',
  curiosity: 'cognitiveNode',
  curator: 'curatorNode',
  safety: 'safetyNode',
  emulation: 'utilityNode',
  agency: 'agencyNode',
  cognitive: 'cognitiveNode',
};

/**
 * Get the Svelte Flow component type for a node
 * First checks for special node ID mapping, then falls back to category
 */
export function getNodeComponentType(category: NodeCategory, nodeType?: string): string {
  // Check for special node ID mapping first
  if (nodeType) {
    const stripped = nodeType.replace(/^cognitive\//, '');
    if (nodeIdToComponent[stripped]) {
      return nodeIdToComponent[stripped];
    }
    if (nodeIdToComponent[nodeType]) {
      return nodeIdToComponent[nodeType];
    }
  }
  // Fall back to category mapping
  return categoryToComponent[category] || 'genericNode';
}

/**
 * Get component type from full node type string (e.g., "cognitive/user_input")
 */
export function getComponentTypeFromNodeType(nodeType: string, category?: NodeCategory): string {
  if (category) {
    return getNodeComponentType(category);
  }
  // Fallback: try to infer from type prefix
  const prefix = nodeType.split('/')[0];
  if (prefix && prefix in categoryToComponent) {
    return categoryToComponent[prefix as NodeCategory];
  }
  return 'genericNode';
}

// Export category colors for node styling
export { categoryColors } from '@metahuman/core/nodes/types';
