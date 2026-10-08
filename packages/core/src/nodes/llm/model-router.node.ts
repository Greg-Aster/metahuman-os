/**
 * Model Router Node
 *
 * Routes request to appropriate model
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { modelRouterDefinition } from './model-router.schema.js';
import { callLLM } from '../../model-router.js';
import { ENVIRONMENT_SELECTOR_JSON_SCHEMA } from '../environment/helpers.js';

export const ModelRouterNode: NodeDefinition = defineNode({
  ...modelRouterDefinition,
  execute: async (inputs, context, properties) => {
    const precomputedResponse = typeof inputs.precomputedResponse === 'string'
      ? inputs.precomputedResponse.trim()
      : '';
    if (precomputedResponse) {
      if (context.modelOutputFeedback) throw new Error('A precomputed response cannot be corrected by model inference');
      return { response: precomputedResponse, precomputed: true };
    }
    const suppliedMessages = inputs.messages ?? inputs[0] ?? [];
    const role = inputs.role || inputs[1] || properties?.role || 'persona';
    const jsonSchema = inputs.jsonSchema
      && typeof inputs.jsonSchema === 'object'
      && !Array.isArray(inputs.jsonSchema)
      ? inputs.jsonSchema as Record<string, unknown>
      : null;
    const username = context.userId || context.username;

    if (!Array.isArray(suppliedMessages) || suppliedMessages.length === 0) {
      return { response: '', skipped: true };
    }

    const feedback = context.modelOutputFeedback;
    const messages = feedback ? [
      ...suppliedMessages,
      { role: 'assistant' as const, content: feedback.response },
      { role: 'user' as const, content: `Output validation failed: ${feedback.error}\nReturn a corrected response to the original input using the supplied output contract.` },
    ] : suppliedMessages;

    const response = await callLLM({
        modelId: properties?.modelId || undefined,
        role,
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: properties?.maxTokens ?? 2048,
          repeatPenalty: properties?.repeatPenalty ?? 1.15,
          temperature: properties?.temperature ?? 0.7,
          format: properties?.format === 'json' ? 'json' : undefined,
          jsonSchema: properties?.format === 'json'
            ? jsonSchema ?? (role === 'environmentActionSelector'
              ? ENVIRONMENT_SELECTOR_JSON_SCHEMA
              : undefined)
            : undefined,
        },
        onProgress: context.emitProgress,
        signal: context.abortSignal,
      });

    return { response: response.content };
  },
});
