/**
 * Persona Saver Node
 * Saves persona core configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  const persona = inputs[0];

  if (!persona) {
    return {
      success: false,
      error: 'Persona data required',
    };
  }

  try {
    const { savePersonaCore } = await import('../../identity.js');
    savePersonaCore(persona);

    return {
      success: true,
      saved: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[PersonaSaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const PersonaSaverNode: NodeDefinition = defineNode({
  id: 'persona_saver',
  name: 'Persona Saver',
  category: 'persona',
  inputs: [
    { name: 'persona', type: 'object', description: 'Persona data to save' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'saved', type: 'boolean' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Saves persona core configuration',
  execute,
});
