import { defineNode } from '../types.js';
import type {
  EnvironmentAction,
  EnvironmentMotionClass,
  EnvironmentObservation,
} from '../../environment-interface/index.js';
import { validEnvironmentJpegDataUrl } from '../../environment-interface/index.js';
import { readRobotObserverCycle } from '../../robot-operator.js';
import {
  environmentTaskContractFromObservation,
  environmentTaskContractFromRouting,
  normalizedEnvironmentMotionClass,
  parseDirectRobotInstruction,
  parseEnvironmentModelOutput,
  robotOperatorActionRequirement,
} from './helpers.js';

const PHYSICAL_MOTION_ACTIONS = new Set([
  'move',
  'look',
  'jump',
  'robotCommand',
  'robotMotionPlan',
  'inspect',
  'visualApproach',
]);

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

function actionIsAdvertised(
  action: { type?: string },
  observation: EnvironmentObservation | undefined,
): boolean {
  if (!observation) return true;
  return observation.capabilities.actions.includes(action.type as any);
}

function hasTerminalFeedback(observation: EnvironmentObservation | undefined): boolean {
  return observation?.feedback?.some(feedback => (
    feedback.type === 'completed'
    || feedback.type === 'rejected'
    || feedback.type === 'cancelled'
    || feedback.type === 'expired'
    || feedback.type === 'failed'
  )) === true;
}

function isPhysicalMotionAction(action: Partial<EnvironmentAction>): boolean {
  return PHYSICAL_MOTION_ACTIONS.has(action.type ?? '');
}

function targetRelativeCapabilityAvailable(
  observation: EnvironmentObservation | undefined,
): boolean {
  return observation?.capabilities?.motionClasses?.includes('target_relative') === true
    || observation?.capabilities?.navigation === true;
}

function visualFeedbackCapabilityAvailable(
  action: Partial<EnvironmentAction>,
  observation: EnvironmentObservation | undefined,
): boolean {
  if (observation?.capabilities.motionClasses?.includes('target_relative') !== true) return false;
  if (action.type === 'inspect') {
    return observation.capabilities.actions.includes('inspect')
      && Boolean(observation.capabilities.activeView);
  }
  return action.type === 'visualApproach'
    && observation.capabilities.actions.includes('visualApproach')
    && Boolean(observation.capabilities.visualApproach);
}

function activeViewTargetIsCurrent(
  action: Partial<EnvironmentAction>,
  observation: EnvironmentObservation | undefined,
): boolean {
  if (action.type !== 'inspect' && action.type !== 'visualApproach') return true;
  const target = action.type === 'inspect' ? action.inspectionTarget : action.visualTarget;
  if (!target) return false;
  if (!observation) return false;
  const targetTimestamp = Date.parse(target.frameTimestamp);
  const observationTimestamp = Date.parse(observation.timestamp);
  const maxFrameAgeMs = action.type === 'inspect'
    ? observation.capabilities.activeView?.maxFrameAgeMs
    : observation.capabilities.visualApproach?.maxFrameAgeMs;
  const cycle = readRobotObserverCycle(observation);
  return [observation.visual, ...(observation.visuals ?? [])].some(frame => {
    if (!frame || frame.id !== target.frameId) return false;
    const frameTimestamp = Date.parse(frame.timestamp);
    if (
      !Number.isFinite(frameTimestamp)
      || frameTimestamp !== targetTimestamp
      || !validEnvironmentJpegDataUrl(frame.dataUrl)
    ) return false;
    if (Number.isFinite(observationTimestamp) && typeof maxFrameAgeMs === 'number') {
      const frameAgeMs = observationTimestamp - frameTimestamp;
      if (frameAgeMs < -5_000 || frameAgeMs > maxFrameAgeMs) return false;
    }
    return !cycle || (
      observation.metadata?.correlationId === cycle.cycleId
      && frame.metadata?.correlationId === cycle.cycleId
    );
  });
}

function motionActionAllowed(
  action: Partial<EnvironmentAction>,
  motionClass: EnvironmentMotionClass | null,
  observation: EnvironmentObservation | undefined,
): boolean {
  if (!isPhysicalMotionAction(action)) return true;
  if (motionClass === 'body_local') return action.type !== 'move';
  if (motionClass === 'target_relative') {
    return targetRelativeCapabilityAvailable(observation) && (
      ((action.type === 'inspect' || action.type === 'visualApproach')
        && visualFeedbackCapabilityAvailable(action, observation))
      || (action.type === 'move' && observation?.capabilities?.navigation === true)
    );
  }
  if (motionClass === 'open_loop_displacement') {
    return action.type === 'robotCommand' || action.type === 'move';
  }
  return false;
}

function autonomousObservation(observation: EnvironmentObservation | undefined): boolean {
  const cycle = isRecord(observation?.metadata?.robotObserver)
    ? observation.metadata.robotObserver
    : null;
  const command = isRecord(observation?.metadata?.taskValidatorCommand)
    ? observation.metadata.taskValidatorCommand
    : null;
  return observation?.metadata?.boredomMovement !== undefined
    || cycle?.triggerSource === 'autonomy'
    || command?.source === 'autonomy';
}

function motionAdmissionMessage(reason: string): string {
  if (reason === 'motion_class_missing') {
    return 'Movement was not admitted because the Environment route did not provide a typed motion class.';
  }
  if (reason === 'target_relative_capability_unavailable') {
    return 'Target-relative movement is unavailable because this robot does not advertise a target-relative feedback capability.';
  }
  if (reason === 'target_relative_feedback_action_unavailable') {
    return 'Target-relative movement was not admitted because the requested action is open loop rather than a target-feedback action.';
  }
  if (reason === 'target_relative_frame_unavailable') {
    return 'Target-relative movement was not admitted because its target is not bound to the exact current visual frame.';
  }
  if (reason === 'open_loop_requires_direct_user_command') {
    return 'Open-loop displacement requires an explicit direct user movement command.';
  }
  if (reason === 'motion_route_not_authorized') {
    return 'Physical movement was not admitted because the current Environment route did not authorize robot movement.';
  }
  return '';
}

export const environmentActionParserNode = defineNode({
  id: 'environment_action_parser',
  name: 'Environment Action Parser',
  category: 'environment',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response text, object, or action array' },
    { name: 'instruction', type: 'string', optional: true, description: 'Original current-turn instruction for authorized movement generation' },
    { name: 'observation', type: 'object', optional: true, description: 'Observation containing adapter-advertised robot commands' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Default target session' },
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Current-turn action authorization from the Environment Context Router' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Parsed environment actions' },
    { name: 'firstAction', type: 'object', description: 'First parsed action' },
    { name: 'movementRequest', type: 'object', description: 'Eligible off-script movement request for Movement Generator' },
    { name: 'movementRequested', type: 'boolean', description: 'Whether the model deliberately requested off-script movement generation' },
    { name: 'taskDecision', type: 'object', description: 'Structured completion or continuation decision for the task validator' },
    { name: 'taskDecisionError', type: 'string', description: 'Structured task-decision parsing error' },
    { name: 'actionAdmission', type: 'object', description: 'Typed capability admission result for the existing Environment Task Validator' },
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
      const terminalFeedback = hasTerminalFeedback(observation);
      const parsed = parseEnvironmentModelOutput(inputs.response, sessionId);
      const hasRoutingDecision = typeof routingAnalysis?.needsAction === 'boolean';
      const delegatedActionRequirement = robotOperatorActionRequirement(observation);
      const currentActionAuthorized = !terminalFeedback
        && (delegatedActionRequirement !== null
          ? delegatedActionRequirement
          : !hasRoutingDecision || routingAnalysis?.needsAction === true);
      const routerRequestedMovement = currentActionAuthorized
        && (delegatedActionRequirement === true || routingAnalysis?.needsAction === true)
        && routingAnalysis?.actionType === 'robot_movement';
      const routedContract = environmentTaskContractFromRouting(routingAnalysis);
      const persistedContract = environmentTaskContractFromObservation(observation);
      const routedMotionClass = isRecord(routingAnalysis?.actionParams)
        ? normalizedEnvironmentMotionClass(routingAnalysis.actionParams.motionClass)
        : null;
      const motionClass = persistedContract?.motionClass
        ?? routedContract?.motionClass
        ?? routedMotionClass;
      const connectedSession = Boolean(sessionId || observation?.sessionId);
      const unsupportedCommand = unsupportedRobotCommand(
        parsed.actions,
        observation?.capabilities?.robotCommands,
      );
      const movementSupported = observation?.capabilities?.actions?.includes('robotMotionPlan') === true;
      const unavailableAction = parsed.actions.find(action => !actionIsAdvertised(action, observation));
      const direct = terminalFeedback
        ? null
        : delegatedActionRequirement === null
          ? parseDirectRobotInstruction(
            instruction,
            sessionId,
            observation?.capabilities?.robotCommands,
          )
          : null;
      const openLoopUserAuthorized = delegatedActionRequirement === null
        && !autonomousObservation(observation);
      const supportedParsedActions = parsed.actions.filter(action => (
        actionIsAdvertised(action, observation)
        && !unsupportedRobotCommand([action], observation?.capabilities?.robotCommands)
      ));
      const hasNonMotionAlternative = supportedParsedActions.some(action => !isPhysicalMotionAction(action));
      const targetCapabilityAvailable = targetRelativeCapabilityAvailable(observation);
      const targetFeedbackActionAvailable = supportedParsedActions.some(action => (
        targetCapabilityAvailable && (
          ((action.type === 'inspect' || action.type === 'visualApproach')
            && visualFeedbackCapabilityAvailable(action, observation))
          || (action.type === 'move' && observation?.capabilities?.navigation === true)
        )
      ));
      const targetFrameAvailable = supportedParsedActions.some(action => (
        (action.type === 'inspect' || action.type === 'visualApproach')
          && activeViewTargetIsCurrent(action, observation)
      ));
      let admissionBlockedReason = '';
      if (routerRequestedMovement && !direct && !hasNonMotionAlternative) {
        if (!motionClass) admissionBlockedReason = 'motion_class_missing';
        else if (motionClass === 'target_relative' && !targetCapabilityAvailable) {
          admissionBlockedReason = 'target_relative_capability_unavailable';
        } else if (motionClass === 'target_relative' && !targetFeedbackActionAvailable) {
          admissionBlockedReason = 'target_relative_feedback_action_unavailable';
        } else if (
          motionClass === 'target_relative'
          && supportedParsedActions.some(action => (
            action.type === 'inspect' || action.type === 'visualApproach'
          ))
          && !targetFrameAvailable
        ) {
          admissionBlockedReason = 'target_relative_frame_unavailable';
        } else if (motionClass === 'open_loop_displacement' && !openLoopUserAuthorized) {
          admissionBlockedReason = 'open_loop_requires_direct_user_command';
        }
      } else if (
        hasRoutingDecision
        && currentActionAuthorized
        && !routerRequestedMovement
        && !hasNonMotionAlternative
        && supportedParsedActions.some(isPhysicalMotionAction)
      ) {
        admissionBlockedReason = 'motion_route_not_authorized';
      }
      const admissionBlocked = Boolean(admissionBlockedReason);
      const modelRobotCommand = !direct
        ? parsed.actions.find(
            action => action.type === 'robotCommand' && typeof action.command === 'string',
          )?.command
        : undefined;
      const hasSupportedModelRobotCommand = Boolean(modelRobotCommand && !unsupportedCommand);
      const requiresGeneratedMovement = currentActionAuthorized
        && !direct
        && !admissionBlocked
        && motionClass === 'body_local'
        && Boolean(
        hasRoutingDecision && delegatedActionRequirement === null
          ? routerRequestedMovement && (
              parsed.movementRequest
                || unsupportedCommand
                || !hasSupportedModelRobotCommand
            )
          : parsed.movementRequest || unsupportedCommand,
      );
      const movementRequestError = terminalFeedback
        || (hasRoutingDecision && delegatedActionRequirement === null && !routerRequestedMovement)
        ? ''
        : parsed.movementRequestError;
      const movementRequested = Boolean(movementRequestError || requiresGeneratedMovement);
      const movementRequest = !direct && requiresGeneratedMovement && movementSupported
        ? {
            ...(parsed.movementRequest ?? { sessionId }),
            motionClass: 'body_local' as const,
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
            ? supportedParsedActions.filter(action => (
                !isPhysicalMotionAction(action)
                || (!hasRoutingDecision && delegatedActionRequirement === null)
                || (
                  !admissionBlocked
                  && routerRequestedMovement
                  && motionActionAllowed(action, motionClass, observation)
                )
              ))
            : [];
      const stopActions = parsed.actions.filter(action => action.type === 'stop');
      if (!currentActionAuthorized && stopActions.length > 0) actions.push(...stopActions);
      const movementError = direct ? '' : motionAdmissionMessage(admissionBlockedReason)
        || movementRequestError
        || (requiresGeneratedMovement && !connectedSession
          ? 'The requested robot movement cannot run because no robot session is connected.'
          : requiresGeneratedMovement && !movementSupported
            ? 'Off-script movement is unavailable because this robot does not advertise robotMotionPlan.'
            : '');
      const capabilityError = unavailableAction?.type === 'captureImage'
        ? 'The robot camera is not currently available.'
        : unavailableAction
          ? 'The physical robot is not currently available for that action.'
          : '';
      const response = movementError || direct?.response || capabilityError || parsed.response || '';
      const valid = actions.length > 0 || movementRequest !== null;
      const actionAdmission = routerRequestedMovement || admissionBlocked
        ? {
            kind: 'environment_action_admission',
            admitted: !admissionBlocked,
            motionClass,
            reason: admissionBlockedReason,
            requiredCapability: motionClass === 'target_relative' ? 'target_relative' : null,
          }
        : null;

      return {
        actions,
        firstAction: actions[0] ?? null,
        movementRequest,
        movementRequested,
        taskDecision: parsed.taskDecision,
        taskDecisionError: parsed.taskDecisionError,
        actionAdmission,
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
        taskDecision: null,
        taskDecisionError: '',
        actionAdmission: null,
        valid: false,
        error: (error as Error).message,
        response: '',
      };
    }
  },
});
