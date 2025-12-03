/**
 * Scratchpad Updater Node
 * Appends new thought/action/observation to scratchpad
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context) => {
  const currentScratchpad = inputs[0]?.scratchpad || [];
  const iteration = inputs[0]?.iteration || 0;

  // Extract thought and action from react planner output (inputs[2])
  const planOutput = inputs[2];
  const planText = typeof planOutput === 'object' ? planOutput.plan : planOutput;

  // Parse the plan text to extract thought and action
  let thought = planText || '';
  let action = '';

  const thoughtMatch = planText?.match(/Thought:\s*(.+?)(?=\nAction:|$)/is);
  const actionMatch = planText?.match(/Action:\s*(.+?)(?=\nAction Input:|$)/is);

  if (thoughtMatch) thought = thoughtMatch[1].trim();
  if (actionMatch) action = actionMatch[1].trim();

  // Extract observation from skill executor output (inputs[1])
  const observationOutput = inputs[1];
  let observation = '';

  if (typeof observationOutput === 'string') {
    observation = observationOutput;
  } else if (observationOutput && typeof observationOutput === 'object') {
    observation = observationOutput.observation || JSON.stringify(observationOutput);
  }

  const newEntry = {
    iteration: iteration + 1,
    thought,
    action,
    observation,
    timestamp: new Date().toISOString(),
  };

  const updatedScratchpad = [...currentScratchpad, newEntry];

  return {
    scratchpad: updatedScratchpad,
    iteration: iteration + 1,
    maxIterations: inputs[0]?.maxIterations || 10,
    isComplete: false,
  };
};

export const ScratchpadUpdaterNode: NodeDefinition = defineNode({
  id: 'scratchpad_updater',
  name: 'Scratchpad Updater',
  category: 'emulation',
  inputs: [
    { name: 'iterationState', type: 'object', description: 'Current iteration state' },
    { name: 'observation', type: 'any', description: 'Observation from skill executor' },
    { name: 'plan', type: 'any', description: 'Plan from react planner' },
  ],
  outputs: [
    { name: 'scratchpad', type: 'array' },
    { name: 'iteration', type: 'number' },
    { name: 'maxIterations', type: 'number' },
    { name: 'isComplete', type: 'boolean' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Appends new thought/action/observation to scratchpad',
  execute,
});
