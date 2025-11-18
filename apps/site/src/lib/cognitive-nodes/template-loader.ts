/**
 * Template graph loader for cognitive modes
 *
 * This utility helps load pre-built template graphs for each cognitive mode.
 */

export interface CognitiveGraphTemplate {
  version: string;
  name: string;
  description: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  last_modified?: string;
  nodes: any[];
  links: any[];
  config?: any;
  extra?: any;
  groups?: any[];
}

const templateCache: Map<string, CognitiveGraphTemplate> = new Map();

export const builtInTemplateNames = ['dual-mode', 'agent-mode', 'emulation-mode'];

/**
 * Fetch a template from the server
 */
export async function fetchTemplate(name: string): Promise<CognitiveGraphTemplate | null> {
  // Check cache first
  if (templateCache.has(name)) {
    return templateCache.get(name)!;
  }

  try {
    const response = await fetch(`/cognitive-graphs/${name}.json`);
    if (!response.ok) {
      console.error(`Failed to fetch template ${name}: ${response.status}`);
      return null;
    }

    const template = await response.json();
    templateCache.set(name, template);
    return template;
  } catch (error) {
    console.error(`Error fetching template ${name}:`, error);
    return null;
  }
}

/**
 * Get a template by name
 */
export async function getTemplate(name: string): Promise<CognitiveGraphTemplate | null> {
  return await fetchTemplate(name);
}

/**
 * Get template for a specific cognitive mode
 */
export async function getTemplateForMode(mode: 'dual' | 'agent' | 'emulation'): Promise<CognitiveGraphTemplate | null> {
  return await getTemplate(`${mode}-mode`);
}

/**
 * List all available templates
 */
export function listTemplates(): Array<{ id: string; name: string; description: string }> {
  return [
    { id: 'dual-mode', name: 'Dual Consciousness Mode', description: 'Full operator pipeline with ReAct loop' },
    { id: 'agent-mode', name: 'Agent Mode', description: 'Conditional routing (chat vs operator)' },
    { id: 'emulation-mode', name: 'Emulation Mode', description: 'Simple chat-only pipeline' },
  ];
}

/**
 * Convert template to LiteGraph format
 */
export function templateToLiteGraph(template: CognitiveGraphTemplate): any {
  return {
    last_node_id: Math.max(...template.nodes.map(n => n.id), 0),
    last_link_id: Math.max(...template.links.map(l => l.id), 0),
    nodes: template.nodes,
    links: template.links,
    groups: template.groups || [],
    config: template.config || {},
    extra: template.extra || {},
    version: 0.4, // LiteGraph version
  };
}

/**
 * Load a template as a LiteGraph-compatible graph
 */
export function loadTemplateAsGraph(templateName: string): any | null {
  const template = getTemplate(templateName);
  if (!template) return null;

  return templateToLiteGraph(template);
}
