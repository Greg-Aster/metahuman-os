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
import type { CognitiveGraph } from './cognitive-graph-schema.js';
import { executeGraph, type GraphExecutionState, type ExecutionEventHandler } from './graph-executor.js';
import { audit } from './audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Template directory (relative to this file, which is in packages/core/src)
const TEMPLATES_DIR = path.resolve(__dirname, '../../../apps/site/src/lib/cognitive-nodes/templates');

export interface AgentTemplate {
  name: string;
  description: string;
  version: string;
  category: string;
  nodes: any[];
  links: any[];
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
  try {
    const templatePath = path.join(TEMPLATES_DIR, `${templateName}.json`);

    if (!fs.existsSync(templatePath)) {
      console.error(`[AgentGraphExecutor] Template not found: ${templatePath}`);
      return null;
    }

    const content = fs.readFileSync(templatePath, 'utf-8');
    const template = JSON.parse(content);

    return template;
  } catch (error) {
    console.error(`[AgentGraphExecutor] Error loading template ${templateName}:`, error);
    return null;
  }
}

/**
 * List all available agent templates
 */
export function listAgentTemplates(): Array<{ name: string; description: string; category: string }> {
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
    console.error('[AgentGraphExecutor] Error listing templates:', error);
    return [];
  }
}

/**
 * Convert agent template to cognitive graph format
 */
function templateToGraph(template: AgentTemplate): CognitiveGraph {
  return {
    name: template.name,
    description: template.description || '',
    version: template.version || '1.0.0',
    nodes: template.nodes.map(node => ({
      id: node.id,
      type: node.type,
      properties: node.properties || {},
      pos: (node.position || [0, 0]) as [number, number],
    })),
    links: template.links.map(link => ({
      id: link.id,
      origin_id: link.origin_id,
      origin_slot: link.origin_slot,
      target_id: link.target_id,
      target_slot: link.target_slot,
    })),
  };
}

/**
 * Execute an agent template by name
 */
export async function executeAgentTemplate(
  templateName: string,
  context: Record<string, any> = {},
  eventHandler?: ExecutionEventHandler
): Promise<GraphExecutionState> {
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

    console.log(`[AgentGraphExecutor] Executing template: ${template.name}`);
    console.log(`[AgentGraphExecutor] Nodes: ${template.nodes.length}, Links: ${template.links.length}`);

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
    if (!template.links || !Array.isArray(template.links)) errors.push('Template missing valid links array');

    // Check nodes have IDs and types
    template.nodes.forEach((node, index) => {
      if (node.id === undefined) errors.push(`Node ${index} missing id`);
      if (!node.type) errors.push(`Node ${index} missing type`);
    });

    // Check links reference valid nodes
    const nodeIds = new Set(template.nodes.map(n => n.id));
    template.links.forEach((link, index) => {
      if (!nodeIds.has(link.origin_id)) {
        errors.push(`Link ${index}: origin node ${link.origin_id} does not exist`);
      }
      if (!nodeIds.has(link.target_id)) {
        errors.push(`Link ${index}: target node ${link.target_id} does not exist`);
      }
    });

    return { valid: errors.length === 0, errors };

  } catch (error) {
    errors.push(`Validation error: ${(error as Error).message}`);
    return { valid: false, errors };
  }
}
