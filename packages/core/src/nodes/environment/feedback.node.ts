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
  name: 'Find Finished Robot Report for Sent Action',
  category: 'environment',
  inputs: [
    {
      name: 'feedback',
      label: 'Robot feedback reports',
      type: 'array',
      description: 'Completion, failure, rejection, cancellation, or expiration reports received from the robot bridge.',
    },
    {
      name: 'actionId',
      label: 'Sent action ID',
      type: 'string',
      description: 'The verified ID of the action MetaHuman sent.',
    },
  ],
  outputs: [
    {
      name: 'terminalFeedback',
      label: 'Matching finished result',
      type: 'object',
      description: 'The newest finished robot report with the same action ID, or no result when none matches.',
    },
    {
      name: 'matched',
      label: 'Result found',
      type: 'boolean',
      description: 'True when a finished robot report matches the sent action ID.',
    },
  ],
  presentation: {
    badges: [
      { label: 'Reads robot reports', tone: 'info' },
      { label: 'No model', tone: 'neutral' },
      { label: 'Sends nothing', tone: 'neutral' },
    ],
    statusTitle: 'Last result search',
    statusFields: [
      { output: 'matched', label: 'Found', format: 'availability' },
    ],
  },
  description: 'Looks through the robot’s returned reports and finds the newest finished result whose action ID matches the action MetaHuman sent. It sends no command, changes no status, and calls no model.',
  async execute(inputs) {
    const actionId = typeof inputs.actionId === 'string' ? inputs.actionId.trim() : '';
    const feedback = Array.isArray(inputs.feedback)
      ? inputs.feedback.filter(isRecord) as unknown as EnvironmentFeedback[]
      : [];
    const terminalFeedback = actionId
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
