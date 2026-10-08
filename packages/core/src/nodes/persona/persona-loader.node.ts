/**
 * Persona Loader Node
 * Loads persona core configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getActiveFacet, loadPersonaWithFacet } from '../../identity.js';
import { PersonaFormatterNode } from '../cognitive/persona-formatter.node.js';

const execute: NodeExecutor = async (_inputs, context, properties) => {
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
      formatted: '',
    };
  }

  const formatted = properties?.formatContext === true
    ? await PersonaFormatterNode.execute({ persona }, context, properties)
    : null;

  return {
    success: true,
    persona,
    identity: persona.identity,
    personality: persona.personality,
    values: persona.values,
    goals: persona.goals,
    activeFacet,
    inactive: false,
    formatted: formatted?.formatted ?? '',
  };
};

export const PersonaLoaderNode: NodeDefinition = defineNode({
  id: 'persona_loader',
  name: 'Persona Loader',
  category: 'persona',
  inputs: [],
  outputs: [
    { name: 'persona', type: 'object', description: 'Full persona object (null if inactive)' },
    { name: 'formatted', type: 'string', description: 'Selected persona sections formatted for model context, when enabled' },
    { name: 'identity', type: 'object', description: 'Identity data' },
    { name: 'personality', type: 'object', description: 'Personality traits' },
    { name: 'values', type: 'object', description: 'Core values' },
    { name: 'goals', type: 'object', description: 'Goals' },
    { name: 'activeFacet', type: 'string', description: 'Active facet' },
    { name: 'inactive', type: 'boolean', description: 'True if persona is inactive (LoRA-only mode)' },
    { name: 'success', type: 'boolean', description: 'Whether persona loading completed' },
  ],
  properties: { formatContext: false, includeValues: true, includeGoals: true, includePersonality: true },
  propertySchemas: {
    formatContext: { type: 'toggle', default: false, label: 'Format Model Context', description: 'Produce formatted persona text as well as the full persona object' },
    includeValues: { type: 'toggle', default: true, label: 'Include Values' },
    includeGoals: { type: 'toggle', default: true, label: 'Include Goals' },
    includePersonality: { type: 'toggle', default: true, label: 'Include Personality' },
  },
  description: 'Loads persona core configuration',
  execute,
});
