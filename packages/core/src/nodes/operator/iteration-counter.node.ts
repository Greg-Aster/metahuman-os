/**
 * Iteration Counter Node
 *
 * Tracks and validates iteration count in ReAct loop
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, context) => {
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] ========== ITERATION COUNTER ==========`);

  // Merge inputs: slot 1 (loop-back) takes priority over slot 0 (initial)
  let scratchpadData = inputs[1] || inputs[0] || {};

  // Unwrap routedData if present (from conditional_router loop-back)
  if (scratchpadData.routedData) {
    console.log(`[IterationCounter] Unwrapping routedData from conditional_router`);
    scratchpadData = scratchpadData.routedData;
  }

  const iteration = scratchpadData.iteration || 0;
  const maxIterations = scratchpadData.maxIterations || context.maxIterations || 10;
  const scratchpad = scratchpadData.scratchpad || [];

  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Iteration: ${iteration}/${maxIterations}, scratchpadLength: ${scratchpad.length}`);

  const hasExceededMax = iteration >= maxIterations;
  const shouldContinue = !hasExceededMax;

  const result = {
    iteration,
    maxIterations,
    hasExceededMax,
    shouldContinue,
    scratchpad,
    scratchpadLength: scratchpad.length,
  };

  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Returning:`, {
    iteration: result.iteration,
    maxIterations: result.maxIterations,
    hasExceededMax: result.hasExceededMax,
    shouldContinue: result.shouldContinue,
  });

  return result;
};

export const IterationCounterNode: NodeDefinition = defineNode({
  id: 'iteration_counter',
  name: 'Iteration Counter',
  category: 'operator',
  inputs: [
    { name: 'scratchpad', type: 'object', description: 'Initial scratchpad from initializer' },
    { name: 'loopBack', type: 'object', optional: true, description: 'Loop-back data from conditional router' },
  ],
  outputs: [
    { name: 'iterationData', type: 'object', description: 'Object with iteration, maxIterations, scratchpad' },
  ],
  properties: {
    maxIterations: 10,
  },
  propertySchemas: {
    maxIterations: {
      type: 'number',
      default: 10,
      label: 'Max Iterations',
      description: 'Maximum number of ReAct iterations',
    },
  },
  description: 'Tracks iteration count in ReAct loop',
  execute,
});
