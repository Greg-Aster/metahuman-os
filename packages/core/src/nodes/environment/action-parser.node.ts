import { defineNode } from '../types.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { parseDirectRobotInstruction, parseEnvironmentModelOutput } from './helpers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedCommand(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function unsupportedRobotCommand(
  actions: Array<{ type?: string; command?: string }>,
  advertised: string[] | undefined,
): string | null {
  if (!advertised?.length) return null;
  const supported = new Set(advertised.map(normalizedCommand));
  const action = actions.find(candidate => (
    candidate.type === 'robotCommand'
    && typeof candidate.command === 'string'
    && !supported.has(normalizedCommand(candidate.command))
  ));
  return action?.command?.trim() || null;
}

export const environmentActionParserNode = defineNode({
  id: 'environment_action_parser',
  name: 'Environment Action Parser',
  category: 'environment',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response text, object, or action array' },
    { name: 'instruction', type: 'string', optional: true, description: 'Original user instruction for narrow semantic command fallback' },
    { name: 'observation', type: 'object', optional: true, description: 'Observation containing adapter-advertised robot commands' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Default target session' },
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Current-turn action authorization from the Environment Context Router' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Parsed environment actions' },
    { name: 'firstAction', type: 'object', description: 'First parsed action' },
    { name: 'movementRequest', type: 'object', description: 'Eligible off-script movement request for Movement Generator' },
    { name: 'movementRequested', type: 'boolean', description: 'Whether the model deliberately requested off-script movement generation' },
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
      const instruction = typeof inputs.instruction === 'string' ? inputs.instruction.trim() : '';
      const routingAnalysis = isRecord(inputs.routingAnalysis) ? inputs.routingAnalysis : null;
      const hasRoutingDecision = typeof routingAnalysis?.needsAction === 'boolean';
      const currentActionAuthorized = !hasRoutingDecision || routingAnalysis?.needsAction === true;
      const routerRequestedMovement = routingAnalysis?.needsAction === true
        && routingAnalysis?.actionType === 'robot_movement';
      const parsed = parseEnvironmentModelOutput(inputs.response, sessionId);
      const unsupportedCommand = unsupportedRobotCommand(
        parsed.actions,
        observation?.capabilities?.robotCommands,
      );
      const movementSupported = observation?.capabilities?.actions?.includes('robotMotionPlan') === true;
      const direct = parseDirectRobotInstruction(
        instruction,
        sessionId,
        observation?.capabilities?.robotCommands,
      );
      const modelRobotCommand = !direct
        ? parsed.actions.find(action => action.type === 'robotCommand' && typeof action.command === 'string')?.command
        : undefined;
      const hasSupportedModelRobotCommand = Boolean(modelRobotCommand && !unsupportedCommand);
      const requiresGeneratedMovement = !direct && Boolean(
        hasRoutingDecision
          ? routerRequestedMovement && (
              parsed.movementRequest
                || unsupportedCommand
                || !hasSupportedModelRobotCommand
            )
          : parsed.movementRequest || unsupportedCommand,
      );
      const movementRequestError = hasRoutingDecision && !routerRequestedMovement
        ? ''
        : parsed.movementRequestError;
      const movementRequested = Boolean(movementRequestError || requiresGeneratedMovement);
      const movementRequest = !direct && requiresGeneratedMovement && movementSupported
        ? {
            ...(parsed.movementRequest ?? { sessionId }),
            // The first LLM may choose this branch, but may not rewrite the
            // user-authorized movement that the dedicated generator receives.
            description: instruction
              || parsed.movementRequest?.description
              || `perform the requested ${unsupportedCommand || modelRobotCommand || 'off-script'} movement`,
          }
        : null;
      const actions = direct
        ? [direct.action]
        : movementRequest
          ? []
          : currentActionAuthorized
            ? parsed.actions.filter(action => !unsupportedRobotCommand(
                [action],
                observation?.capabilities?.robotCommands,
              ))
            : [];
      const movementError = direct ? '' : movementRequestError
        || (requiresGeneratedMovement && !movementSupported
          ? 'Off-script movement is unavailable because this robot does not advertise robotMotionPlan.'
          : '');
      const response = movementError || direct?.response || parsed.response || '';
      const valid = actions.length > 0 || movementRequest !== null;

      return {
        actions,
        firstAction: actions[0] ?? null,
        movementRequest,
        movementRequested,
        valid,
        error: valid ? '' : movementError || 'No valid environment actions found',
        response,
      };
    } catch (error) {
      return {
        actions: [],
        firstAction: null,
        movementRequest: null,
        movementRequested: false,
        valid: false,
        error: (error as Error).message,
        response: '',
      };
    }
  },
});
