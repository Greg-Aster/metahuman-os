import { defineNode, NodeInputValidationError } from '../types.js';
import { visualObservationOutput } from './visual-observation-output.js';
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
  currentVisualEvidence: boolean | null,
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
    if (currentVisualEvidence === false) return false;
    const correlationId = robotObserver?.cycleId
      || (typeof observation.metadata?.correlationId === 'string'
        ? observation.metadata.correlationId.trim()
        : '');
    if (correlationId) {
      return observation.metadata?.correlationId === correlationId
        && frame.metadata?.correlationId === correlationId;
    }
    return currentVisualEvidence === true;
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
    { name: 'frames', type: 'array', optional: true, description: 'Exact images supplied by the context builder to this model call' },
    { name: 'response', type: 'any', description: 'Structured complete-task selection' },
    { name: 'observation', type: 'object', optional: true, description: 'Observation containing adapter-advertised robot commands' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Default target session' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Robot Operator cycle from its dedicated input node' },
    { name: 'currentVisualEvidence', type: 'boolean', optional: true, description: 'Whether Environment Image Input verified that the selected frame belongs to this graph run' },
  ],
  outputs: [
    { name: 'program', type: 'object', description: 'Complete task program for the canonical active executor' },
    { name: 'visualObservation', type: 'object', description: 'Optional image interpretation independent of the task decision' },
    { name: 'taskDecision', type: 'object', description: 'Validated task decision authored by the Environment LLM' },
    { name: 'actionAdmission', type: 'object', description: 'Typed capability-admission result for diagnostics' },
    { name: 'valid', type: 'boolean', description: 'Whether the complete program was admitted' },
    { name: 'hasResponse', type: 'boolean', description: 'Whether the Environment LLM chose to produce conversation text' },
    { name: 'error', type: 'string', description: 'Parser error message' },
    { name: 'response', type: 'string', description: 'Conversational response separated from the structured action list' },
  ],
  description: 'Separates a structured model response into conversational text and validated semantic actions.',
  async execute(inputs, context) {
    const sessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined;
    const observation = inputs.observation && typeof inputs.observation === 'object'
      ? inputs.observation as EnvironmentObservation
      : undefined;
    const robotObserver = parseRobotObserverCycle(inputs.robotObserver);
    const currentVisualEvidence = typeof inputs.currentVisualEvidence === 'boolean'
      ? inputs.currentVisualEvidence
      : null;
    const validation = validateEnvironmentSelectorOutput(
      inputs.response,
      sessionId,
    );
    if (!validation.value) throw new NodeInputValidationError('response',
      `Environment Action Selector output is invalid: ${validation.errors.join('; ')}`,
    );
    const continuation = context.activeTaskContinuation as import('../../environment-interface/active-task.js').ActiveTaskContinuation | undefined;
    const validated = !validation.value.program && continuation && !validation.value.taskDecision?.objectiveComplete
      ? { ...validation.value, program: continuation.program, taskDecision: validation.value.taskDecision ?? continuation.decision }
      : validation.value;
    const visualObservation = visualObservationOutput(validated.visualObservation, inputs.frames);
    const phases = validated.program?.steps ?? [];
    const generated = phases.find(step => step.kind === 'generatedMotion');
    const parsed = { ...validated,
      actions: phases.flatMap(step => step.kind === 'action' ? [step.action] : step.kind === 'behavior' ? [step.motion] : []),
      movementRequest: generated?.kind === 'generatedMotion' ? { description: generated.description, motionClass: 'body_local' as const } : null,
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
        && activeViewTargetIsCurrent(action, observation, robotObserver, currentVisualEvidence)
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
      && Boolean(parsed.movementRequest);
    const movementRequest = requiresGeneratedMovement && movementSupported
      ? {
          ...parsed.movementRequest!,
          motionClass: 'body_local' as const,
        }
      : null;
    const movementError = motionAdmissionMessage(admissionBlockedReason)
      || (requiresGeneratedMovement && !connectedSession
        ? 'The requested robot movement cannot run because no robot session is connected.'
        : requiresGeneratedMovement && !movementSupported
          ? 'Off-script movement is unavailable because this robot does not advertise robotMotionPlan.'
          : '');
    // A response coupled to a rejected action cannot be presented as a
    // truthful result. The transport error remains available through error
    // and actionAdmission; this node does not replace model speech with a
    // hard-coded conversational message.
    const response = admissionBlocked ? '' : parsed.response || '';
    const valid = !admissionBlocked && Boolean(parsed.program) && (!requiresGeneratedMovement || Boolean(movementRequest));
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
      program: valid ? parsed.program : null,
      taskDecision,
      visualObservation,
      actionAdmission,
      valid,
      hasResponse: Boolean(response.trim()),
      error: valid
        ? ''
        : movementError,
      response,
    };
  },
});
