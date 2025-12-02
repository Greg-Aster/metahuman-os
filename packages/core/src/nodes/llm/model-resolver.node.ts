/**
 * Model Resolver Node
 *
 * Resolves which model to use for a given role
 */

import { defineNode, type NodeDefinition } from '../types.js';

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

  execute: async (inputs, context) => {
    const role = inputs[0] || context.role || 'persona';

    try {
      const { loadModelRegistry } = await import('../../model-resolver.js');
      const { getActiveFacet } = await import('../../identity.js');

      const registry = loadModelRegistry();

      const fallbackId = registry.defaults?.fallback || 'default.fallback';
      const fallbackModel = registry.models?.[fallbackId];

      if (!fallbackModel?.model) {
        throw new Error('Default fallback model not configured');
      }

      const globalSettings = registry.globalSettings || {};
      let includePersonaSummary = globalSettings.includePersonaSummary !== false;

      try {
        if (getActiveFacet() === 'inactive') {
          includePersonaSummary = false;
        }
      } catch (error) {
        console.warn('[ModelResolver] Could not check active facet:', error);
      }

      let model: string;
      let usingLora = false;

      if (globalSettings.useAdapter && globalSettings.activeAdapter) {
        const adapterInfo = typeof globalSettings.activeAdapter === 'string'
          ? globalSettings.activeAdapter
          : globalSettings.activeAdapter.modelName;
        model = adapterInfo;
        usingLora = true;
      } else {
        model = fallbackModel.model;
        usingLora = false;
      }

      console.log(`[ModelResolver] Resolved model: ${model} (LoRA: ${usingLora})`);

      return {
        modelId: fallbackId,
        model,
        provider: fallbackModel.provider || 'ollama',
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
