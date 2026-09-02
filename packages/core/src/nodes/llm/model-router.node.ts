/**
 * Model Router Node
 *
 * Routes request to appropriate model
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';
import { ENVIRONMENT_SELECTOR_JSON_SCHEMA } from '../environment/helpers.js';

export const ModelRouterNode: NodeDefinition = defineNode({
  id: 'model_router',
  name: 'Model Router',
  category: 'model',
  inputs: [
    { name: 'messages', type: 'array', description: 'Complete provider message array supplied by the upstream prompt/context owner' },
    { name: 'role', type: 'string', optional: true, description: 'Optional runtime role override; a connection takes precedence over Model Role' },
    { name: 'jsonSchema', type: 'object', optional: true, description: 'Upstream structured-output contract applied only in JSON mode' },
    { name: 'precomputedResponse', type: 'string', optional: true, description: 'Exact deterministic output that bypasses model inference when connected' },
  ],
  outputs: [
    { name: 'response', type: 'llm_response', description: 'Normalized model text; downstream nodes own parsing, validation, and effects' },
  ],
  properties: {
    role: 'persona',
    maxTokens: 2048,
    temperature: 0.7,
    repeatPenalty: 1.15,
    format: 'text',
  },
  propertySchemas: {
    role: {
      type: 'select',
      default: 'persona',
      label: 'Model Role',
      description: 'Routing role resolved through the active profile and cognitive-mode model mapping. A connected role input overrides this setting.',
      options: [
        { value: 'persona', label: 'Persona' },
        { value: 'environmentActionSelector', label: 'Environment Action Selector' },
        { value: 'orchestrator', label: 'Orchestrator' },
        { value: 'fallback', label: 'Fallback' },
        { value: 'coder', label: 'Coder' },
      ],
    },
    maxTokens: {
      type: 'slider',
      default: 2048,
      label: 'Max Tokens',
      description: 'Maximum completion length. A limit that is too small can truncate structured output before it becomes valid JSON.',
      advanced: true,
      min: 256,
      max: 4096,
      step: 256,
    },
    temperature: {
      type: 'slider',
      default: 0.7,
      label: 'Temperature',
      description: 'Sampling randomness. Lower values make routing and structured decisions more repeatable.',
      advanced: true,
      min: 0,
      max: 1,
      step: 0.1,
    },
    repeatPenalty: {
      type: 'number',
      default: 1.15,
      label: 'Repeat Penalty',
      description: 'Provider repetition penalty. A value of 1 is neutral where the selected provider supports it.',
      advanced: true,
      min: 0,
      max: 2,
      step: 0.05,
    },
    format: {
      type: 'select',
      default: 'text',
      label: 'Response Format',
      description: 'JSON mode applies a connected JSON Schema. Text mode ignores the schema input.',
      options: [
        { value: 'text', label: 'Text' },
        { value: 'json', label: 'JSON' },
      ],
    },
  },
  description: 'Calls the profile-resolved model for the configured role using connected messages. It returns model output only; downstream nodes own validation and effects.',

  execute: async (inputs, context, properties) => {
    const precomputedResponse = typeof inputs.precomputedResponse === 'string'
      ? inputs.precomputedResponse.trim()
      : '';
    if (precomputedResponse) {
      return { response: precomputedResponse, precomputed: true };
    }
    const messages = inputs.messages ?? inputs[0] ?? [];
    const role = inputs.role || inputs[1] || properties?.role || 'persona';
    const jsonSchema = inputs.jsonSchema
      && typeof inputs.jsonSchema === 'object'
      && !Array.isArray(inputs.jsonSchema)
      ? inputs.jsonSchema as Record<string, unknown>
      : null;
    const username = context.userId || context.username;

    if (!Array.isArray(messages) || messages.length === 0) {
      return { response: '', skipped: true };
    }

    try {
      const response = await callLLM({
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
      });

      return { response: response.content };
    } catch (error) {
      console.error('[ModelRouter] Error:', error);
      const message = error instanceof Error ? error.message : 'Unknown model routing error';
      return {
        response: `Model routing failed: ${message}`,
        error: message,
      };
    }
  },
});
