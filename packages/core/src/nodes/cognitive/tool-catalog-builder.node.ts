/**
 * Tool Catalog Builder Node
 * Builds a catalog of available tools/skills for LLM prompts
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getCachedCatalog, getCatalogEntries } from '../../tool-catalog.js';

const execute: NodeExecutor = async (_inputs, _context, _properties) => {
  try {
    const catalog = getCachedCatalog();
    const entries = getCatalogEntries();

    return {
      catalog,
      toolCount: entries.length,
      entries,
    };
  } catch (error) {
    console.error('[ToolCatalogBuilder] Error:', error);
    return {
      catalog: 'No tools available.',
      toolCount: 0,
      error: (error as Error).message,
    };
  }
};

export const ToolCatalogBuilderNode: NodeDefinition = defineNode({
  id: 'tool_catalog_builder',
  name: 'Tool Catalog Builder',
  category: 'cognitive',
  inputs: [],
  outputs: [
    { name: 'catalog', type: 'string', description: 'Formatted tool catalog' },
    { name: 'toolCount', type: 'number', description: 'Number of tools' },
    { name: 'entries', type: 'array', description: 'Structured catalog entries' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Builds a catalog of available tools/skills for planning',
  execute,
});
