import { randomUUID } from 'node:crypto';
import { defineNode } from '../types.js';
import {
  enqueueEnvironmentAction,
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
  type EnvironmentActionType,
} from '../../environment-interface/index.js';
import {
  beginEnvironmentPerceptionCycle,
  nextRobotObserverCycle,
  parseRobotObserverCycle,
} from '../../robot-operator.js';

const ACTION_OPTIONS: EnvironmentActionType[] = ['move', 'look', 'jump', 'interact', 'stop', 'captureImage', 'robotCommand', 'robotMotionPlan', 'inspect', 'visualApproach', 'sendText'];
const BODY_ACTIONS = new Set<EnvironmentActionType>(ACTION_OPTIONS.filter(action => action !== 'sendText'));
type SendStatus = 'coordinated_for_adapter' | 'waiting_for_adapter' | 'bridge_disabled' | 'no_actions' | 'partial' | 'rejected';

function configuredGraph(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.trim())
    ? value.trim()
    : null;
}

function selectedActions(value: unknown): EnvironmentActionType[] {
  if (!Array.isArray(value)) {
    return ACTION_OPTIONS;
  }

  const selected = value.filter((item): item is EnvironmentActionType =>
    typeof item === 'string' && ACTION_OPTIONS.includes(item as EnvironmentActionType),
  );

  return selected.length > 0 ? selected : ACTION_OPTIONS;
}

export const environmentSendActionNode = defineNode({
  id: 'environment_send_action',
  name: 'Environment Bridge Out',
  category: 'environment',
  inputs: [
    { name: 'action', type: 'object', optional: true, description: 'Single action to enqueue' },
    { name: 'actions', type: 'array', optional: true, description: 'Actions to enqueue' },
    { name: 'generatedActions', type: 'array', optional: true, description: 'Validated actions from Movement Generator' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Target environment session' },
    { name: 'instruction', type: 'string', optional: true, description: 'Current resolved instruction' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction, when present' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Robot Operator cycle from Robot Operator Input or the matched sent-action record' },
  ],
  outputs: [
    { name: 'commands', type: 'array', description: 'Coordinator work created for the environment adapter' },
    { name: 'rejectedActions', type: 'array', description: 'Actions rejected by the node before queueing' },
    { name: 'count', type: 'number', description: 'Number of coordinator commands created' },
    { name: 'rejectedCount', type: 'number', description: 'Number of rejected actions' },
    { name: 'success', type: 'boolean', description: 'Whether every provided action was accepted and a receiver is ready' },
    { name: 'ready', type: 'boolean', description: 'Whether an adapter receiver is available for the target session' },
    { name: 'status', type: 'string', description: 'Bridge delivery status' },
    { name: 'reason', type: 'string', description: 'Machine-readable bridge status reason' },
    { name: 'message', type: 'string', description: 'Human-readable bridge status message' },
    { name: 'targetSessionId', type: 'string', description: 'Target environment session used for delivery checks' },
    { name: 'bridgeEnabled', type: 'boolean', description: 'Whether Environment Bridge is enabled' },
    { name: 'adapterReady', type: 'boolean', description: 'Whether the target adapter subscriber is connected' },
    { name: 'bodyAuthenticated', type: 'boolean', description: 'Whether the target adapter reports an authenticated physical body' },
    { name: 'streamSubscriberCount', type: 'number', description: 'Number of connected action stream subscribers for the target' },
    { name: 'activeSessionCount', type: 'number', description: 'Number of non-stale environment sessions' },
    { name: 'bridgeRecord', type: 'object', description: 'Structured outbound bridge result for downstream persistence' },
  ],
  properties: {
    allowedActions: ACTION_OPTIONS,
    maxDurationMs: 1500,
    defaultDurationMs: 0,
    feedbackGraph: '',
  },
  propertySchemas: {
    allowedActions: {
      type: 'multiselect',
      default: ACTION_OPTIONS,
      label: 'Allowed Actions',
      options: ACTION_OPTIONS,
    },
    maxDurationMs: {
      type: 'number',
      default: 1500,
      label: 'Max Duration',
      min: 1,
      max: 10000,
      step: 50,
    },
    defaultDurationMs: {
      type: 'number',
      default: 0,
      label: 'Default Duration',
      min: 0,
      max: 10000,
      step: 50,
      description: 'Optional fallback duration for move/look actions. Leave 0 to require explicit durationMs.',
    },
    feedbackGraph: {
      type: 'text',
      default: '',
      label: 'Feedback Workflow',
      description: 'Optional one-pass workflow that receives the correlated action result. Empty means record transport feedback without running another graph.',
      placeholder: 'For example: robot-action-result',
    },
  },
  description: 'Queues selected actions for Environment Bridge and returns transport facts only; it never authors or replaces conversation.',
  async execute(inputs, context, properties) {
    const requestedActions = [
      ...(Array.isArray(inputs.actions) ? inputs.actions : []),
      ...(Array.isArray(inputs.generatedActions) ? inputs.generatedActions : []),
      ...(inputs.action ? [inputs.action] : []),
    ];
    const existingCycle = parseRobotObserverCycle(inputs.robotObserver);
    const hasStop = requestedActions.some(action => action && typeof action === 'object' && action.type === 'stop');
    const rawActions = hasStop
      ? requestedActions.filter(action => action && typeof action === 'object' && action.type === 'stop')
      : requestedActions;
    const contextInstruction = typeof context.userMessage === 'string'
      ? context.userMessage.trim()
      : '';
    const currentUserInstruction = typeof inputs.userInstruction === 'string'
      ? inputs.userInstruction.trim()
      : contextInstruction;
    const currentInstruction = typeof inputs.instruction === 'string'
      ? inputs.instruction.trim()
      : contextInstruction;
    const feedbackGraph = configuredGraph(properties?.feedbackGraph);
    const shouldStartCycle = (
      !existingCycle
      && Boolean(feedbackGraph)
      && currentUserInstruction
      && rawActions.length > 0
    );
    const startedCycle = shouldStartCycle && feedbackGraph
      ? beginEnvironmentPerceptionCycle(
          `environment-task-${randomUUID()}`,
          feedbackGraph,
        )
      : null;
    const actionCycle = existingCycle ?? startedCycle;
    const continuedCycle = actionCycle ? nextRobotObserverCycle(actionCycle) : null;
    const nextObserverStep = continuedCycle && feedbackGraph
      ? {
          ...continuedCycle,
          graph: feedbackGraph,
        }
      : null;
    const sessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined;
    const commands = [];
    const rejectedActions = [];
    const options = {
      allowedActions: selectedActions(properties?.allowedActions),
      maxDurationMs: typeof properties?.maxDurationMs === 'number' ? properties.maxDurationMs : 1500,
      defaultDurationMs: typeof properties?.defaultDurationMs === 'number' ? properties.defaultDurationMs : 0,
    };
    const bridgeSummary = summarizeEnvironmentBridgeState();
    const targetSessionId = sessionId
      ?? (rawActions.find(action => action && typeof action === 'object' && typeof action.sessionId === 'string') as { sessionId?: string } | undefined)?.sessionId
      ?? bridgeSummary.sessions.find(session => session.status === 'connected')?.sessionId
      ?? '';
    const activeSessionCount = bridgeSummary.sessions.filter(session => session.status === 'connected').length;
    const targetSession = bridgeSummary.sessions.find(session => session.sessionId === targetSessionId && session.status === 'connected');
    const streamSubscriberCount = targetSessionId ? getEnvironmentActionSubscriberCount(targetSessionId) : 0;
    const adapterReady = Boolean(targetSession) && streamSubscriberCount > 0;
    const requiresPhysicalBody = targetSession?.adapter === 'ainekio-gateway';
    const bodyState = targetSession?.latestObservation?.state?.body;
    const bodyAuthenticated = Boolean(
      bodyState
      && typeof bodyState === 'object'
      && !Array.isArray(bodyState)
      && (bodyState as Record<string, unknown>).authenticated === true,
    );
    const bodyActions = rawActions.filter(action => (
      action && typeof action === 'object' && BODY_ACTIONS.has(action.type as EnvironmentActionType)
    ));
    const advertisedActions = targetSession?.latestObservation?.capabilities.actions ?? [];
    const unavailableAction = rawActions.find(action => (
      action && typeof action === 'object' && !advertisedActions.includes(action.type as EnvironmentActionType)
    ));
    const ready = adapterReady
      && (!requiresPhysicalBody || bodyActions.every(() => bodyAuthenticated))
      && !unavailableAction;
    let status: SendStatus = 'coordinated_for_adapter';
    let reason = '';
    let message = targetSessionId
      ? `Environment command queued for connected adapter session ${targetSessionId}.`
      : 'Environment command queued for a connected adapter.';

    if (rawActions.length === 0) {
      status = 'no_actions';
      reason = 'no_actions';
      message = 'No environment action was produced from this message, so nothing was sent to the robot bridge.';
    } else if (!bridgeSummary.enabled) {
      status = 'bridge_disabled';
      reason = 'environment_bridge_disabled';
      message = 'Environment Bridge is disabled. No robot adapter can receive this command.';
    } else if (!adapterReady) {
      status = 'waiting_for_adapter';
      reason = 'no_connected_environment_adapter';
      message = targetSessionId
        ? `No robot adapter is connected for session ${targetSessionId}. Start the Ainekio adapter and try again.`
        : 'No robot adapter is connected. Start the Ainekio adapter and try again.';
    } else if (requiresPhysicalBody && bodyActions.length > 0 && !bodyAuthenticated) {
      status = 'rejected';
      reason = 'robot_body_offline';
      message = 'The Ainekio adapter is connected, but the physical robot is offline. No body command was queued.';
    } else if (unavailableAction) {
      status = 'rejected';
      reason = 'capability_unavailable';
      message = unavailableAction.type === 'captureImage'
        ? 'The physical robot camera is not currently ready. No image request was queued.'
        : `The physical robot does not currently advertise ${String(unavailableAction.type)}.`;
    }

    if (status === 'coordinated_for_adapter') {
      for (const action of rawActions) {
        try {
          commands.push(enqueueEnvironmentAction(
            {
              ...action,
              sessionId: action.sessionId ?? targetSessionId,
              metadata: nextObserverStep
                ? { ...(action.metadata ?? {}), robotObserver: nextObserverStep }
                : action.metadata,
            },
            {
              ...options,
              username: context.username,
              correlationId: actionCycle?.cycleId ?? context.sessionId,
              source: actionCycle?.triggerSource ?? 'user',
              originatingInstruction: currentInstruction,
            },
          ));
        } catch (error) {
          rejectedActions.push({
            action,
            error: (error as Error).message,
          });
        }
      }

      if (rejectedActions.length > 0 && commands.length === 0) {
        status = 'rejected';
        reason = 'actions_rejected';
        message = `Environment command was rejected before queueing: ${rejectedActions.map(action => action.error).join('; ')}`;
      } else if (rejectedActions.length > 0) {
        status = 'partial';
        reason = 'some_actions_rejected';
        message = `Some environment actions were queued, but ${rejectedActions.length} action(s) were rejected: ${rejectedActions.map(action => action.error).join('; ')}`;
      }
    }

    if (status !== 'coordinated_for_adapter' && status !== 'no_actions') {
      console.warn('[EnvironmentBridgeOut]', {
        status,
        reason,
        message,
        targetSessionId: targetSessionId || null,
        bridgeEnabled: bridgeSummary.enabled,
        streamSubscriberCount,
        activeSessionCount,
        commandCount: commands.length,
        rejectedCount: rejectedActions.length,
      });
    } else if (status === 'coordinated_for_adapter') {
      console.log('[EnvironmentBridgeOut]', {
        status,
        targetSessionId: targetSessionId || null,
        streamSubscriberCount,
        activeSessionCount,
        commandCount: commands.length,
      });
    }

    const bridgeRecord = {
      direction: 'outbound',
      status,
      reason,
      message,
      targetSessionId: targetSessionId || null,
      requestedActions,
      commands,
      rejectedActions,
      commandCount: commands.length,
      rejectedCount: rejectedActions.length,
      success: status === 'coordinated_for_adapter',
      ready,
      bridgeEnabled: bridgeSummary.enabled,
      adapterReady,
      bodyAuthenticated,
      streamSubscriberCount,
      activeSessionCount,
      source: actionCycle?.triggerSource ?? 'user',
      correlationId: actionCycle?.cycleId ?? context.sessionId ?? null,
    };
    return {
      commands,
      rejectedActions,
      count: commands.length,
      rejectedCount: rejectedActions.length,
      success: status === 'coordinated_for_adapter',
      ready,
      status,
      reason,
      message,
      targetSessionId,
      bridgeEnabled: bridgeSummary.enabled,
      adapterReady,
      bodyAuthenticated,
      streamSubscriberCount,
      activeSessionCount,
      bridgeRecord,
    };
  },
});
