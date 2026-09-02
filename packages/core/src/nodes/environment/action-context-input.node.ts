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
  name: 'Environment Action Context Input',
  category: 'environment',
  inputs: [
    { name: 'actionId', type: 'string', optional: true, description: 'Action identifier reported by Environment Bridge Input' },
  ],
  outputs: [
    { name: 'actionContext', type: 'object', description: 'Trusted Work Coordinator context for the reported action' },
    { name: 'actionId', type: 'string', description: 'Verified queued Environment action identifier' },
    { name: 'correlationId', type: 'string', description: 'Verified Work Coordinator correlation identifier' },
    { name: 'taskInstruction', type: 'string', description: 'Serialized lifecycle instruction stored with the queued action' },
    { name: 'robotObserver', type: 'object', description: 'Robot Operator cycle stored with the queued action' },
    { name: 'available', type: 'boolean', description: 'Whether matching Work Coordinator context is available' },
  ],
  description: 'Reads only trusted Work Coordinator context for the action ID supplied by Environment Bridge Input.',
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
      taskInstruction: cleanText(actionContext?.taskInstruction, 4_000),
      robotObserver: parseRobotObserverCycle(actionContext?.robotObserver),
      available: Boolean(actionContext),
    };
  },
});
