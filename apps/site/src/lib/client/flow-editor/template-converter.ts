/**
 * Template Converter
 *
 * Enriches Svelte Flow templates with schema data.
 * All templates are now in Svelte Flow format (migrated from LiteGraph).
 *
 * Schemas are loaded through the API-backed core schema owner and cached here.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { NodeSchema, NodeCategory } from '@metahuman/core/nodes/types';
import { apiFetch } from '../api-config';
import { getNodeComponentType } from './node-component-map';

// Svelte Flow format
export interface SvelteFlowGraph {
  version: string;
  name: string;
  description: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation' | 'environment';
  nodes: Node[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
}

const schemaCache: Map<string, NodeSchema> = new Map();
let schemaLoadPromise: Promise<void> | null = null;

function cacheSchemas(schemas: NodeSchema[]): void {
  schemaCache.clear();
  for (const schema of schemas) {
    schemaCache.set(schema.id, schema);
    // Also map with cognitive/ prefix for backwards compatibility
    schemaCache.set(`cognitive/${schema.id}`, schema);
    for (const alias of schema.aliases || []) {
      schemaCache.set(alias, schema);
      schemaCache.set(`cognitive/${alias}`, schema);
    }
  }
}

function clonePropertyValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => clonePropertyValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    const cloned: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      cloned[key] = clonePropertyValue(nestedValue);
    }
    return cloned as T;
  }

  return value;
}

export function materializeSchemaProperties(
  schema: Pick<NodeSchema, 'properties' | 'propertySchemas'> | undefined,
  overrides?: Record<string, any>,
): Record<string, any> {
  const properties: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema?.properties || {})) {
    properties[key] = clonePropertyValue(value);
  }

  for (const [key, propertySchema] of Object.entries(schema?.propertySchemas || {})) {
    if (!(key in properties) && propertySchema && 'default' in propertySchema) {
      properties[key] = clonePropertyValue(propertySchema.default);
    }
  }

  for (const [key, value] of Object.entries(overrides || {})) {
    properties[key] = clonePropertyValue(value);
  }

  return properties;
}

/**
 * Load node schemas from the API-backed core schema owner.
 */
export async function loadSchemas(): Promise<void> {
  if (schemaCache.size > 0) return;
  if (schemaLoadPromise) return schemaLoadPromise;

  schemaLoadPromise = (async () => {
    const response = await apiFetch('/api/node-schemas');
    if (!response.ok) {
      throw new Error(`Failed to load node schemas: ${response.statusText}`);
    }

    const data = await response.json();
    const schemas = Array.isArray(data) ? data : data.schemas;
    if (!Array.isArray(schemas)) {
      throw new Error('Invalid node schema response');
    }

    cacheSchemas(schemas as NodeSchema[]);
    console.log(`[template-converter] Loaded ${schemas.length} schemas`);
  })().finally(() => {
    schemaLoadPromise = null;
  });

  return schemaLoadPromise;
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
    const existingProperties = sfNode.data?.properties || sfNode.properties || {};
    const title = sfNode.data?.label || sfNode.data?.title || sfNode.title;
    const position = sfNode.position || {
      x: Array.isArray(sfNode.pos) ? sfNode.pos[0] : 0,
      y: Array.isArray(sfNode.pos) ? sfNode.pos[1] : 0,
    };

    return {
      id: String(sfNode.id),
      type: getNodeComponentType(category, nodeType),
      position,
      width: sfNode.width || sfNode.size?.[0],
      height: sfNode.height || sfNode.size?.[1],
      data: {
        nodeType: nodeType,
        schema: schema || createFallbackSchema(nodeType),
        properties: schema ? materializeSchemaProperties(schema, existingProperties) : existingProperties,
        title,
        muted: sfNode.data?.muted,
        comment: sfNode.data?.comment,
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

export function serializeGraphForPersistence(sfGraph: SvelteFlowGraph): SvelteFlowGraph {
  return {
    version: sfGraph.version || '1.0',
    name: sfGraph.name || 'Untitled Graph',
    description: sfGraph.description || '',
    cognitiveMode: sfGraph.cognitiveMode,
    nodes: sfGraph.nodes.map((node) => {
      const data = node.data as any;
      const nodeType = data.nodeType || node.type;
      const schema = getSchema(nodeType) || data.schema;
      const properties = schema
        ? materializeSchemaProperties(schema, data.properties || {})
        : (data.properties || {});
      const title = data.label || data.title;

      return {
        id: String(node.id),
        type: node.type,
        position: node.position,
        width: node.width,
        height: node.height,
        data: {
          label: title,
          nodeType,
          properties,
          muted: data.muted,
          comment: data.comment,
        },
      };
    }),
    edges: sfGraph.edges.map((edge) => ({
      id: edge.id,
      source: String(edge.source),
      target: String(edge.target),
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: edge.type,
      data: edge.data || {},
    })),
    viewport: sfGraph.viewport,
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
        properties: materializeSchemaProperties(data.schema, data.properties),
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
