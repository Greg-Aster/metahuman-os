import { defineNode } from '../types.js';
import { parseEnvironmentActions } from './helpers.js';

export const environmentActionParserNode = defineNode({
  id: 'environment_action_parser',
  name: 'Environment Action Parser',
  category: 'environment',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response text, object, or action array' },
    { name: 'instruction', type: 'string', optional: true, description: 'Original environment instruction for fallback action parsing' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Default target session' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Parsed environment actions' },
    { name: 'firstAction', type: 'object', description: 'First parsed action' },
    { name: 'valid', type: 'boolean', description: 'Whether at least one action was parsed' },
    { name: 'error', type: 'string', description: 'Parser error message' },
  ],
  properties: { textFallback: true, naturalMovementFallback: false },
  propertySchemas: {
    textFallback: {
      type: 'toggle',
      default: true,
      label: 'Plain Text Sends Chat',
      description: 'Treat non-JSON text as a sendText action.',
    },
    naturalMovementFallback: {
      type: 'toggle',
      default: false,
      label: 'Natural Movement Fallback',
      description: 'Treat simple movement instructions like "walk forward ten steps" as move actions.',
    },
  },
  description: 'Parses model output into environment actions.',
  async execute(inputs, _context, properties) {
    try {
      const sessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined;
      const naturalMovementFallback = properties?.naturalMovementFallback !== false;
      const hasInstruction = typeof inputs.instruction === 'string' && inputs.instruction.trim().length > 0;
      const responseActions = parseEnvironmentActions(
        inputs.response,
        sessionId,
        properties?.textFallback !== false,
        naturalMovementFallback && !hasInstruction,
      );
      const instructionActions = hasInstruction && naturalMovementFallback
        ? parseEnvironmentActions(inputs.instruction, sessionId, false, true)
        : [];
      const responseHasControlAction = responseActions.some(action => action.type !== 'sendText');
      const actions = responseHasControlAction || instructionActions.length === 0
        ? responseActions
        : [...instructionActions, ...responseActions];

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
