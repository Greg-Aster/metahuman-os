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
  inputs: [
    { name: 'actionRobotObserver', type: 'object', optional: true, description: 'Robot Operator cycle restored with the current Work Coordinator action' },
  ],
  outputs: [
    { name: 'robotObserver', type: 'object', description: 'Validated Robot Operator cycle metadata' },
    { name: 'plannerDecision', type: 'object', description: 'Planner-authored observation, instruction, and reason' },
    { name: 'plannerInstruction', type: 'string', description: 'Planner-authored instruction' },
    { name: 'memories', type: 'array', description: 'Planner-delegated historical memories' },
    { name: 'stimulusAgent', type: 'string', description: 'Robot Operator child that admitted this cycle' },
    { name: 'sourceObservationAt', type: 'string', description: 'Timestamp of the bridge observation used for this cycle' },
    { name: 'sessionId', type: 'string', description: 'Environment Bridge session selected for this Robot Operator cycle' },
    { name: 'currentVisualEvidence', type: 'boolean', description: 'Whether this cycle includes a newly acquired current frame' },
    { name: 'inputSource', type: 'string', description: 'Robot Operator trigger source: user or autonomy' },
    { name: 'responseMetadata', type: 'object', description: 'Conversation provenance for an optional Robot Operator response' },
    { name: 'available', type: 'boolean', description: 'Whether a valid Robot Operator cycle is present' },
  ],
  description: 'Reads only the Robot Operator handoff supplied with the current Work Coordinator execution.',
  async execute(inputs, context) {
    const supplied = isRecord(context.robotOperatorContext)
      ? context.robotOperatorContext
      : null;
    const robotObserver = parseRobotObserverCycle(
      supplied?.robotObserver ?? inputs.actionRobotObserver,
    );
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
      stimulusAgent: cleanText(supplied?.stimulusAgent, 100),
      sourceObservationAt: cleanText(supplied?.sourceObservationAt, 100),
      sessionId: cleanText(supplied?.sessionId, 200),
      currentVisualEvidence: supplied?.currentVisualEvidence === true,
      inputSource: robotObserver?.triggerSource ?? 'user',
      responseMetadata: robotObserver?.triggerSource === 'autonomy'
        ? {
            dialogueSource: robotObserver.requestedBy,
            correlationId: robotObserver.cycleId,
            tags: ['robot-operator', robotObserver.requestedBy, 'autonomy-trigger'],
          }
        : {},
      available: Boolean(robotObserver),
    };
  },
});
