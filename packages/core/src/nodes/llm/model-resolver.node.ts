/**
 * Model Resolver Node
 *
 * Resolves which model to use for a given role
 */

import { modelRouterDefinition } from './model-router.schema.js';
import { defineNode, type NodeDefinition } from '../types.js';
import { loadModelRegistry, resolveModel, resolveModelForCognitiveMode, isModelRole } from '../../model-resolver.js';
import { getUserContext } from '../../context.js';
import { listTrainingCandidates } from '../../adapters.js';
import { getActiveFacet } from '../../identity.js';
import { loadMoodSettings } from '../../mood-settings.js';

export const ModelResolverNode: NodeDefinition = defineNode({
  id: 'model_resolver',
  name: 'Model Resolver',
  category: 'model',
  inputs: [
    { name: 'role', type: 'string', optional: true, description: 'Model role to resolve' },
  ],
  outputs: [
    { name: 'modelId', type: 'string', description: 'Resolved model ID' },
    { name: 'model', type: 'string', description: 'Model name' },
    { name: 'provider', type: 'string', description: 'Model provider' },
    { name: 'usingLora', type: 'boolean', description: 'Whether using LoRA adapter' },
    { name: 'includePersonaSummary', type: 'boolean', description: 'Include persona summary' },
  ],
  description: 'Resolves which model to use for a given role',

  properties: { role: 'persona' },
  propertySchemas: { role: modelRouterDefinition.propertySchemas.role },
  execute: async (inputs, context, properties) => {
    const role = inputs.role ?? context.role ?? properties?.role ?? 'persona';

    try {
      if (!isModelRole(role)) throw new Error('Unknown model role: ' + role);
      const username = context.username || getUserContext()?.username;
      if (!username) throw new Error('Model resolution requires a profile');
      const registry = loadModelRegistry(false, username);
      const resolved = context.cognitiveMode
        ? resolveModelForCognitiveMode(context.cognitiveMode, role, username)
        : resolveModel(role, undefined, username);

      const globalSettings = registry.globalSettings || {};
      let includePersonaSummary = globalSettings.includePersonaSummary !== false;

      try {
        const activeFacet = getActiveFacet();
        if (activeFacet === 'inactive') {
          includePersonaSummary = false;
        } else if (!includePersonaSummary) {
          const moodSettings = loadMoodSettings(username);
          includePersonaSummary = moodSettings.overridePersonaDisabled;
        }
      } catch (error) {
        if ((error as Error).name === 'PersonaFacetConfigurationError') throw error;
        console.warn('[ModelResolver] Could not check active facet:', error);
      }

      const candidate = resolved.metadata.trainingRunLabel
        ? listTrainingCandidates(username).find(item => item.runLabel === resolved.metadata.trainingRunLabel)
        : undefined;
      const usingLora = candidate ? candidate.method !== 'fine-tune' : resolved.adapters.length > 0;

      return {
        modelId: resolved.id,
        model: resolved.model,
        provider: resolved.provider,
        usingLora,
        includePersonaSummary,
        role,
      };
    } catch (error) {
      console.error('[ModelResolver] Error:', error);
      throw new Error(`Failed to resolve model: ${(error as Error).message}`);
    }
  },
});
