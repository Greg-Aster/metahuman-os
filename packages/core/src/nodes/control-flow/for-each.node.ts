/**
 * For Each Node
 *
 * Iterates over an array, executing logic for each element
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const ForEachNode: NodeDefinition = defineNode({
  id: 'for_each',
  name: 'For Each',
  category: 'control_flow',
  inputs: [
    { name: 'input', type: 'any', description: 'Object containing array to iterate' },
  ],
  outputs: [
    { name: 'results', type: 'array', description: 'Results from each iteration' },
    { name: 'count', type: 'number', description: 'Number of items processed' },
  ],
  properties: {
    arrayField: 'items',
  },
  propertySchemas: {
    arrayField: {
      type: 'string',
      default: 'items',
      label: 'Array Field',
      description: 'Field name containing the array',
    },
  },
  description: 'Iterates over an array, executing logic for each element',

  execute: async (inputs, _context, properties) => {
    const arrayField = properties?.arrayField || 'items';
    const inputArray = inputs[0]?.[arrayField] || [];
    const results: any[] = [];

    for (let i = 0; i < inputArray.length; i++) {
      results.push({
        index: i,
        item: inputArray[i],
      });
    }

    return {
      results,
      count: results.length,
      items: inputArray,
    };
  },
});
