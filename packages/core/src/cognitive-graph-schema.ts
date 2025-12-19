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
 * Extract slot index from handle name
 * Handles formats like: "output_0", "input_1", "continue", "loop_back"
 * Returns the extracted index or a fallback based on handle name semantics
 */
function extractSlotIndex(handleName: string, isOutput: boolean): number {
  // Try to extract numeric index from handle name (e.g., "output_0" -> 0)
  const match = handleName.match(/^(?:output|input)_(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Known semantic handle names for routers (used for back-edge detection)
  // Slot 0 = continue/forward path, Slot 1+ = loop/back paths
  if (isOutput) {
    const outputSlotMap: Record<string, number> = {
      'continue': 0,
      'forward': 0,
      'output': 0,
      'response': 0,
      'result': 0,
      'loop_back': 1,
      'loop': 1,
      'back': 1,
      'retry': 1,
      'refine': 1,
      'feedbackContext': 1,  // feedback router back-edge
      'false': 1,  // conditional router false branch
      'true': 0,   // conditional router true branch
    };
    if (handleName in outputSlotMap) {
      return outputSlotMap[handleName];
    }
  }

  // Default to 0 if we can't determine
  return 0;
}

/**
 * Convert Svelte Flow graph to legacy format for execution
 */
export function convertToLegacyFormat(sfGraph: SvelteFlowGraph): CognitiveGraph {
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

  // Convert edges to links, preserving slot indices from handle names
  const links: CognitiveGraphLink[] = sfGraph.edges.map((edge, index) => {
    return {
      id: index + 1,
      origin_id: parseInt(edge.source, 10),
      origin_slot: extractSlotIndex(edge.sourceHandle, true),
      target_id: parseInt(edge.target, 10),
      target_slot: extractSlotIndex(edge.targetHandle, false),
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
 * Validate a Svelte Flow graph structure
 */
export function validateSvelteFlowGraph(graph: any): SvelteFlowGraph {
  const errors: string[] = [];

  // Required metadata
  if (!graph.version || typeof graph.version !== 'string') {
    errors.push('Missing or invalid version');
  }
  if (!graph.name || typeof graph.name !== 'string') {
    errors.push('Missing or invalid name');
  }

  // Validate cognitive mode if provided
  if (graph.cognitiveMode && !['dual', 'agent', 'emulation'].includes(graph.cognitiveMode)) {
    errors.push('Invalid cognitiveMode (must be dual, agent, or emulation)');
  }

  // Required structure - nodes
  if (!Array.isArray(graph.nodes)) {
    errors.push('Missing or invalid nodes array');
  } else {
    graph.nodes.forEach((node: any, index: number) => {
      if (typeof node.id !== 'string') {
        errors.push(`Node ${index}: missing or invalid id (must be string)`);
      }
      if (!node.type || typeof node.type !== 'string') {
        errors.push(`Node ${index}: missing or invalid type`);
      }
      if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
        errors.push(`Node ${index}: missing or invalid position (must be {x, y})`);
      }
      if (!node.data || typeof node.data !== 'object') {
        errors.push(`Node ${index}: missing or invalid data object`);
      }
    });
  }

  // Required structure - edges
  if (!Array.isArray(graph.edges)) {
    errors.push('Missing or invalid edges array');
  } else {
    graph.edges.forEach((edge: any, index: number) => {
      if (typeof edge.id !== 'string') {
        errors.push(`Edge ${index}: missing or invalid id`);
      }
      if (typeof edge.source !== 'string') {
        errors.push(`Edge ${index}: missing or invalid source`);
      }
      if (typeof edge.target !== 'string') {
        errors.push(`Edge ${index}: missing or invalid target`);
      }
      if (typeof edge.sourceHandle !== 'string') {
        errors.push(`Edge ${index}: missing or invalid sourceHandle`);
      }
      if (typeof edge.targetHandle !== 'string') {
        errors.push(`Edge ${index}: missing or invalid targetHandle`);
      }
    });
  }

  // Check for circular dependencies (allowing router back-edges for iterative loops)
  if (Array.isArray(graph.edges) && graph.edges.length > 0 && Array.isArray(graph.nodes)) {
    // Identify router nodes that are allowed to create back-edges
    const routerNodeTypes = [
      'conditional_router', 'cognitive/conditional_router', 'control_flow/conditional_router',
      'feedback_router', 'cognitive/feedback_router', 'control_flow/feedback_router'
    ];
    const routerNodes = graph.nodes
      .filter((n: any) => {
        const nodeType = n.data?.nodeType || n.type;
        return routerNodeTypes.some(rt => nodeType === rt || nodeType?.includes(rt));
      })
      .map((n: any) => n.id);
    const routerSet = new Set(routerNodes);

    // Identify back-edges (loops from router nodes)
    const backEdgeHandles = new Set([
      'loop_back', 'loop', 'back', 'retry', 'refine', 'feedbackContext', 'false'
    ]);
    const backEdges = new Set<string>();
    graph.edges.forEach((edge: any) => {
      if (routerSet.has(edge.source)) {
        if (backEdgeHandles.has(edge.sourceHandle) ||
            edge.data?.comment?.includes('loop') ||
            edge.data?.comment?.includes('BACK-EDGE')) {
          backEdges.add(`${edge.source}->${edge.target}`);
        }
      }
    });

    // Build edge map excluding back-edges
    const edgeMap = new Map<string, string[]>();
    graph.edges.forEach((edge: any) => {
      const edgeKey = `${edge.source}->${edge.target}`;
      if (!backEdges.has(edgeKey)) {
        if (!edgeMap.has(edge.source)) {
          edgeMap.set(edge.source, []);
        }
        edgeMap.get(edge.source)!.push(edge.target);
      }
    });

    // Cycle detection using DFS (excluding allowed back-edges)
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    function hasCycle(node: string): boolean {
      if (recursionStack.has(node)) return true;
      if (visited.has(node)) return false;

      visited.add(node);
      recursionStack.add(node);

      const neighbors = edgeMap.get(node) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor)) return true;
      }

      recursionStack.delete(node);
      return false;
    }

    for (const nodeId of edgeMap.keys()) {
      if (hasCycle(nodeId)) {
        errors.push('Graph contains invalid circular dependencies (excluding allowed router back-edges)');
        break;
      }
    }
  }

  if (errors.length > 0) {
    throw new GraphValidationError(errors);
  }

  return graph as SvelteFlowGraph;
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
        n.type === 'control_flow/conditional_router' ||
        n.type === 'feedback_router' ||
        n.type === 'cognitive/feedback_router' ||
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
