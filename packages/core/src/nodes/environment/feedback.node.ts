import { defineNode } from '../types.js';
import { getEnvironmentFeedback } from '../../environment-interface/index.js';

export const environmentFeedbackNode = defineNode({
  id: 'environment_feedback',
  name: 'Environment Feedback',
  category: 'environment',
  inputs: [
    { name: 'actionId', type: 'string', optional: true, description: 'Optional action ID to filter feedback' },
  ],
  outputs: [
    { name: 'feedback', type: 'array', description: 'Recent environment feedback events' },
    { name: 'latestFeedback', type: 'object', description: 'Most recent feedback event' },
    { name: 'count', type: 'number', description: 'Number of feedback events returned' },
    { name: 'hasFeedback', type: 'boolean', description: 'Whether feedback is available' },
  ],
  properties: {
    limit: 20,
  },
  propertySchemas: {
    limit: {
      type: 'number',
      default: 20,
      label: 'Feedback Limit',
      min: 1,
      max: 200,
      step: 1,
    },
  },
  description: 'Reads recent environment feedback from adapter action results.',
  async execute(inputs, _context, properties) {
    const feedback = getEnvironmentFeedback({
      actionId: typeof inputs.actionId === 'string' && inputs.actionId.trim() ? inputs.actionId.trim() : undefined,
      limit: typeof properties?.limit === 'number' ? properties.limit : 20,
    });

    return {
      feedback,
      latestFeedback: feedback[feedback.length - 1] ?? null,
      count: feedback.length,
      hasFeedback: feedback.length > 0,
    };
  },
});
