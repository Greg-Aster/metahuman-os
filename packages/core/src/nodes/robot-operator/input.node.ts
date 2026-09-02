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

export const robotOperatorInputNode = defineNode({
  id: 'robot_operator_input',
  name: 'Robot Operator Input',
  category: 'operator',
  inputs: [],
  outputs: [
    { name: 'robotObserver', type: 'object', description: 'Validated Robot Operator cycle metadata' },
    { name: 'plannerDecision', type: 'object', description: 'Planner-authored observation, instruction, and reason' },
    { name: 'plannerInstruction', type: 'string', description: 'Planner-authored instruction' },
    { name: 'memories', type: 'array', description: 'Planner-delegated historical memories' },
    { name: 'inputSource', type: 'string', description: 'Robot Operator trigger source: user or autonomy' },
    { name: 'available', type: 'boolean', description: 'Whether a valid Robot Operator cycle is present' },
  ],
  description: 'Reads only the Robot Operator handoff supplied with the current Work Coordinator execution.',
  async execute(_inputs, context) {
    const supplied = isRecord(context.robotOperatorContext)
      ? context.robotOperatorContext
      : null;
    const robotObserver = parseRobotObserverCycle(supplied?.robotObserver);
    const rawDecision = isRecord(supplied?.plannerDecision)
      ? supplied.plannerDecision
      : null;
    const observed = cleanText(rawDecision?.observed, 500);
    const instruction = cleanText(rawDecision?.instruction, 1_000);
    const reason = cleanText(rawDecision?.reason, 500);
    const decidedAt = cleanText(rawDecision?.decidedAt, 100);
    const plannerDecision = observed && instruction && reason
      ? {
          observed,
          instruction,
          reason,
          ...(decidedAt ? { decidedAt } : {}),
        }
      : null;
    const memories = Array.isArray(supplied?.memories)
      ? supplied.memories
          .filter((value): value is string => typeof value === 'string')
          .map(value => cleanText(value, 800))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return {
      robotObserver,
      plannerDecision,
      plannerInstruction: plannerDecision?.instruction ?? '',
      memories,
      inputSource: robotObserver?.triggerSource ?? 'user',
      available: Boolean(robotObserver),
    };
  },
});
