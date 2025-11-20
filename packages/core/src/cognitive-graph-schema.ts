/**
 * Schema validation for cognitive graph persistence
 *
 * This module defines the structure and validation logic for cognitive graphs
 * that can be saved, loaded, and executed by the node editor.
 */

export interface CognitiveGraphNode {
  id: number;
  type: string;
  pos: [number, number];
  size?: [number, number];
  properties?: Record<string, any>;
  title?: string;
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

  // Check for circular dependencies (allowing conditional_router back-edges)
  if (Array.isArray(graph.links) && graph.links.length > 0 && Array.isArray(graph.nodes)) {
    // Identify conditional_router nodes
    const routerNodes = graph.nodes
      .filter((n: any) => n.type === 'conditional_router' || n.type === 'cognitive/conditional_router')
      .map((n: any) => n.id);
    const routerSet = new Set(routerNodes);

    // Identify back-edges (loops from conditional_router)
    const backEdges = new Set<string>();
    graph.links.forEach((link: any) => {
      if (routerSet.has(link.origin_id)) {
        // Slot 1 = loop back path (false branch)
        if (link.origin_slot === 1 || link.comment?.includes('loop') || link.comment?.includes('BACK-EDGE')) {
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
        errors.push('Graph contains invalid circular dependencies (excluding allowed conditional_router back-edges)');
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
