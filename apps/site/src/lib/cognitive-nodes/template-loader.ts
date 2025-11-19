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
 * LiteGraph stores links in a different format than our template
 */
export function templateToLiteGraph(template: CognitiveGraphTemplate): any {
  const normalizedLinks = (template.links || []).map(link => {
    if (Array.isArray(link)) {
      const [id, origin_id, origin_slot, target_id, target_slot, type] = link;
      return { id, origin_id, origin_slot, target_id, target_slot, type };
    }
    return link;
  });

  const nodeMap = new Map<number, any>();

  // Build nodes - DON'T include inputs/outputs as they'll be created by constructors
  // When LiteGraph calls createNode(), the node constructor will add inputs/outputs
  template.nodes.forEach(node => {
    const clone = {
      ...node,
      // Remove inputs/outputs - let the node constructor create them
      inputs: undefined,
      outputs: undefined,
    };
    nodeMap.set(node.id, clone);
  });

  // Don't pre-populate input/output link references - let LiteGraph handle it

  const litegraphLinks = normalizedLinks.map(link => [
    link.id,
    link.origin_id,
    link.origin_slot,
    link.target_id,
    link.target_slot,
    link.type || null,
  ]);

  const orderedNodes = template.nodes.map(node => nodeMap.get(node.id));

  // Debug: Log a sample node to verify structure
  if (orderedNodes.length > 0) {
    console.log('[TemplateLoader] Sample node after processing:', orderedNodes[0]);
    console.log('[TemplateLoader] Total nodes:', orderedNodes.length, 'Total links:', litegraphLinks.length);
  }

  const result = {
    last_node_id: Math.max(...template.nodes.map(n => n.id), 0),
    last_link_id: normalizedLinks.length ? Math.max(...normalizedLinks.map(l => l.id || 0)) : 0,
    nodes: orderedNodes,
    links: litegraphLinks,
    groups: template.groups || [],
    config: template.config || {},
    extra: template.extra || {},
    version: 0.4,
  };

  console.log('[TemplateLoader] Converted template:', {
    nodeCount: result.nodes.length,
    linkCount: result.links.length,
    firstNodeHasInputs: result.nodes[0]?.inputs?.length > 0,
    firstNodeHasOutputs: result.nodes[0]?.outputs?.length > 0,
  });

  return result;
}

/**
 * Load a template as a LiteGraph-compatible graph
 */
export async function loadTemplateAsGraph(templateName: string): Promise<any | null> {
  const template = await getTemplate(templateName);
  if (!template) return null;

  return templateToLiteGraph(template);
}
