/**
 * Persona Loader Node
 * Loads persona core configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getActiveFacet, loadPersonaWithFacet } from '../../identity.js';

const execute: NodeExecutor = async (_inputs, _context, _properties) => {
  const persona = loadPersonaWithFacet();
  const activeFacet = getActiveFacet();

  // Inactive persona is an explicit operating mode, not a load failure.
  if (persona === null) {
    return {
      success: true,
      persona: null,
      identity: null,
      personality: null,
      values: null,
      goals: null,
      activeFacet,
      inactive: true,
    };
  }

  return {
    success: true,
    persona,
    identity: persona.identity,
    personality: persona.personality,
    values: persona.values,
    goals: persona.goals,
    activeFacet,
    inactive: false,
  };
};

export const PersonaLoaderNode: NodeDefinition = defineNode({
  id: 'persona_loader',
  name: 'Persona Loader',
  category: 'persona',
  inputs: [],
  outputs: [
    { name: 'persona', type: 'object', description: 'Full persona object (null if inactive)' },
    { name: 'identity', type: 'object', description: 'Identity data' },
    { name: 'personality', type: 'object', description: 'Personality traits' },
    { name: 'values', type: 'object', description: 'Core values' },
    { name: 'goals', type: 'object', description: 'Goals' },
    { name: 'activeFacet', type: 'string', description: 'Active facet' },
    { name: 'inactive', type: 'boolean', description: 'True if persona is inactive (LoRA-only mode)' },
    { name: 'success', type: 'boolean', description: 'Whether persona loading completed' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Loads persona core configuration',
  execute,
});
