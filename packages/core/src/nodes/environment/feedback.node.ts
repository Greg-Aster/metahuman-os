import { defineNode } from '../types.js';
import type { EnvironmentFeedback } from '../../environment-interface/index.js';

const TERMINAL_TYPES = new Set<EnvironmentFeedback['type']>([
  'completed',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const environmentFeedbackNode = defineNode({
  id: 'environment_feedback',
  name: 'Environment Feedback Correlator',
  category: 'environment',
  inputs: [
    { name: 'feedback', type: 'array', description: 'Feedback events from Environment Bridge Input' },
    { name: 'actionId', type: 'string', description: 'Verified action ID from Environment Action Context Input' },
    { name: 'taskRestored', type: 'boolean', description: 'Whether the action has a restorable Environment task' },
  ],
  outputs: [
    { name: 'terminalFeedback', type: 'object', description: 'Latest terminal feedback matching the verified action ID' },
    { name: 'matched', type: 'boolean', description: 'Whether matching terminal feedback is present' },
  ],
  description: 'Matches bridge-supplied terminal feedback to one verified Work Coordinator action ID.',
  async execute(inputs) {
    const actionId = typeof inputs.actionId === 'string' ? inputs.actionId.trim() : '';
    const feedback = Array.isArray(inputs.feedback)
      ? inputs.feedback.filter(isRecord) as unknown as EnvironmentFeedback[]
      : [];
    const terminalFeedback = inputs.taskRestored === true && actionId
      ? [...feedback].reverse().find(candidate => (
          TERMINAL_TYPES.has(candidate.type)
          && candidate.actionId === actionId
        )) ?? null
      : null;
    return {
      terminalFeedback,
      matched: Boolean(terminalFeedback),
    };
  },
});
