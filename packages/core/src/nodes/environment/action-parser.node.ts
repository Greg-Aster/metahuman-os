import { defineNode } from '../types.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { parseDirectRobotInstruction, parseEnvironmentModelOutput } from './helpers.js';

export const environmentActionParserNode = defineNode({
  id: 'environment_action_parser',
  name: 'Environment Action Parser',
  category: 'environment',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response text, object, or action array' },
    { name: 'instruction', type: 'string', optional: true, description: 'Original user instruction for narrow semantic command fallback' },
    { name: 'observation', type: 'object', optional: true, description: 'Observation containing adapter-advertised robot commands' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Default target session' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Parsed environment actions' },
    { name: 'firstAction', type: 'object', description: 'First parsed action' },
    { name: 'valid', type: 'boolean', description: 'Whether at least one action was parsed' },
    { name: 'error', type: 'string', description: 'Parser error message' },
    { name: 'response', type: 'string', description: 'Conversational response separated from the structured action list' },
  ],
  description: 'Separates a structured model response into conversational text and validated semantic actions.',
  async execute(inputs) {
    try {
      const sessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined;
      const observation = inputs.observation && typeof inputs.observation === 'object'
        ? inputs.observation as EnvironmentObservation
        : undefined;
      const parsed = parseEnvironmentModelOutput(inputs.response, sessionId);
      const fallback = parsed.actions.length === 0
        ? parseDirectRobotInstruction(
            inputs.instruction,
            sessionId,
            observation?.capabilities?.robotCommands,
          )
        : null;
      const actions = fallback ? [fallback.action] : parsed.actions;
      const response = parsed.response || fallback?.response || '';

      return {
        actions,
        firstAction: actions[0] ?? null,
        valid: actions.length > 0,
        error: actions.length > 0 ? '' : 'No valid environment actions found',
        response,
      };
    } catch (error) {
      return {
        actions: [],
        firstAction: null,
        valid: false,
        error: (error as Error).message,
        response: '',
      };
    }
  },
});
