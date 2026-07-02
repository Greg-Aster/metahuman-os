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
  environment: 'environmentNode',
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
  'active-operator': 'operatorNode',
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

// Browser-local copy of category colors for node styling. Keep this client-side;
// core remains the schema owner and exposes authoritative schema data via API.
export const categoryColors: Record<NodeCategory, { color: string; bgColor: string }> = {
  input: { color: '#4ade80', bgColor: '#166534' },
  router: { color: '#fbbf24', bgColor: '#92400e' },
  context: { color: '#60a5fa', bgColor: '#1e3a8a' },
  environment: { color: '#2dd4bf', bgColor: '#115e59' },
  operator: { color: '#a78bfa', bgColor: '#5b21b6' },
  chat: { color: '#f472b6', bgColor: '#9f1239' },
  model: { color: '#fb923c', bgColor: '#9a3412' },
  skill: { color: '#34d399', bgColor: '#065f46' },
  output: { color: '#ef4444', bgColor: '#991b1b' },
  control_flow: { color: '#818cf8', bgColor: '#4338ca' },
  memory: { color: '#c084fc', bgColor: '#7e22ce' },
  utility: { color: '#94a3b8', bgColor: '#475569' },
  agent: { color: '#22d3ee', bgColor: '#155e75' },
  config: { color: '#fde047', bgColor: '#854d0e' },
  persona: { color: '#e879f9', bgColor: '#86198f' },
  thought: { color: '#67e8f9', bgColor: '#0e7490' },
  dreamer: { color: '#d8b4fe', bgColor: '#6b21a8' },
  curiosity: { color: '#fcd34d', bgColor: '#a16207' },
  curator: { color: '#86efac', bgColor: '#14532d' },
  safety: { color: '#fca5a5', bgColor: '#7f1d1d' },
  emulation: { color: '#a5b4fc', bgColor: '#3730a3' },
  agency: { color: '#f59e0b', bgColor: '#78350f' },
  cognitive: { color: '#38bdf8', bgColor: '#0c4a6e' },
  'active-operator': { color: '#8b5cf6', bgColor: '#4c1d95' },
};
