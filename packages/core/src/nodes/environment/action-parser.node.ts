import { defineNode } from '../types.js';
import type {
  EnvironmentAction,
  EnvironmentObservation,
} from '../../environment-interface/index.js';
import { validEnvironmentJpegDataUrl } from '../../environment-interface/index.js';
import {
  parseRobotObserverCycle,
  type RobotObserverCycleMetadata,
} from '../../robot-operator.js';
import {
  normalizedEnvironmentMotionClass,
  validateEnvironmentSelectorOutput,
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

function unsupportedRobotCommand(
  actions: Array<{ type?: string; command?: string }>,
  advertised: string[] | undefined,
): string | null {
  const supported = new Set((advertised ?? []).map(command => command.trim()).filter(Boolean));
  const action = actions.find(candidate => (
    candidate.type === 'robotCommand'
    && typeof candidate.command === 'string'
    && !supported.has(candidate.command.trim())
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

function isPhysicalMotionAction(action: Partial<EnvironmentAction>): boolean {
  return PHYSICAL_MOTION_ACTIONS.has(action.type ?? '');
}

function visualFeedbackCapabilityAvailable(
  action: Partial<EnvironmentAction>,
  observation: EnvironmentObservation | undefined,
): boolean {
  if (!observation) return false;
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
  robotObserver: RobotObserverCycleMetadata | null,
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
    return !robotObserver || (
      observation.metadata?.correlationId === robotObserver.cycleId
      && frame.metadata?.correlationId === robotObserver.cycleId
    );
  });
}

function motionAdmissionMessage(reason: string): string {
  if (reason === 'target_relative_feedback_action_unavailable') {
    return 'The selected visual feedback action is not configured on the connected robot.';
  }
  if (reason === 'target_relative_frame_unavailable') {
    return 'The selected visual feedback action requires a target from the current camera frame.';
  }
  if (reason === 'robot_command_unavailable') {
    return 'The Environment LLM selected a robot command that this robot does not advertise.';
  }
  if (reason === 'action_capability_unavailable') {
    return 'The Environment LLM selected an action that the connected robot does not advertise.';
  }
  if (reason === 'camera_unavailable') {
    return 'The robot camera is not currently available.';
  }
  return '';
}

export const environmentActionParserNode = defineNode({
  id: 'environment_action_parser',
  name: 'Environment Action Parser',
  category: 'environment',
  inputs: [
    { name: 'response', type: 'any', description: 'LLM response text, object, or action array' },
    { name: 'observation', type: 'object', optional: true, description: 'Observation containing adapter-advertised robot commands' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Default target session' },
    { name: 'inputSource', type: 'string', optional: true, description: 'Instruction provenance supplied by the workflow input owner' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Robot Operator cycle from its dedicated input node' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Parsed environment actions' },
    { name: 'firstAction', type: 'object', description: 'First parsed action' },
    { name: 'movementRequest', type: 'object', description: 'Eligible off-script movement request for Movement Generator' },
    { name: 'movementRequested', type: 'boolean', description: 'Whether the model deliberately requested off-script movement generation' },
    { name: 'taskDecision', type: 'object', description: 'Validated task decision authored by the Environment LLM' },
    { name: 'taskDecisionError', type: 'string', description: 'Structured task-decision parsing error' },
    { name: 'actionAdmission', type: 'object', description: 'Typed capability-admission result for diagnostics' },
    { name: 'valid', type: 'boolean', description: 'Whether at least one action was parsed' },
    { name: 'hasActions', type: 'boolean', description: 'Whether an admitted preset action is ready for Environment Bridge Out' },
    { name: 'hasResponse', type: 'boolean', description: 'Whether the Environment LLM chose to produce conversation text' },
    { name: 'error', type: 'string', description: 'Parser error message' },
    { name: 'response', type: 'string', description: 'Conversational response separated from the structured action list' },
  ],
  description: 'Separates a structured model response into conversational text and validated semantic actions.',
  async execute(inputs, _context) {
    try {
      const sessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined;
      const observation = inputs.observation && typeof inputs.observation === 'object'
        ? inputs.observation as EnvironmentObservation
        : undefined;
      const autonomous = inputs.inputSource === 'autonomy';
      const robotObserver = parseRobotObserverCycle(inputs.robotObserver);
      const validation = validateEnvironmentSelectorOutput(
        inputs.response,
        sessionId,
        { requireObjective: autonomous },
      );
      const validated = validation.value;
      const parsed = validated
        ? {
            response: validated.response,
            actions: validated.actions,
            movementRequest: validated.movementRequest
              ? { ...validated.movementRequest, motionClass: 'body_local' as const }
              : null,
            movementRequestError: '',
            taskDecision: validated.taskDecision,
            taskDecisionError: '',
          }
        : {
            response: '',
            actions: [],
            movementRequest: null,
            movementRequestError: '',
            taskDecision: null,
            taskDecisionError: validation.errors.join('; '),
          };
      const motionClass = normalizedEnvironmentMotionClass(parsed.taskDecision?.motionClass)
        ?? (parsed.movementRequest ? 'body_local' : null);
      const connectedSession = Boolean(sessionId || observation?.sessionId);
      const unsupportedCommand = unsupportedRobotCommand(
        parsed.actions,
        observation?.capabilities?.robotCommands,
      );
      const movementSupported = observation?.capabilities?.actions?.includes('robotMotionPlan') === true;
      const unavailableAction = parsed.actions.find(action => !actionIsAdvertised(action, observation));
      const supportedParsedActions = parsed.actions.filter(action => (
        actionIsAdvertised(action, observation)
        && !unsupportedRobotCommand([action], observation?.capabilities?.robotCommands)
      ));
      const hasNonMotionAlternative = supportedParsedActions.some(action => !isPhysicalMotionAction(action));
      const targetFeedbackActionSelected = supportedParsedActions.some(action => (
        action.type === 'inspect' || action.type === 'visualApproach'
      ));
      const targetFeedbackActionAvailable = supportedParsedActions.some(action => (
        (action.type === 'inspect' || action.type === 'visualApproach')
          && visualFeedbackCapabilityAvailable(action, observation)
      ));
      const targetFrameAvailable = supportedParsedActions.some(action => (
        (action.type === 'inspect' || action.type === 'visualApproach')
          && activeViewTargetIsCurrent(action, observation, robotObserver)
      ));
      let admissionBlockedReason = '';
      if (targetFeedbackActionSelected && !hasNonMotionAlternative) {
        if (!targetFeedbackActionAvailable) {
          admissionBlockedReason = 'target_relative_feedback_action_unavailable';
        } else if (
          !targetFrameAvailable
        ) {
          admissionBlockedReason = 'target_relative_frame_unavailable';
        }
      }
      if (!admissionBlockedReason && unsupportedCommand) {
        admissionBlockedReason = 'robot_command_unavailable';
      } else if (!admissionBlockedReason && unavailableAction?.type === 'captureImage') {
        admissionBlockedReason = 'camera_unavailable';
      } else if (!admissionBlockedReason && unavailableAction) {
        admissionBlockedReason = 'action_capability_unavailable';
      }
      const admissionBlocked = Boolean(admissionBlockedReason);
      const requiresGeneratedMovement = !admissionBlocked
        && motionClass === 'body_local'
        && Boolean(parsed.movementRequest);
      const movementRequestError = parsed.movementRequestError;
      const movementRequested = Boolean(movementRequestError || requiresGeneratedMovement);
      const movementRequest = requiresGeneratedMovement && movementSupported
        ? {
            ...parsed.movementRequest!,
            motionClass: 'body_local' as const,
          }
        : null;
      const actions = movementRequest
        ? []
        : !admissionBlocked
          ? supportedParsedActions
          : [];
      const movementError = motionAdmissionMessage(admissionBlockedReason)
        || movementRequestError
        || (requiresGeneratedMovement && !connectedSession
          ? 'The requested robot movement cannot run because no robot session is connected.'
          : requiresGeneratedMovement && !movementSupported
            ? 'Off-script movement is unavailable because this robot does not advertise robotMotionPlan.'
            : '');
      const response = parsed.response || '';
      const valid = actions.length > 0 || movementRequest !== null;
      const actionAdmission = supportedParsedActions.some(isPhysicalMotionAction) || admissionBlocked
        ? {
            kind: 'environment_action_admission',
            admitted: !admissionBlocked,
            motionClass,
            reason: admissionBlockedReason,
            requiredCapability: null,
          }
        : null;
      const taskDecision = parsed.taskDecision;
      return {
        actions,
        firstAction: actions[0] ?? null,
        movementRequest,
        movementRequested,
        taskDecision,
        taskDecisionError: parsed.taskDecisionError,
        actionAdmission,
        valid,
        hasActions: actions.length > 0,
        hasResponse: Boolean(response.trim()),
        error: valid
          ? ''
          : parsed.taskDecisionError || movementError,
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
        hasActions: false,
        hasResponse: false,
        error: (error as Error).message,
        response: '',
      };
    }
  },
});
