/**
 * Switch Node
 *
 * Multi-way routing based on a value
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const SwitchNode: NodeDefinition = defineNode({
  id: 'switch',
  name: 'Switch',
  category: 'control_flow',
  inputs: [
    { name: 'input', type: 'any', description: 'Data to route' },
  ],
  outputs: [
    { name: 'output', type: 'any', description: 'Routed output' },
    { name: 'matchedCase', type: 'string', description: 'Which case matched' },
  ],
  properties: {
    switchField: 'mode',
    cases: {},
    defaultCase: 'default',
  },
  propertySchemas: {
    switchField: {
      type: 'string',
      default: 'mode',
      label: 'Switch Field',
      description: 'Field name to switch on',
    },
    cases: {
      type: 'json',
      default: {},
      label: 'Cases',
      description: 'Map of case values to output slots',
    },
    defaultCase: {
      type: 'string',
      default: 'default',
      label: 'Default Case',
      description: 'Case to use if no match',
    },
  },
  description: 'Multi-way routing based on a value',

  execute: async (inputs, _context, properties) => {
    const switchField = properties?.switchField || 'mode';
    const cases = properties?.cases || {};
    const defaultCase = properties?.defaultCase || 'default';

    const switchValue = inputs[0]?.[switchField] ?? inputs[0];
    const matchedCase = cases[switchValue] || defaultCase;

    return {
      switchValue,
      matchedCase,
      output: inputs[0],
      ...Object.keys(cases).reduce((acc, caseKey) => {
        acc[`output_${caseKey}`] = switchValue === caseKey ? inputs[0] : null;
        return acc;
      }, {} as Record<string, any>),
      output_default: matchedCase === defaultCase ? inputs[0] : null,
    };
  },
});
