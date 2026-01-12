/**
 * Agent Graph Executor
 *
 * Provides utilities for loading and executing agent workflow graphs
 * from template files. Agents like organizer, reflector, dreamer can
 * now be defined as visual node graphs instead of hardcoded TypeScript.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SvelteFlowGraph } from './cognitive-graph-schema.js';
import { executeGraph, type GraphExecutionState, type ExecutionEventHandler } from './graph-executor.js';
import { audit } from './audit.js';

const LOG_PREFIX = '[agent-graph-executor]';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Template directory (relative to this file, which is in packages/core/src)
const TEMPLATES_DIR = path.resolve(__dirname, '../../../apps/site/src/lib/cognitive-nodes/templates');

export interface TemplateNode {
  id: string | number;
  type: string;
  title?: string;
  position?: number[] | { x: number; y: number };
  properties?: Record<string, unknown>;
  data?: {
    label?: string;
    nodeType?: string;
    properties?: Record<string, unknown>;
  };
}

export interface TemplateEdge {
  id: string | number;
  source?: string | number;
  target?: string | number;
  origin_id?: string | number;
  target_id?: string | number;
  origin_slot?: number;
  target_slot?: number;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface AgentTemplate {
  name: string;
  description: string;
  version: string;
  category: string;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
  metadata?: {
    author?: string;
    created?: string;
    tags?: string[];
    executionMode?: 'manual' | 'scheduled' | 'triggered';
    scheduledInterval?: number;
  };
}

/**
 * Load an agent template from disk
 */
export function loadAgentTemplate(templateName: string): AgentTemplate | null {
  console.log(`${LOG_PREFIX} ========== loadAgentTemplate HIT ==========`);
  console.log(`${LOG_PREFIX} Input: templateName=${templateName}`);
  
  try {
    const templatePath = path.join(TEMPLATES_DIR, `${templateName}.json`);

    if (!fs.existsSync(templatePath)) {
      console.error(`${LOG_PREFIX} Template not found: ${templatePath}`);
      return null;
    }

    const content = fs.readFileSync(templatePath, 'utf-8');
    const template = JSON.parse(content);

    return template;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading template ${templateName}:`, error);
    return null;
  }
}

/**
 * List all available agent templates
 */
export function listAgentTemplates(): Array<{ name: string; description: string; category: string }> {
  console.log(`${LOG_PREFIX} ========== listAgentTemplates HIT ==========`);
  
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      return [];
    }

    const files = fs.readdirSync(TEMPLATES_DIR);
    const templates: Array<{ name: string; description: string; category: string }> = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const templateName = file.replace('.json', '');
        const template = loadAgentTemplate(templateName);

        if (template) {
          templates.push({
            name: templateName,
            description: template.description || 'No description',
            category: template.category || 'agent',
          });
        }
      }
    }

    return templates;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error listing templates:`, error);
    return [];
  }
}

/**
 * Convert agent template to Svelte Flow graph format
 */
function templateToGraph(template: AgentTemplate): SvelteFlowGraph {
  return {
    format: 'svelte-flow',
    name: template.name,
    description: template.description || '',
    version: template.version || '1.0.0',
    nodes: template.nodes.map(node => ({
      id: String(node.id),
      type: node.type || 'cognitiveNode',
      position: {
        x: node.position?.[0] ?? node.position?.x ?? 0,
        y: node.position?.[1] ?? node.position?.y ?? 0,
      },
      data: {
        label: node.title || node.data?.label || node.type,
        nodeType: node.data?.nodeType || node.type,
        properties: node.properties || node.data?.properties || {},
      },
    })),
    edges: template.edges.map(edge => ({
      id: String(edge.id),
      source: String(edge.source || edge.origin_id),
      target: String(edge.target || edge.target_id),
      sourceHandle: edge.sourceHandle || `output_${edge.origin_slot || 0}`,
      targetHandle: edge.targetHandle || `input_${edge.target_slot || 0}`,
    })),
  };
}

/**
 * Execute an agent template by name
 */
export async function executeAgentTemplate(
  templateName: string,
  context: Record<string, unknown> = {},
  eventHandler?: ExecutionEventHandler
): Promise<GraphExecutionState> {
  console.log(`${LOG_PREFIX} ========== executeAgentTemplate HIT ==========`);
  console.log(`${LOG_PREFIX} Input: templateName=${templateName}, contextKeys=${Object.keys(context).join(',')}`);
  
  const startTime = Date.now();

  audit({
    level: 'info',
    category: 'agent',
    event: 'agent_graph_execution_started',
    details: {
      templateName,
      timestamp: startTime,
    },
  });

  try {
    // Load the template
    const template = loadAgentTemplate(templateName);

    if (!template) {
      throw new Error(`Agent template '${templateName}' not found`);
    }

    console.log(`${LOG_PREFIX} Executing template: ${template.name}`);
    console.log(`${LOG_PREFIX} Nodes: ${template.nodes.length}, Edges: ${template.edges.length}`);

    // Convert to cognitive graph format
    const graph = templateToGraph(template);

    // Execute the graph
    const result = await executeGraph(graph, context, eventHandler);

    const duration = Date.now() - startTime;

    audit({
      level: 'info',
      category: 'agent',
      event: 'agent_graph_execution_completed',
      details: {
        templateName,
        status: result.status,
        duration,
        nodesExecuted: result.nodes.size,
      },
    });

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;

    audit({
      level: 'error',
      category: 'agent',
      event: 'agent_graph_execution_failed',
      details: {
        templateName,
        error: (error as Error).message,
        duration,
      },
    });

    throw error;
  }
}

/**
 * Get template metadata without executing
 */
export function getAgentTemplateMetadata(templateName: string): AgentTemplate['metadata'] | null {
  const template = loadAgentTemplate(templateName);
  return template?.metadata || null;
}

/**
 * Validate that a template exists and is well-formed
 */
export function validateAgentTemplate(templateName: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const template = loadAgentTemplate(templateName);

    if (!template) {
      errors.push(`Template '${templateName}' not found`);
      return { valid: false, errors };
    }

    // Check required fields
    if (!template.name) errors.push('Template missing required field: name');
    if (!template.description) errors.push('Template missing required field: description');
    if (!template.nodes || !Array.isArray(template.nodes)) errors.push('Template missing valid nodes array');
    if (!template.edges || !Array.isArray(template.edges)) errors.push('Template missing valid edges array');

    // Check nodes have IDs and types
    template.nodes.forEach((node: TemplateNode, index: number) => {
      if (node.id === undefined) errors.push(`Node ${index} missing id`);
      if (!node.type && !node.data?.nodeType) errors.push(`Node ${index} missing type`);
    });

    // Check edges reference valid nodes
    const nodeIds = new Set(template.nodes.map((n: TemplateNode) => String(n.id)));
    template.edges.forEach((edge: TemplateEdge, index: number) => {
      const sourceId = String(edge.source || edge.origin_id);
      const targetId = String(edge.target || edge.target_id);
      if (!nodeIds.has(sourceId)) {
        errors.push(`Edge ${index}: source node ${sourceId} does not exist`);
      }
      if (!nodeIds.has(targetId)) {
        errors.push(`Edge ${index}: target node ${targetId} does not exist`);
      }
    });

    return { valid: errors.length === 0, errors };

  } catch (error) {
    errors.push(`Validation error: ${(error as Error).message}`);
    return { valid: false, errors };
  }
}
