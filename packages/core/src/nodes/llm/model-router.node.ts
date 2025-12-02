/**
 * Model Router Node
 *
 * Routes request to appropriate model
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';

export const ModelRouterNode: NodeDefinition = defineNode({
  id: 'model_router',
  name: 'Model Router',
  category: 'model',
  inputs: [
    { name: 'messages', type: 'array', description: 'Messages to send' },
    { name: 'role', type: 'string', optional: true, description: 'Model role' },
  ],
  outputs: [
    { name: 'response', type: 'llm_response', description: 'Model response' },
  ],
  properties: {
    role: 'persona',
    maxTokens: 2048,
    temperature: 0.7,
  },
  propertySchemas: {
    role: {
      type: 'select',
      default: 'persona',
      label: 'Model Role',
      options: ['persona', 'orchestrator', 'fallback', 'coder'],
    },
    maxTokens: {
      type: 'slider',
      default: 2048,
      label: 'Max Tokens',
      min: 256,
      max: 4096,
      step: 256,
    },
    temperature: {
      type: 'slider',
      default: 0.7,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
  },
  description: 'Routes request to appropriate model',

  execute: async (inputs, context, properties) => {
    const messages = inputs[0] || [];
    const role = inputs[1] || properties?.role || 'persona';

    try {
      const response = await callLLM({
        role,
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: properties?.maxTokens || 2048,
          repeatPenalty: properties?.repeatPenalty || 1.15,
          temperature: properties?.temperature || 0.7,
        },
        onProgress: context.emitProgress,
      });

      return { response: response.content };
    } catch (error) {
      console.error('[ModelRouter] Error:', error);
      return {
        response: 'Error routing to model',
        error: (error as Error).message,
      };
    }
  },
});
