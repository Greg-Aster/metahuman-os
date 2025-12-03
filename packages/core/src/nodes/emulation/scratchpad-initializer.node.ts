/**
 * Scratchpad Initializer Node
 * Creates or resets the scratchpad for ReAct iteration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, context) => {
  return {
    scratchpad: [],
    iteration: 0,
    maxIterations: context.maxIterations || 10,
    isComplete: false,
  };
};

export const ScratchpadInitializerNode: NodeDefinition = defineNode({
  id: 'scratchpad_initializer',
  name: 'Scratchpad Initializer',
  category: 'emulation',
  inputs: [],
  outputs: [
    { name: 'scratchpad', type: 'array' },
    { name: 'iteration', type: 'number' },
    { name: 'maxIterations', type: 'number' },
    { name: 'isComplete', type: 'boolean' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Creates or resets the scratchpad for ReAct iteration',
  execute,
});
