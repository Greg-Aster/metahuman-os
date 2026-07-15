import { defineNode } from '../types.js';
import {
  enqueueEnvironmentAction,
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
  type EnvironmentActionType,
} from '../../environment-interface/index.js';

const ACTION_OPTIONS: EnvironmentActionType[] = ['move', 'look', 'jump', 'interact', 'stop', 'robotCommand', 'sendText'];
type SendStatus = 'coordinated_for_adapter' | 'waiting_for_adapter' | 'bridge_disabled' | 'no_actions' | 'partial' | 'rejected';

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
    { name: 'sessionId', type: 'string', optional: true, description: 'Target environment session' },
    { name: 'response', type: 'string', optional: true, description: 'Conversational response to pass to chat output' },
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
    { name: 'response', type: 'string', description: 'Visible chat warning when the bridge cannot receive the command' },
    { name: 'targetSessionId', type: 'string', description: 'Target environment session used for delivery checks' },
    { name: 'bridgeEnabled', type: 'boolean', description: 'Whether Environment Bridge is enabled' },
    { name: 'streamSubscriberCount', type: 'number', description: 'Number of connected action stream subscribers for the target' },
    { name: 'activeSessionCount', type: 'number', description: 'Number of non-stale environment sessions' },
  ],
  properties: {
    allowedActions: ACTION_OPTIONS,
    maxDurationMs: 1500,
    defaultDurationMs: 0,
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
  },
  description: 'Queues one or more movement/control actions and reports whether an environment adapter can receive them.',
  async execute(inputs, context, properties) {
    const requestedActions = [
      ...(Array.isArray(inputs.actions) ? inputs.actions : []),
      ...(inputs.action ? [inputs.action] : []),
    ];
    const hasStop = requestedActions.some(action => action && typeof action === 'object' && action.type === 'stop');
    const rawActions = hasStop
      ? requestedActions.filter(action => action && typeof action === 'object' && action.type === 'stop')
      : requestedActions;
    const sessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined;
    const conversationalResponse = typeof inputs.response === 'string' ? inputs.response.trim() : '';
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
    const ready = Boolean(targetSession) && streamSubscriberCount > 0;
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
      message = 'I understood the environment command, but Environment Bridge is disabled. No robot adapter can receive it yet.';
    } else if (!ready) {
      status = 'waiting_for_adapter';
      reason = 'no_connected_environment_adapter';
      message = targetSessionId
        ? `I understood the environment command, but no robot adapter is connected for session ${targetSessionId}. Start the Ainekio adapter and try again.`
        : 'I understood the environment command, but no robot adapter is connected. Start the Ainekio adapter and try again.';
    }

    if (status === 'coordinated_for_adapter') {
      for (const action of rawActions) {
        try {
          commands.push(enqueueEnvironmentAction(
            { ...action, sessionId: action.sessionId ?? targetSessionId },
            {
              ...options,
              username: context.username,
              correlationId: context.sessionId,
              source: 'user',
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

    if (status !== 'coordinated_for_adapter') {
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
    } else {
      console.log('[EnvironmentBridgeOut]', {
        status,
        targetSessionId: targetSessionId || null,
        streamSubscriberCount,
        activeSessionCount,
        commandCount: commands.length,
      });
    }

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
      response: ['bridge_disabled', 'waiting_for_adapter', 'partial', 'rejected'].includes(status)
        ? message
        : conversationalResponse,
      targetSessionId,
      bridgeEnabled: bridgeSummary.enabled,
      streamSubscriberCount,
      activeSessionCount,
    };
  },
});
