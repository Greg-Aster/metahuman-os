/**
 * Text Template Node
 *
 * String interpolation with variable substitution
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const template = properties?.template || '';
  const variables = inputs[0] || {};

  try {
    let result = template;

    const matches = template.match(/\{\{([^}]+)\}\}/g) || [];
    for (const match of matches) {
      const key = match.replace(/\{\{|\}\}/g, '').trim();
      const value = variables[key] ?? '';
      result = result.replace(match, String(value));
    }

    return {
      text: result,
      template,
      variables,
    };
  } catch (error) {
    console.error('[TextTemplate] Error:', error);
    return {
      text: template,
      error: (error as Error).message,
    };
  }
};

export const TextTemplateNode: NodeDefinition = defineNode({
  id: 'text_template',
  name: 'Text Template',
  category: 'utility',
  inputs: [
    { name: 'variables', type: 'object', description: 'Variables for substitution' },
  ],
  outputs: [
    { name: 'text', type: 'string', description: 'Rendered text' },
  ],
  properties: {
    template: '',
  },
  propertySchemas: {
    template: {
      type: 'text_multiline',
      default: '',
      label: 'Template',
      description: 'Template with {{variable}} placeholders',
      rows: 4,
    },
  },
  description: 'String interpolation with variable substitution',
  execute,
});
