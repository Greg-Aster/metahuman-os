import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { loadPersonaWithFacet } from '../../identity.js';
import { buildPersonaSummary } from '../../persona-summary.js';

const execute: NodeExecutor = async (_inputs, context, _properties) => {
  if (!context.userId) {
    throw new Error('Curator requires a userId to load persona context');
  }

  const persona = loadPersonaWithFacet();
  if (!persona) {
    throw new Error(`Curator requires an active persona context for user ${context.userId}`);
  }

  const personaSummary = buildPersonaSummary(persona);
  if (!personaSummary) {
    throw new Error(`Curator persona context is empty for user ${context.userId}`);
  }

  return {
    personaSummary,
  };
};

export const PersonaSummaryLoaderNode: NodeDefinition = defineNode({
  id: 'persona_summary_loader',
  name: 'Persona Summary Loader',
  category: 'curator',
  inputs: [],
  outputs: [
    { name: 'personaSummary', type: 'string', description: 'Formatted persona summary' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Loads and formats persona data for curator context',
  execute,
});
