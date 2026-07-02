import { defineNode } from '../types.js';
import { parseEnvironmentActions } from './helpers.js';

export const environmentActionParserNode = defineNode({
  id: 'environment_action_parser',
  name: 'Environment Action Parser',
  category: 'environment',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response text, object, or action array' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Default target session' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Parsed environment actions' },
    { name: 'firstAction', type: 'object', description: 'First parsed action' },
    { name: 'valid', type: 'boolean', description: 'Whether at least one action was parsed' },
    { name: 'error', type: 'string', description: 'Parser error message' },
  ],
  properties: { textFallback: true },
  propertySchemas: {
    textFallback: {
      type: 'toggle',
      default: true,
      label: 'Plain Text Sends Chat',
      description: 'Treat non-JSON text as a sendText action.',
    },
  },
  description: 'Parses model output into environment actions.',
  async execute(inputs, _context, properties) {
    try {
      const actions = parseEnvironmentActions(
        inputs.response,
        typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined,
        properties?.textFallback !== false,
      );

      return {
        actions,
        firstAction: actions[0] ?? null,
        valid: actions.length > 0,
        error: actions.length > 0 ? '' : 'No valid environment actions found',
      };
    } catch (error) {
      return {
        actions: [],
        firstAction: null,
        valid: false,
        error: (error as Error).message,
      };
    }
  },
});
