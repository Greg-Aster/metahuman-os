import { defineNode } from '../types.js';
import { enqueueEnvironmentAction, type EnvironmentActionType } from '../../environment-interface/index.js';

const ACTION_OPTIONS: EnvironmentActionType[] = ['move', 'look', 'jump', 'interact', 'stop', 'sendText'];

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
  name: 'Environment Send Action',
  category: 'environment',
  inputs: [
    { name: 'action', type: 'object', optional: true, description: 'Single action to enqueue' },
    { name: 'actions', type: 'array', optional: true, description: 'Actions to enqueue' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Target environment session' },
  ],
  outputs: [
    { name: 'queuedActions', type: 'array', description: 'Actions queued for the environment adapter' },
    { name: 'rejectedActions', type: 'array', description: 'Actions rejected by the node before queueing' },
    { name: 'count', type: 'number', description: 'Number of queued actions' },
    { name: 'rejectedCount', type: 'number', description: 'Number of rejected actions' },
    { name: 'success', type: 'boolean', description: 'Whether every provided action was queued' },
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
  description: 'Queues one or more movement/control actions for the active environment adapter.',
  async execute(inputs, _context, properties) {
    const rawActions = [
      ...(Array.isArray(inputs.actions) ? inputs.actions : []),
      ...(inputs.action ? [inputs.action] : []),
    ];
    const sessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId : undefined;
    const queuedActions = [];
    const rejectedActions = [];
    const options = {
      allowedActions: selectedActions(properties?.allowedActions),
      maxDurationMs: typeof properties?.maxDurationMs === 'number' ? properties.maxDurationMs : 1500,
      defaultDurationMs: typeof properties?.defaultDurationMs === 'number' ? properties.defaultDurationMs : 0,
    };

    for (const action of rawActions) {
      try {
        queuedActions.push(enqueueEnvironmentAction({ ...action, sessionId: action.sessionId ?? sessionId }, options));
      } catch (error) {
        rejectedActions.push({
          action,
          error: (error as Error).message,
        });
      }
    }

    return {
      queuedActions,
      rejectedActions,
      count: queuedActions.length,
      rejectedCount: rejectedActions.length,
      success: rejectedActions.length === 0,
    };
  },
});
