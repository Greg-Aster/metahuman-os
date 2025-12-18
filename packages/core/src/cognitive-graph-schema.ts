/**
 * Schema validation for cognitive graph persistence
 *
 * This module defines the structure and validation logic for cognitive graphs
 * that can be saved, loaded, and executed by the node editor.
 *
 * Supports two formats:
 * - Legacy (LiteGraph): numeric IDs, pos arrays, links array
 * - Svelte Flow: string IDs, position objects, edges array with handles
 */

// ============================================================================
// LEGACY FORMAT (LiteGraph) - Used by graph-executor
// ============================================================================

export interface CognitiveGraphNode {
  id: number;
  type: string;
  pos: [number, number];
  size?: [number, number];
  properties?: Record<string, any>;
  title?: string;
  muted?: boolean;  // When true, node is skipped during execution
  flags?: {
    collapsed?: boolean;
    pinned?: boolean;
  };
}

export interface CognitiveGraphLink {
  id: number;
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
  type?: string;
  comment?: string;
}

export interface CognitiveGraphGroup {
  title: string;
  bounding: [number, number, number, number]; // [x, y, width, height]
  color?: string;
  font_size?: number;
}

export interface CognitiveGraphMetadata {
  version: string;
  name: string;
  description: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  author?: string;
  created?: string;
  last_modified?: string;
  tags?: string[];
}

export interface CognitiveGraph {
  // Metadata
  version: string;
  name: string;
  description: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  author?: string;
  created?: string;
  last_modified?: string;
  tags?: string[];

  // Graph structure
  nodes: CognitiveGraphNode[];
  links: CognitiveGraphLink[];
  groups?: CognitiveGraphGroup[];

  // LiteGraph compatibility
  config?: Record<string, any>;
  extra?: Record<string, any>;
}

// ============================================================================
// SVELTE FLOW FORMAT - Used by visual editor
// ============================================================================

export interface SvelteFlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType: string;
    properties: Record<string, any>;
    muted?: boolean;
    comment?: string;
  };
  width?: number;
  height?: number;
}

export interface SvelteFlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  data?: {
    type?: string;
    comment?: string;
  };
}

export interface SvelteFlowGraph {
  version: string;
  format: 'svelte-flow';
  name: string;
  description?: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  last_modified?: string;
  nodes: SvelteFlowNode[];
  edges: SvelteFlowEdge[];
}

// ============================================================================
// FORMAT DETECTION & CONVERSION
// ============================================================================

/**
 * Detect if a graph is in Svelte Flow format
 */
export function isSvelteFlowFormat(graph: any): graph is SvelteFlowGraph {
  return graph.format === 'svelte-flow' || (
    Array.isArray(graph.edges) &&
    graph.nodes?.[0]?.position !== undefined
  );
}

/**
 * Convert Svelte Flow graph to legacy format for execution
 */
export function convertToLegacyFormat(sfGraph: SvelteFlowGraph): CognitiveGraph {
  // Build handle index maps for each node
  const nodeHandleIndices = new Map<string, { inputs: Map<string, number>; outputs: Map<string, number> }>();

  // Track used handles per node to assign indices
  sfGraph.edges.forEach((edge) => {
    // Track source handles (outputs)
    if (!nodeHandleIndices.has(edge.source)) {
      nodeHandleIndices.set(edge.source, { inputs: new Map(), outputs: new Map() });
    }
    const sourceData = nodeHandleIndices.get(edge.source)!;
    if (!sourceData.outputs.has(edge.sourceHandle)) {
      sourceData.outputs.set(edge.sourceHandle, sourceData.outputs.size);
    }

    // Track target handles (inputs)
    if (!nodeHandleIndices.has(edge.target)) {
      nodeHandleIndices.set(edge.target, { inputs: new Map(), outputs: new Map() });
    }
    const targetData = nodeHandleIndices.get(edge.target)!;
    if (!targetData.inputs.has(edge.targetHandle)) {
      targetData.inputs.set(edge.targetHandle, targetData.inputs.size);
    }
  });

  // Convert nodes
  const nodes: CognitiveGraphNode[] = sfGraph.nodes.map((node) => {
    const numericId = parseInt(node.id, 10);
    const nodeType = node.data.nodeType;
    return {
      id: numericId,
      type: nodeType.includes('/') ? nodeType : `cognitive/${nodeType}`,
      pos: [node.position.x, node.position.y] as [number, number],
      size: node.width && node.height ? [node.width, node.height] as [number, number] : undefined,
      properties: node.data.properties,
      title: node.data.label,
      muted: node.data.muted,
    };
  });

  // Convert edges to links
  const links: CognitiveGraphLink[] = sfGraph.edges.map((edge, index) => {
    const sourceData = nodeHandleIndices.get(edge.source);
    const targetData = nodeHandleIndices.get(edge.target);

    return {
      id: index + 1,
      origin_id: parseInt(edge.source, 10),
      origin_slot: sourceData?.outputs.get(edge.sourceHandle) ?? 0,
      target_id: parseInt(edge.target, 10),
      target_slot: targetData?.inputs.get(edge.targetHandle) ?? 0,
      type: edge.data?.type,
      comment: edge.data?.comment,
    };
  });

  return {
    version: sfGraph.version,
    name: sfGraph.name,
    description: sfGraph.description || '',
    cognitiveMode: sfGraph.cognitiveMode,
    last_modified: sfGraph.last_modified,
    nodes,
    links,
  };
}

/**
 * Normalize any graph format to legacy format for execution
 */
export function normalizeForExecution(graph: any): CognitiveGraph {
  if (isSvelteFlowFormat(graph)) {
    return convertToLegacyFormat(graph as SvelteFlowGraph);
  }
  return graph as CognitiveGraph;
}

/**
 * Validation errors
 */
export class GraphValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Graph validation failed: ${errors.join(', ')}`);
    this.name = 'GraphValidationError';
  }
}

/**
 * Validate a cognitive graph structure
 */
export function validateCognitiveGraph(graph: any): CognitiveGraph {
  const errors: string[] = [];

  // Required metadata
  if (!graph.version || typeof graph.version !== 'string') {
    errors.push('Missing or invalid version');
  }
  if (!graph.name || typeof graph.name !== 'string') {
    errors.push('Missing or invalid name');
  }
  if (!graph.description || typeof graph.description !== 'string') {
    errors.push('Missing or invalid description');
  }

  // Validate cognitive mode if provided
  if (graph.cognitiveMode && !['dual', 'agent', 'emulation'].includes(graph.cognitiveMode)) {
    errors.push('Invalid cognitiveMode (must be dual, agent, or emulation)');
  }

  // Required structure
  if (!Array.isArray(graph.nodes)) {
    errors.push('Missing or invalid nodes array');
  } else {
    graph.nodes.forEach((node: any, index: number) => {
      if (typeof node.id !== 'number') {
        errors.push(`Node ${index}: missing or invalid id`);
      }
      if (!node.type || typeof node.type !== 'string') {
        errors.push(`Node ${index}: missing or invalid type`);
      }
      if (!Array.isArray(node.pos) || node.pos.length !== 2) {
        errors.push(`Node ${index}: missing or invalid pos (must be [x, y])`);
      }
    });
  }

  if (!Array.isArray(graph.links)) {
    errors.push('Missing or invalid links array');
  } else {
    graph.links.forEach((link: any, index: number) => {
      if (typeof link.id !== 'number') {
        errors.push(`Link ${index}: missing or invalid id`);
      }
      if (typeof link.origin_id !== 'number') {
        errors.push(`Link ${index}: missing or invalid origin_id`);
      }
      if (typeof link.target_id !== 'number') {
        errors.push(`Link ${index}: missing or invalid target_id`);
      }
    });
  }

  // Check for circular dependencies (allowing router back-edges for iterative loops)
  if (Array.isArray(graph.links) && graph.links.length > 0 && Array.isArray(graph.nodes)) {
    // Identify router nodes that are allowed to create back-edges
    // - conditional_router: for conditional loops
    // - feedback_router: for quality/safety refinement loops
    const routerNodes = graph.nodes
      .filter((n: any) =>
        n.type === 'conditional_router' ||
        n.type === 'cognitive/conditional_router' ||
        n.type === 'feedback_router' ||
        n.type === 'control_flow/feedback_router'
      )
      .map((n: any) => n.id);
    const routerSet = new Set(routerNodes);

    // Identify back-edges (loops from router nodes)
    const backEdges = new Set<string>();
    graph.links.forEach((link: any) => {
      if (routerSet.has(link.origin_id)) {
        // Slot 1 or 2 = loop back path (feedback/false branch)
        // Also check for explicit BACK-EDGE comments
        if (link.origin_slot === 1 || link.origin_slot === 2 || link.comment?.includes('loop') || link.comment?.includes('BACK-EDGE')) {
          backEdges.add(`${link.origin_id}->${link.target_id}`);
        }
      }
    });

    // Build link map excluding back-edges
    const linkMap = new Map<number, number[]>();
    graph.links.forEach((link: any) => {
      const edgeKey = `${link.origin_id}->${link.target_id}`;
      if (!backEdges.has(edgeKey)) {
        if (!linkMap.has(link.origin_id)) {
          linkMap.set(link.origin_id, []);
        }
        linkMap.get(link.origin_id)!.push(link.target_id);
      }
    });

    // Cycle detection using DFS (excluding allowed back-edges)
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    function hasCycle(node: number): boolean {
      if (recursionStack.has(node)) return true;
      if (visited.has(node)) return false;

      visited.add(node);
      recursionStack.add(node);

      const neighbors = linkMap.get(node) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor)) return true;
      }

      recursionStack.delete(node);
      return false;
    }

    for (const nodeId of linkMap.keys()) {
      if (hasCycle(nodeId)) {
        errors.push('Graph contains invalid circular dependencies (excluding allowed router back-edges from conditional_router and feedback_router)');
        break;
      }
    }
  }

  if (errors.length > 0) {
    throw new GraphValidationError(errors);
  }

  return graph as CognitiveGraph;
}

/**
 * Sanitize graph name for filesystem
 */
export function sanitizeGraphName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/**
 * Generate filename for a graph
 */
export function graphNameToFilename(name: string): string {
  return `${sanitizeGraphName(name)}.json`;
}

/**
 * Check if a graph is a built-in template
 */
export function isBuiltInTemplate(name: string): boolean {
  return ['dual-mode', 'agent-mode', 'emulation-mode'].includes(name);
}

/**
 * Create a new graph with default metadata
 */
export function createEmptyGraph(name: string, description?: string): CognitiveGraph {
  const timestamp = new Date().toISOString();
  return {
    version: '1.0',
    name,
    description: description || 'Custom cognitive graph',
    created: timestamp,
    last_modified: timestamp,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
  };
}

/**
 * Update graph metadata before saving
 */
export function updateGraphMetadata(graph: CognitiveGraph, updates: Partial<CognitiveGraphMetadata>): CognitiveGraph {
  return {
    ...graph,
    ...updates,
    last_modified: new Date().toISOString(),
  };
}
