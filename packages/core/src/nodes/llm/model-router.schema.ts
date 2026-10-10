import type { NodeDefinition } from '../types.js';
import { MODEL_ROLE_OPTIONS } from '../../model-roles.js';

export const modelRouterDefinition: Omit<NodeDefinition, 'execute' | 'color' | 'bgColor' | 'execution'> & { execution: Partial<NodeDefinition['execution']>; propertySchemas: NonNullable<NodeDefinition['propertySchemas']> } = {
  id: 'model_router',
  name: 'Model Router',
  category: 'model',
  execution: { modelOutput: 'response' },
  inputs: [
    { name: 'messages', type: 'array', description: 'Complete provider message array supplied by the upstream prompt/context owner' },
    { name: 'role', type: 'string', optional: true, description: 'Optional runtime role override; a connection takes precedence over Model Role' },
    { name: 'jsonSchema', type: 'object', optional: true, description: 'Upstream structured-output contract applied only in JSON mode' },
    { name: 'precomputedResponse', type: 'string', optional: true, description: 'Exact deterministic output that bypasses model inference when connected' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Normalized model text; downstream nodes own parsing, validation, and effects' },
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
      description: 'Uses the model assigned to this role in the sidebar for the active cognitive mode. A connected role input overrides this setting.',
      options: [...MODEL_ROLE_OPTIONS],
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
  description: 'Calls the profile-resolved model using connected messages. Downstream nodes own validation and effects; rejected output returns as saved feedback to this model without repeating earlier actions.',

};
