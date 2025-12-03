/**
 * Unified Node Definition Types
 *
 * This file defines the unified NodeDefinition interface that combines
 * schema (visual editor) and executor (runtime) in a single definition.
 *
 * Industry standard pattern based on ComfyUI, Unreal Blueprints, and Node-RED.
 */

// ============================================================================
// CATEGORY TYPES
// ============================================================================

export type NodeCategory =
  | 'input'
  | 'router'
  | 'context'
  | 'operator'
  | 'chat'
  | 'model'
  | 'skill'
  | 'output'
  | 'control_flow'
  | 'memory'
  | 'utility'
  | 'agent'
  | 'config'
  | 'persona'
  | 'thought'
  | 'dreamer'
  | 'curiosity'
  | 'curator'
  | 'safety'
  | 'emulation';

// ============================================================================
// SLOT TYPES (for node inputs/outputs)
// ============================================================================

export type SlotType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'message'
  | 'context'
  | 'cognitiveMode'
  | 'user'
  | 'memory'
  | 'skill_result'
  | 'llm_response'
  | 'decision'
  | 'any';

export interface NodeSlot {
  name: string;
  type: SlotType;
  optional?: boolean;
  description?: string;
}

// ============================================================================
// PROPERTY TYPES (for node configuration)
// ============================================================================

export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'slider'
  | 'color'
  | 'json'
  | 'text_multiline';

export interface PropertySchema {
  type: PropertyType;
  default: any;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[] | { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  rows?: number;
  validation?: (value: any) => boolean | string;
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

export interface ProgressEvent {
  type: 'model_loading' | 'model_waiting' | 'model_ready' | 'model_switch' | 'status';
  message: string;
  model?: string;
  currentModel?: string;
  elapsedMs?: number;
}

export interface NodeExecutionContext {
  sessionId?: string;
  userId?: string;
  userMessage?: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  conversationHistory?: any[];
  contextPackage?: any;
  contextInfo?: string;
  allowMemoryWrites?: boolean;
  useOperator?: boolean;
  audioBuffer?: Buffer | ArrayBuffer;
  audioFormat?: 'wav' | 'webm' | 'mp3';
  emitProgress?: (event: ProgressEvent) => void;
  [key: string]: any;
}

export type NodeExecutor = (
  inputs: Record<string, any>,
  context: NodeExecutionContext,
  nodeProperties?: Record<string, any>
) => Promise<Record<string, any>>;

// ============================================================================
// UNIFIED NODE DEFINITION
// ============================================================================

/**
 * Unified Node Definition
 *
 * Combines schema (visual representation) and executor (runtime logic)
 * in a single, self-contained definition.
 *
 * Each node file exports one NodeDefinition that includes:
 * - Visual metadata (id, name, category, colors)
 * - Input/output slot definitions
 * - Property schemas for configuration
 * - The execute() function for runtime behavior
 */
export interface NodeDefinition {
  // ---- Identity ----
  /** Unique identifier (e.g., 'user_input', 'persona_llm') */
  id: string;
  /** Display name shown in visual editor */
  name: string;
  /** Category for grouping in palette */
  category: NodeCategory;

  // ---- Visual ----
  /** Text/border color (hex) */
  color: string;
  /** Background color (hex) */
  bgColor: string;
  /** Optional default size [width, height] */
  size?: [number, number];

  // ---- Schema ----
  /** Input slot definitions */
  inputs: NodeSlot[];
  /** Output slot definitions */
  outputs: NodeSlot[];
  /** Default property values */
  properties?: Record<string, any>;
  /** Rich property schemas for auto-generating widgets */
  propertySchemas?: Record<string, PropertySchema>;
  /** Help text / documentation */
  description: string;

  // ---- Executor ----
  /** Runtime execution function */
  execute: NodeExecutor;

  // ---- Metadata ----
  /** Schema version for migration support */
  version?: string;
  /** Mark as deprecated (will show warning in editor) */
  deprecated?: boolean;
  /** Alternative node IDs that should resolve to this node */
  aliases?: string[];
  /** Tags for search/filtering */
  tags?: string[];
}

// ============================================================================
// CATEGORY COLORS
// ============================================================================

export const categoryColors: Record<NodeCategory, { color: string; bgColor: string }> = {
  input: { color: '#4ade80', bgColor: '#166534' },      // Green
  router: { color: '#fbbf24', bgColor: '#92400e' },     // Amber
  context: { color: '#60a5fa', bgColor: '#1e3a8a' },    // Blue
  operator: { color: '#a78bfa', bgColor: '#5b21b6' },   // Purple
  chat: { color: '#f472b6', bgColor: '#9f1239' },       // Pink
  model: { color: '#fb923c', bgColor: '#9a3412' },      // Orange
  skill: { color: '#34d399', bgColor: '#065f46' },      // Emerald
  output: { color: '#ef4444', bgColor: '#991b1b' },     // Red
  control_flow: { color: '#818cf8', bgColor: '#4338ca' }, // Indigo
  memory: { color: '#c084fc', bgColor: '#7e22ce' },     // Violet
  utility: { color: '#94a3b8', bgColor: '#475569' },    // Slate
  agent: { color: '#22d3ee', bgColor: '#155e75' },      // Cyan
  config: { color: '#fde047', bgColor: '#854d0e' },     // Yellow
  persona: { color: '#e879f9', bgColor: '#86198f' },    // Fuchsia
  thought: { color: '#67e8f9', bgColor: '#0e7490' },    // Sky
  dreamer: { color: '#d8b4fe', bgColor: '#6b21a8' },    // Light Purple
  curiosity: { color: '#fcd34d', bgColor: '#a16207' },  // Gold
  curator: { color: '#86efac', bgColor: '#14532d' },    // Light Green
  safety: { color: '#fca5a5', bgColor: '#7f1d1d' },     // Light Red
  emulation: { color: '#a5b4fc', bgColor: '#3730a3' },  // Light Indigo
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Type guard to check if an object is a valid NodeDefinition
 */
export function isNodeDefinition(obj: unknown): obj is NodeDefinition {
  if (typeof obj !== 'object' || obj === null) return false;
  const node = obj as Partial<NodeDefinition>;
  return (
    typeof node.id === 'string' &&
    typeof node.name === 'string' &&
    typeof node.category === 'string' &&
    typeof node.execute === 'function' &&
    Array.isArray(node.inputs) &&
    Array.isArray(node.outputs)
  );
}

/**
 * Helper to create a node definition with category colors applied
 */
export function defineNode(
  definition: Omit<NodeDefinition, 'color' | 'bgColor'> & { color?: string; bgColor?: string }
): NodeDefinition {
  const colors = categoryColors[definition.category];
  return {
    ...definition,
    color: definition.color ?? colors.color,
    bgColor: definition.bgColor ?? colors.bgColor,
  };
}

// ============================================================================
// SCHEMA EXTRACTION (for frontend compatibility)
// ============================================================================

/**
 * Extract just the schema portion (for frontend visual editor)
 * This maintains backward compatibility with the existing frontend
 */
export interface NodeSchema {
  id: string;
  name: string;
  category: NodeCategory;
  color: string;
  bgColor: string;
  inputs: NodeSlot[];
  outputs: NodeSlot[];
  properties?: Record<string, any>;
  propertySchemas?: Record<string, PropertySchema>;
  description: string;
  size?: [number, number];
}

/**
 * Extract schema from a NodeDefinition (drops the execute function)
 */
export function extractSchema(node: NodeDefinition): NodeSchema {
  return {
    id: node.id,
    name: node.name,
    category: node.category,
    color: node.color,
    bgColor: node.bgColor,
    inputs: node.inputs,
    outputs: node.outputs,
    properties: node.properties,
    propertySchemas: node.propertySchemas,
    description: node.description,
    size: node.size,
  };
}
