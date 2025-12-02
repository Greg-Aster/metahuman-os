/**
 * Identity Extractor Node
 * Extracts specific fields from persona identity
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const field = properties?.field || 'all';
  const persona = inputs[0];

  try {
    let source = persona;

    // If no input, load persona
    if (!persona) {
      const { loadPersonaCore } = await import('../../identity.js');
      source = loadPersonaCore();
    }

    if (field === 'all') {
      return {
        success: true,
        ...source.identity,
      };
    } else {
      return {
        success: true,
        field,
        value: source.identity?.[field] || null,
      };
    }
  } catch (error) {
    console.error('[IdentityExtractor] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const IdentityExtractorNode: NodeDefinition = defineNode({
  id: 'identity_extractor',
  name: 'Identity Extractor',
  category: 'persona',
  inputs: [
    { name: 'persona', type: 'object', optional: true, description: 'Persona data (loads if not provided)' },
  ],
  outputs: [
    { name: 'field', type: 'string', description: 'Extracted field name' },
    { name: 'value', type: 'any', description: 'Extracted value' },
  ],
  properties: {
    field: 'all',
  },
  propertySchemas: {
    field: {
      type: 'select',
      default: 'all',
      label: 'Field',
      options: ['all', 'name', 'role', 'purpose', 'bio'],
    },
  },
  description: 'Extracts specific fields from persona identity',
  execute,
});
