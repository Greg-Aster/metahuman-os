/**
 * Completion Checker Node
 *
 * Checks if the task is complete based on the plan
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs) => {
  if (!inputs || Object.keys(inputs).length === 0) {
    return {};
  }

  const plan = inputs[0] || '';

  const isComplete = plan.toLowerCase().includes('final answer');

  return {
    complete: isComplete,
    plan,
  };
};

export const CompletionCheckerNode: NodeDefinition = defineNode({
  id: 'completion_checker',
  name: 'Completion Checker',
  category: 'operator',
  inputs: [
    { name: 'goal', type: 'string' },
    { name: 'scratchpad', type: 'array' },
  ],
  outputs: [
    { name: 'isComplete', type: 'boolean' },
    { name: 'reason', type: 'string', optional: true },
  ],
  description: 'Checks if goal is achieved',
  execute,
});
