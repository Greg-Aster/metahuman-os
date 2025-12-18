/**
 * Template Converter
 *
 * Enriches Svelte Flow templates with schema data.
 * All templates are now in Svelte Flow format (migrated from LiteGraph).
 *
 * Schemas are loaded STATICALLY at module load time for instant availability.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { NodeSchema, NodeCategory } from '@metahuman/core/nodes/types';
import { nodeSchemas } from '@metahuman/core/nodes/schemas';
import { getNodeComponentType } from './node-component-map';

// Svelte Flow format
export interface SvelteFlowGraph {
  version: string;
  name: string;
  description: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  nodes: Node[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
}

// Node schema cache - populated SYNCHRONOUSLY at module load
const schemaCache: Map<string, NodeSchema> = new Map();

// Populate cache immediately (no async, no API call)
for (const schema of nodeSchemas) {
  schemaCache.set(schema.id, schema);
  // Also map with cognitive/ prefix for backwards compatibility
  schemaCache.set(`cognitive/${schema.id}`, schema);
}
console.log(`[template-converter] Loaded ${nodeSchemas.length} schemas (static)`);

/**
 * Load node schemas - NO-OP for backwards compatibility
 * Schemas are now loaded statically at module initialization
 */
export async function loadSchemas(): Promise<void> {
  // No-op - schemas loaded statically at module load
  // This function kept for backwards compatibility with callers
}

/**
 * Get schema for a node type
 */
function getSchema(nodeType: string): NodeSchema | undefined {
  // Try exact match
  let schema = schemaCache.get(nodeType);
  if (schema) return schema;

  // Try without cognitive/ prefix
  const stripped = nodeType.replace(/^cognitive\//, '');
  schema = schemaCache.get(stripped);
  if (schema) return schema;

  return undefined;
}

/**
 * Infer category from node type string
 */
function inferCategoryFromType(nodeType: string): NodeCategory {
  const type = nodeType.toLowerCase();

  if (type.includes('input') || type.includes('mic') || type.includes('speech')) return 'input';
  if (type.includes('output') || type.includes('stream') || type.includes('capture')) return 'output';
  if (type.includes('router') || type.includes('branch') || type.includes('switch')) return 'router';
  if (type.includes('llm') || type.includes('persona') || type.includes('orchestrator')) return 'chat';
  if (type.includes('memory') || type.includes('search') || type.includes('context')) return 'memory';
  if (type.includes('skill') || type.includes('fs_') || type.includes('task_')) return 'skill';
  if (type.includes('operator') || type.includes('react') || type.includes('planner')) return 'operator';

  return 'utility';
}

/**
 * Create a fallback schema for unknown node types
 */
function createFallbackSchema(nodeType: string): NodeSchema {
  const category = inferCategoryFromType(nodeType);
  const name = nodeType.replace(/^cognitive\//, '').replace(/_/g, ' ');

  return {
    id: nodeType,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    category,
    color: '#94a3b8',
    bgColor: '#475569',
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [{ name: 'output', type: 'any' }],
    description: `Unknown node type: ${nodeType}`,
  };
}

/**
 * Enrich a Svelte Flow graph with schema data
 * This is the main entry point for loading templates
 */
export function enrichGraphWithSchemas(sfGraph: any): SvelteFlowGraph {
  const nodes: Node[] = sfGraph.nodes.map((sfNode: any) => {
    const nodeType = sfNode.data?.nodeType || sfNode.type;
    const schema = getSchema(nodeType);
    const category = schema?.category || inferCategoryFromType(nodeType);

    return {
      id: String(sfNode.id),
      type: getNodeComponentType(category, nodeType),
      position: sfNode.position,
      width: sfNode.width,
      height: sfNode.height,
      data: {
        nodeType: nodeType,
        schema: schema || createFallbackSchema(nodeType),
        properties: sfNode.data?.properties || {},
        title: sfNode.data?.label || sfNode.data?.title,
        muted: sfNode.data?.muted,
        executionState: 'idle' as const,
      },
    };
  });

  const edges: Edge[] = (sfGraph.edges || []).map((edge: any) => ({
    id: edge.id,
    source: String(edge.source),
    target: String(edge.target),
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: 'default',
    data: edge.data || {},
  }));

  return {
    version: sfGraph.version || '1.0',
    name: sfGraph.name || 'Untitled Graph',
    description: sfGraph.description || '',
    cognitiveMode: sfGraph.cognitiveMode,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/**
 * Get slot index from handle name
 */
function getSlotIndexFromHandle(
  handleName: string,
  nodeId: string,
  nodes: Node[],
  isOutput: boolean
): number {
  const node = nodes.find((n) => n.id === nodeId);
  const nodeData = node?.data as { schema?: NodeSchema } | undefined;
  if (!nodeData?.schema) {
    // Try to parse from slot_N format
    const match = handleName.match(/slot_(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  const slots = isOutput ? nodeData.schema.outputs : nodeData.schema.inputs;
  const index = slots?.findIndex((s: any) => s.name === handleName);
  return index >= 0 ? index : 0;
}

// Node data interface for type safety
interface FlowNodeData {
  nodeType: string;
  schema?: NodeSchema;
  properties: Record<string, any>;
  title?: string;
  muted?: boolean;
  executionState: 'idle' | 'running' | 'complete' | 'error';
}

/**
 * Convert Svelte Flow graph to executor format
 * (Used when sending graph to backend for execution)
 */
export function convertToExecutorFormat(sfGraph: SvelteFlowGraph): any {
  return {
    version: sfGraph.version,
    name: sfGraph.name,
    description: sfGraph.description,
    cognitiveMode: sfGraph.cognitiveMode,
    nodes: sfGraph.nodes.map((node) => {
      const data = node.data as unknown as FlowNodeData;
      return {
        id: parseInt(node.id) || 0,
        type: data.nodeType,
        pos: [node.position.x, node.position.y],
        properties: data.properties,
        muted: data.muted,
      };
    }),
    links: sfGraph.edges.map((edge, index) => ({
      id: index,
      origin_id: parseInt(edge.source),
      origin_slot: getSlotIndexFromHandle(edge.sourceHandle || '', edge.source, sfGraph.nodes, true),
      target_id: parseInt(edge.target),
      target_slot: getSlotIndexFromHandle(edge.targetHandle || '', edge.target, sfGraph.nodes, false),
    })),
  };
}

// Legacy export alias for compatibility
export const convertLiteGraphToSvelteFlow = enrichGraphWithSchemas;
export const convertSvelteFlowToExecutor = convertToExecutorFormat;
