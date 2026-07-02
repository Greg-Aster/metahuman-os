/**
 * Result Aggregator Node
 *
 * Compatibility pass-through for graph files that terminate in result_aggregator.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs) => {
  const result = inputs.input ?? inputs.result ?? inputs[0] ?? inputs;

  return {
    result,
    output: result,
    response: typeof result === 'string' ? result : result?.response,
  };
};

export const ResultAggregatorNode: NodeDefinition = defineNode({
  id: 'result_aggregator',
  name: 'Result Aggregator',
  category: 'output',
  inputs: [
    { name: 'input', type: 'any', description: 'Input to aggregate' },
  ],
  outputs: [
    { name: 'result', type: 'any', description: 'Aggregated result' },
    { name: 'output', type: 'any', description: 'Alias for result' },
    { name: 'response', type: 'string', optional: true, description: 'String response if available' },
  ],
  properties: {},
  description: 'Passes terminal graph results through a stable output handle',
  execute,
});
