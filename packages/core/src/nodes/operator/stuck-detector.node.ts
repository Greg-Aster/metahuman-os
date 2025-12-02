/**
 * Stuck Detector Node
 *
 * Detects failure loops and repeated unsuccessful actions
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const threshold = properties?.threshold || 3;
  const scratchpad = inputs[0]?.scratchpad || inputs[0] || [];

  try {
    // Analyze scratchpad for patterns
    let consecutiveFailures = 0;
    const recentActions: string[] = [];

    // Count consecutive failures from the end
    for (let i = scratchpad.length - 1; i >= 0; i--) {
      const step = scratchpad[i];
      const observation = step.observation || '';
      const action = step.action || '';

      if (observation.toLowerCase().includes('error') || observation.toLowerCase().includes('failed')) {
        consecutiveFailures++;
        if (action) recentActions.push(action);
      } else {
        break; // Stop at first success
      }
    }

    // Check for repeated actions (same action attempted multiple times)
    const actionCounts = recentActions.reduce((acc, action) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const maxRepeats = Math.max(...Object.values(actionCounts), 0);
    const isRepeating = maxRepeats >= 2;

    // Determine if stuck
    const isStuck = consecutiveFailures >= threshold;

    let diagnosis = '';
    let suggestion = '';

    if (isStuck) {
      if (isRepeating) {
        diagnosis = `Detected ${consecutiveFailures} consecutive failures with repeated action attempts`;
        suggestion = `Try a different approach - the current action is not working`;
      } else {
        diagnosis = `Detected ${consecutiveFailures} consecutive failures`;
        suggestion = `Review the error messages and adjust your strategy`;
      }
    }

    return {
      isStuck,
      consecutiveFailures,
      isRepeating,
      diagnosis,
      suggestion,
      threshold,
    };
  } catch (error) {
    console.error('[StuckDetector] Error:', error);
    return {
      isStuck: false,
      consecutiveFailures: 0,
      isRepeating: false,
      error: (error as Error).message,
    };
  }
};

export const StuckDetectorNode: NodeDefinition = defineNode({
  id: 'stuck_detector',
  name: 'Stuck Detector',
  category: 'operator',
  inputs: [
    { name: 'scratchpad', type: 'array' },
  ],
  outputs: [
    { name: 'isStuck', type: 'boolean' },
    { name: 'consecutiveFailures', type: 'number' },
    { name: 'diagnosis', type: 'string' },
    { name: 'suggestion', type: 'string' },
  ],
  properties: {
    threshold: 3,
  },
  propertySchemas: {
    threshold: {
      type: 'number',
      default: 3,
      label: 'Threshold',
      description: 'Number of consecutive failures to consider stuck',
    },
  },
  description: 'Detects failure loops and repeated unsuccessful actions',
  execute,
});
