/**
 * Persona Loader Node
 * Loads persona core configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, _context, _properties) => {
  try {
    const { loadPersonaCore, getActiveFacet } = await import('../../identity.js');
    const persona = loadPersonaCore();
    const activeFacet = getActiveFacet();

    return {
      success: true,
      persona,
      identity: persona.identity,
      personality: persona.personality,
      values: persona.values,
      goals: persona.goals,
      activeFacet,
    };
  } catch (error) {
    console.error('[PersonaLoader] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const PersonaLoaderNode: NodeDefinition = defineNode({
  id: 'persona_loader',
  name: 'Persona Loader',
  category: 'persona',
  inputs: [],
  outputs: [
    { name: 'persona', type: 'object', description: 'Full persona object' },
    { name: 'identity', type: 'object', description: 'Identity data' },
    { name: 'personality', type: 'object', description: 'Personality traits' },
    { name: 'values', type: 'object', description: 'Core values' },
    { name: 'goals', type: 'object', description: 'Goals' },
    { name: 'activeFacet', type: 'string', description: 'Active facet' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Loads persona core configuration',
  execute,
});
