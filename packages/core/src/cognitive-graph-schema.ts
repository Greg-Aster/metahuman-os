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

import { getNode } from './nodes/index.js';
import { validatePropertyValue } from './nodes/types.js';
import type {
  GraphNodeActivation,
  GraphOutputCondition,
  GraphSchedulerContract,
} from './cognitive-graph-contract.js';
import { DEFAULT_GRAPH_SCHEDULER } from './cognitive-graph-contract.js';

export type {
  GraphConditionValue,
  GraphNodeActivation,
  GraphOutputCondition,
  GraphSchedulerContract,
} from './cognitive-graph-contract.js';
export { DEFAULT_GRAPH_SCHEDULER } from './cognitive-graph-contract.js';

const LOG_PREFIX = '[cognitive-graph-schema]';

// ============================================================================
// LEGACY FORMAT (LiteGraph) - compatibility types only; not executable
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
  cognitiveMode?: 'dual' | 'agent' | 'emulation' | 'environment';
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
  cognitiveMode?: 'dual' | 'agent' | 'emulation' | 'environment';
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
    activation?: GraphNodeActivation;
    /** Node schema from graph definition (for output detection, validation) */
    schema?: {
      id?: string;
      name?: string;
      type?: string;
      category?: string;
      isOutputNode?: boolean;
      inputs?: Array<{ name: string; type: string; optional?: boolean }>;
      outputs?: Array<{ name: string; type: string; description?: string }>;
      [key: string]: any;
    };
  };
  width?: number;
  height?: number;
  /** Optional Svelte Flow parent used by editor grouping frames. */
  parentId?: string;
  extent?: 'parent';
  expandParent?: boolean;
  zIndex?: number;
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
    /** Control dependencies order nodes without copying an output into an input. */
    kind?: 'data' | 'control';
    /** Activate this edge only when the source node output matches. */
    when?: GraphOutputCondition;
    /** Explicitly removes this edge from the acyclic schedule and bounds re-entry. */
    loop?: boolean;
  };
}

export interface SvelteFlowGraph {
  version: string;
  format: 'svelte-flow';
  name: string;
  description?: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation' | 'environment';
  last_modified?: string;
  scheduler: GraphSchedulerContract;
  nodes: SvelteFlowNode[];
  edges: SvelteFlowEdge[];
}

// ============================================================================
// FORMAT DETECTION & CONVERSION
// ============================================================================

/**
 * Detect if a graph is in Svelte Flow format
 */
export function isSvelteFlowFormat(graph: unknown): graph is SvelteFlowGraph {
  if (typeof graph !== 'object' || graph === null) return false;
  const g = graph as any;
  return g.format === 'svelte-flow' || (
    Array.isArray(g.edges) &&
    g.nodes?.[0]?.position !== undefined
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
  console.log(`${LOG_PREFIX} Converting Svelte Flow graph to legacy format: ${sfGraph.name} (${sfGraph.nodes.length} nodes, ${sfGraph.edges.length} edges)`);
  
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
export function normalizeForExecution(graph: unknown): CognitiveGraph {
  const g = graph as any;
  console.log(`${LOG_PREFIX} Normalizing graph for execution: ${g?.name || 'unnamed'}`);
  if (isSvelteFlowFormat(graph)) {
    console.log(`${LOG_PREFIX} Detected Svelte Flow format, converting to legacy`);
    return convertToLegacyFormat(graph as SvelteFlowGraph);
  }
  console.log(`${LOG_PREFIX} Already in legacy format`);
  return g as CognitiveGraph;
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

function validateOutputCondition(condition: any, label: string, errors: string[]): void {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    errors.push(`${label}: condition must be an object`);
    return;
  }
  if (typeof condition.output !== 'string' || !condition.output.trim()) {
    errors.push(`${label}: condition output must be a non-empty string`);
  }

  const operators = ['equals', 'notEquals', 'truthy'].filter(operator => operator in condition);
  if (operators.length !== 1) {
    errors.push(`${label}: condition must define exactly one of equals, notEquals, or truthy`);
  }
  if ('truthy' in condition && typeof condition.truthy !== 'boolean') {
    errors.push(`${label}: truthy must be boolean`);
  }
  for (const operator of ['equals', 'notEquals'] as const) {
    if (!(operator in condition)) continue;
    const value = condition[operator];
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      errors.push(`${label}: ${operator} must be a string, number, boolean, or null`);
    }
  }
}

function validateRegisteredNodeContracts(graph: any, errors: string[]): void {
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return;
  const nodeById = new Map<string, any>();
  const incomingDataHandles = new Map<string, Set<string>>();

  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    if (nodeById.has(node.id)) errors.push(`Duplicate node id ${node.id}`);
    nodeById.set(node.id, node);
  }
  for (const edge of graph.edges) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) continue;
    if (edge.data?.kind === 'control') continue;
    const handles = incomingDataHandles.get(edge.target) || new Set<string>();
    handles.add(edge.targetHandle);
    incomingDataHandles.set(edge.target, handles);
  }

  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const definition = getNode(node.data?.nodeType);
    if (!definition) {
      errors.push(`Node ${node.id} uses unregistered type "${node.data?.nodeType || 'unknown'}"`);
      continue;
    }

    const declaredProperties = definition.propertySchemas || {};
    for (const property of Object.keys(node.data?.properties || {})) {
      if (!(property in declaredProperties)) {
        errors.push(`Node ${node.id} (${definition.id}) persists undeclared property "${property}"`);
      }
    }
    for (const [property, schema] of Object.entries(declaredProperties)) {
      const configured = node.data?.properties || {};
      const value = property in configured
        ? configured[property]
        : (property in (definition.properties || {}) ? definition.properties?.[property] : schema.default);
      const validationError = validatePropertyValue(value, schema);
      if (validationError) {
        errors.push(`Node ${node.id} (${definition.id}) property "${property}": ${validationError}`);
      }
    }

    const configuredRequiredInputs = node.data?.activation?.requiredInputs;
    const requiredInputs = Array.isArray(configuredRequiredInputs)
      ? configuredRequiredInputs
      : definition.execution.requiredInputs;
    for (const requiredInput of requiredInputs) {
      if (!definition.inputs.some(input => input.name === requiredInput)) {
        errors.push(`Node ${node.id} (${definition.id}) requires undeclared input "${requiredInput}"`);
      }
    }

    const activationMode = node.data?.activation?.mode ?? definition.execution.activation;
    if (activationMode === 'required-inputs') {
      const connectedInputs = incomingDataHandles.get(node.id) || new Set<string>();
      const missingInputs = requiredInputs.filter((input: string) => !connectedInputs.has(input));
      if (missingInputs.length > 0) {
        errors.push(`Node ${node.id} (${definition.id}) has no edge for required input(s): ${missingInputs.join(', ')}`);
      }
    }

    const activationConditions = node.data?.activation?.when;
    for (const condition of Array.isArray(activationConditions) ? activationConditions : []) {
      if (typeof condition?.output !== 'string') continue;
      const source = nodeById.get(condition.nodeId);
      const sourceDefinition = source ? getNode(source.data?.nodeType) : undefined;
      const output = condition.output.split('.')[0];
      if (!sourceDefinition?.outputs.some(candidate => candidate.name === output)) {
        errors.push(`Node ${node.id} activation uses undeclared output ${sourceDefinition?.id || condition.nodeId}.${output}`);
      }
    }
  }

  for (const edge of graph.edges) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const sourceDefinition = source ? getNode(source.data?.nodeType) : undefined;
    const targetDefinition = target ? getNode(target.data?.nodeType) : undefined;
    if (!source || !target) continue;
    if (!sourceDefinition || !targetDefinition) continue;

    if (edge.data?.kind !== 'control') {
      if (!sourceDefinition.outputs.some(output => output.name === edge.sourceHandle)) {
        errors.push(`Edge ${edge.id} uses undeclared output ${sourceDefinition.id}.${edge.sourceHandle}`);
      }
      if (!targetDefinition.inputs.some(input => input.name === edge.targetHandle)) {
        errors.push(`Edge ${edge.id} uses undeclared input ${targetDefinition.id}.${edge.targetHandle}`);
      }
    }
    if (edge.data?.when) {
      if (typeof edge.data.when.output !== 'string') continue;
      const conditionOutput = edge.data.when.output.split('.')[0];
      if (!sourceDefinition.outputs.some(output => output.name === conditionOutput)) {
        errors.push(`Edge ${edge.id} condition uses undeclared output ${sourceDefinition.id}.${conditionOutput}`);
      }
    }
    if (edge.data?.loop === true && !edge.data.when) {
      errors.push(`Loop edge ${edge.id} must declare a branch condition`);
    }
  }
}

/**
 * Validate a Svelte Flow graph structure
 */
export function validateSvelteFlowGraph(graph: any): SvelteFlowGraph {
  console.log(`${LOG_PREFIX} Validating Svelte Flow graph: ${graph?.name || 'unnamed'}`);
  const errors: string[] = [];

  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new GraphValidationError(['Graph must be an object']);
  }

  // Required metadata
  if (!graph.version || typeof graph.version !== 'string') {
    errors.push('Missing or invalid version');
  }
  if (!graph.name || typeof graph.name !== 'string') {
    errors.push('Missing or invalid name');
  }

  // Validate cognitive mode if provided
  if (graph.cognitiveMode && !['dual', 'agent', 'emulation', 'environment'].includes(graph.cognitiveMode)) {
    errors.push(`Invalid cognitiveMode: "${graph.cognitiveMode}". Must be one of: dual, agent, emulation, environment, or omit the field entirely for cross-mode graphs.`);
  }

  const scheduler = graph.scheduler;
  if (!scheduler || typeof scheduler !== 'object') {
    errors.push('Missing scheduler contract');
  } else {
    if (scheduler.version !== 1) errors.push('Scheduler version must be 1');
    if (scheduler.activation !== 'demand') errors.push('Scheduler activation must be "demand"');
    if (scheduler.skippedState !== 'explicit') errors.push('Scheduler skippedState must be "explicit"');
    if (scheduler.sideEffectOrder !== 'serial-topological') {
      errors.push('Scheduler sideEffectOrder must be "serial-topological"');
    }
    if (!Number.isInteger(scheduler.maxLoopIterations) || scheduler.maxLoopIterations < 1 || scheduler.maxLoopIterations > 100) {
      errors.push('Scheduler maxLoopIterations must be an integer from 1 to 100');
    }
  }

  // Required structure - nodes
  if (!Array.isArray(graph.nodes)) {
    errors.push('Missing or invalid nodes array');
  } else {
    graph.nodes.forEach((node: any, index: number) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        errors.push(`Node ${index}: must be an object`);
        return;
      }
      if (typeof node.id !== 'string') {
        errors.push(`Node ${index}: missing or invalid id (must be string)`);
      }
      if (!node.type || typeof node.type !== 'string') {
        errors.push(`Node ${index}: missing or invalid type`);
      }
      if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
        errors.push(`Node ${index}: missing or invalid position (must be {x, y})`);
      }
      if (node.parentId !== undefined && typeof node.parentId !== 'string') {
        errors.push(`Node ${index}: parentId must be a string`);
      }
      if (node.extent !== undefined && node.extent !== 'parent') {
        errors.push(`Node ${index}: persisted extent must be "parent"`);
      }
      if (!node.data || typeof node.data !== 'object') {
        errors.push(`Node ${index}: missing or invalid data object`);
      } else if (node.data.activation !== undefined) {
        const activation = node.data.activation;
        if (!activation || typeof activation !== 'object' || Array.isArray(activation)) {
          errors.push(`Node ${index}: activation must be an object`);
        } else {
          if (activation.mode !== undefined && !['required-inputs', 'any-input', 'always'].includes(activation.mode)) {
            errors.push(`Node ${index}: invalid activation mode`);
          }
          if (activation.requiredInputs !== undefined && (
            !Array.isArray(activation.requiredInputs)
            || activation.requiredInputs.some((input: unknown) => typeof input !== 'string' || !input.trim())
          )) {
            errors.push(`Node ${index}: requiredInputs must contain non-empty strings`);
          }
          if (activation.when !== undefined) {
            if (!Array.isArray(activation.when) || activation.when.length === 0) {
              errors.push(`Node ${index}: activation when must be a non-empty array`);
            } else {
              activation.when.forEach((condition: any, conditionIndex: number) => {
                validateOutputCondition(condition, `Node ${index} activation condition ${conditionIndex}`, errors);
                if (typeof condition?.nodeId !== 'string' || !condition.nodeId.trim()) {
                  errors.push(`Node ${index} activation condition ${conditionIndex}: nodeId must be a non-empty string`);
                }
              });
            }
          }
        }
      }
    });
  }

  // Required structure - edges
  if (!Array.isArray(graph.edges)) {
    errors.push('Missing or invalid edges array');
  } else {
    graph.edges.forEach((edge: any, index: number) => {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
        errors.push(`Edge ${index}: must be an object`);
        return;
      }
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
      if (edge.data?.kind !== undefined && !['data', 'control'].includes(edge.data.kind)) {
        errors.push(`Edge ${index}: kind must be "data" or "control"`);
      }
      if (edge.data?.loop !== undefined && typeof edge.data.loop !== 'boolean') {
        errors.push(`Edge ${index}: loop must be boolean`);
      }
      if (edge.data?.when !== undefined) {
        validateOutputCondition(edge.data.when, `Edge ${index}`, errors);
      }
    });
  }

  // Check dependencies using explicit loop declarations only. Node activation
  // conditions are also dependencies and participate in cycle detection.
  if (Array.isArray(graph.edges) && Array.isArray(graph.nodes)) {
    const validNodes = graph.nodes.filter((node: any) => node && typeof node === 'object' && !Array.isArray(node));
    const nodeIds = new Set(validNodes.map((node: any) => node.id));
    const validNodeById = new Map(validNodes.map((node: any) => [node.id, node]));
    const edgeMap = new Map<string, string[]>();
    graph.edges.forEach((edge: any) => {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return;
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        errors.push(`Edge ${edge.id || 'unknown'} references a missing node`);
        return;
      }
      if (edge.data?.loop !== true) {
        const targets = edgeMap.get(edge.source) || [];
        if (!targets.includes(edge.target)) targets.push(edge.target);
        edgeMap.set(edge.source, targets);
      }
    });

    validNodes.forEach((node: any, nodeIndex: number) => {
      if (node.parentId !== undefined) {
        if (!nodeIds.has(node.parentId)) {
          errors.push(`Node ${nodeIndex}: parentId references missing node ${node.parentId}`);
        } else if (node.parentId === node.id) {
          errors.push(`Node ${nodeIndex}: a node cannot parent itself`);
        } else {
          const parent = validNodeById.get(node.parentId) as any;
          const parentDefinition = parent ? getNode(parent.data?.nodeType) : undefined;
          if (!parentDefinition?.editorOnly || parent?.data?.properties?.frame !== true) {
            errors.push(`Node ${nodeIndex}: parentId must reference an editor-only group frame`);
          }
        }
      }
      if (node.extent === 'parent' && node.parentId === undefined) {
        errors.push(`Node ${nodeIndex}: extent "parent" requires parentId`);
      }
      const activationConditions = node.data?.activation?.when;
      for (const condition of Array.isArray(activationConditions) ? activationConditions : []) {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition)) continue;
        if (!nodeIds.has(condition.nodeId)) {
          errors.push(`Node ${nodeIndex}: activation references missing node ${condition.nodeId}`);
          continue;
        }
        const targets = edgeMap.get(condition.nodeId) || [];
        if (!targets.includes(node.id)) targets.push(node.id);
        edgeMap.set(condition.nodeId, targets);
      }
    });

    // Parent frames are a visual hierarchy, not an execution dependency, but
    // the persisted tree still has to be acyclic so Svelte Flow can resolve
    // absolute positions deterministically.
    const parentByNode = new Map<string, string>();
    for (const node of validNodes) {
      if (typeof node.parentId === 'string' && nodeIds.has(node.parentId) && node.parentId !== node.id) {
        parentByNode.set(node.id, node.parentId);
      }
    }
    for (const node of validNodes) {
      const hierarchyPath = new Set<string>();
      let current: string | undefined = node.id;
      while (current !== undefined) {
        if (hierarchyPath.has(current)) {
          errors.push(`Node ${node.id}: parent hierarchy contains a cycle`);
          break;
        }
        hierarchyPath.add(current);
        current = parentByNode.get(current);
      }
    }

    // Cycle detection using DFS (excluding allowed back-edges)
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string): boolean => {
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
    };

    for (const nodeId of Array.from(edgeMap.keys())) {
      if (hasCycle(nodeId)) {
        errors.push('Graph contains an undeclared circular dependency; mark only the intentional re-entry edge with data.loop=true');
        break;
      }
    }
  }

  validateRegisteredNodeContracts(graph, errors);

  if (errors.length > 0) {
    console.error(`${LOG_PREFIX} Svelte Flow graph validation failed with ${errors.length} errors:`, errors);
    throw new GraphValidationError(errors);
  }

  return graph as SvelteFlowGraph;
}

/**
 * Validate a cognitive graph structure
 */
export function validateCognitiveGraph(graph: any): CognitiveGraph {
  console.log(`${LOG_PREFIX} Validating cognitive graph: ${graph?.name || 'unnamed'}`);
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
  if (graph.cognitiveMode && !['dual', 'agent', 'emulation', 'environment'].includes(graph.cognitiveMode)) {
    errors.push(`Invalid cognitiveMode: "${graph.cognitiveMode}". Must be one of: dual, agent, emulation, environment, or omit the field entirely for cross-mode graphs.`);
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

  // Legacy links have no scheduler metadata, so every dependency participates
  // in cycle detection. Executable loops require the Svelte Flow contract.
  if (Array.isArray(graph.links) && graph.links.length > 0 && Array.isArray(graph.nodes)) {
    const linkMap = new Map<number, number[]>();
    graph.links.forEach((link: any) => {
      if (!linkMap.has(link.origin_id)) {
        linkMap.set(link.origin_id, []);
      }
      linkMap.get(link.origin_id)!.push(link.target_id);
    });

    // Cycle detection using every legacy dependency.
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const hasCycle = (node: number): boolean => {
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
    };

    for (const nodeId of Array.from(linkMap.keys())) {
      if (hasCycle(nodeId)) {
        errors.push('Legacy graph contains a circular dependency; migrate it to the Svelte Flow scheduler contract to declare a loop');
        break;
      }
    }
  }

  if (errors.length > 0) {
    console.error(`${LOG_PREFIX} Cognitive graph validation failed with ${errors.length} errors:`, errors);
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
  return [
    'dual-mode',
    'agent-mode',
    'emulation-mode',
    'environment-mode',
  ].includes(name);
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
