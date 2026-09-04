import type { EnvironmentActionContext } from '../../environment-interface/index.js';
import { parseRobotObserverCycle } from '../../robot-operator.js';
import { defineNode } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

export const environmentActionContextInputNode = defineNode({
  id: 'environment_action_context_input',
  name: 'Verify Matched Sent Action',
  category: 'environment',
  inputs: [
    {
      name: 'actionId',
      label: 'Robot-reported action ID',
      type: 'string',
      optional: true,
      description: 'The action ID contained in the robot’s latest observation or feedback.',
    },
  ],
  outputs: [
    {
      name: 'actionContext',
      label: 'Matched sent-action record',
      type: 'object',
      description: 'Core’s pre-resolved record of the sent command: requested action, status, result, timestamps, timing, and autonomy details.',
    },
    {
      name: 'actionId',
      label: 'Verified sent action ID',
      type: 'string',
      description: 'The action ID only when the robot-reported ID matches a command MetaHuman sent.',
    },
    {
      name: 'correlationId',
      label: 'Action cycle ID',
      type: 'string',
      description: 'The ID used to tie the sent action to returned robot reports and camera frames.',
    },
    {
      name: 'robotObserver',
      label: 'Autonomy cycle',
      type: 'object',
      description: 'The Robot Operator cycle attached when an autonomy workflow sent the action.',
    },
    {
      name: 'available',
      label: 'Match found',
      type: 'boolean',
      description: 'True when the robot-reported ID matches the trusted sent-action record supplied by Core.',
    },
  ],
  presentation: {
    badges: [
      { label: 'Verifies Core match', tone: 'info' },
      { label: 'No model', tone: 'neutral' },
      { label: 'Sends nothing', tone: 'neutral' },
    ],
    statusTitle: 'Last action correlation',
    statusFields: [
      { output: 'available', label: 'Matched', format: 'availability' },
      { output: 'actionId', label: 'Sent action', hideWhenEmpty: true },
      { output: 'correlationId', label: 'Cycle', hideWhenEmpty: true },
    ],
  },
  description: 'Verifies that the action ID reported by the robot matches the trusted sent-action record Core resolved before graph execution. A match exposes the sent command and its result details. This node performs no lookup, sends no command, changes no status, and calls no model.',
  async execute(inputs, context) {
    const expectedActionId = cleanText(inputs.actionId, 200);
    const supplied = isRecord(context.environmentActionContext)
      ? context.environmentActionContext as unknown as EnvironmentActionContext
      : null;
    const actionId = cleanText(supplied?.actionId, 200);
    const matching = Boolean(expectedActionId && actionId === expectedActionId);
    const actionContext = matching ? supplied : null;
    return {
      actionContext,
      actionId: actionContext?.actionId ?? '',
      correlationId: cleanText(actionContext?.correlationId, 200),
      robotObserver: parseRobotObserverCycle(actionContext?.robotObserver),
      available: Boolean(actionContext),
    };
  },
});
