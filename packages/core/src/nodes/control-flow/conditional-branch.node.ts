/**
 * Conditional Branch Node
 *
 * Routes execution based on a condition (if/else logic)
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const ConditionalBranchNode: NodeDefinition = defineNode({
  id: 'conditional_branch',
  name: 'Conditional Branch',
  category: 'control_flow',
  inputs: [
    { name: 'input', type: 'any', description: 'Data to evaluate and route' },
  ],
  outputs: [
    { name: 'trueOutput', type: 'any', description: 'Output if condition is true' },
    { name: 'falseOutput', type: 'any', description: 'Output if condition is false' },
    { name: 'conditionMet', type: 'boolean', description: 'Whether condition was met' },
  ],
  properties: {
    condition: 'value',
    operator: '==',
    compareValue: '',
  },
  propertySchemas: {
    condition: {
      type: 'string',
      default: 'value',
      label: 'Field to Check',
      description: 'Field name to evaluate',
    },
    operator: {
      type: 'select',
      default: '==',
      label: 'Operator',
      options: ['==', '!=', '>', '<', 'exists', 'not_exists', 'truthy', 'falsy'],
    },
    compareValue: {
      type: 'string',
      default: '',
      label: 'Compare Value',
      description: 'Value to compare against',
    },
  },
  description: 'Routes execution based on a condition (if/else logic)',

  execute: async (inputs, _context, properties) => {
    const condition = properties?.condition || 'value';
    const operator = properties?.operator || '==';
    const compareValue = properties?.compareValue;

    const inputValue = inputs[0]?.[condition] ?? inputs[0];
    let conditionMet = false;

    switch (operator) {
      case '==':
      case 'equals':
        conditionMet = inputValue === compareValue;
        break;
      case '!=':
      case 'not_equals':
        conditionMet = inputValue !== compareValue;
        break;
      case '>':
      case 'greater_than':
        conditionMet = Number(inputValue) > Number(compareValue);
        break;
      case '<':
      case 'less_than':
        conditionMet = Number(inputValue) < Number(compareValue);
        break;
      case 'exists':
        conditionMet = inputValue !== null && inputValue !== undefined;
        break;
      case 'not_exists':
        conditionMet = inputValue === null || inputValue === undefined;
        break;
      case 'truthy':
        conditionMet = Boolean(inputValue);
        break;
      case 'falsy':
        conditionMet = !Boolean(inputValue);
        break;
      default:
        conditionMet = Boolean(inputValue);
    }

    return {
      conditionMet,
      value: inputValue,
      trueOutput: conditionMet ? inputs[0] : null,
      falseOutput: !conditionMet ? inputs[0] : null,
    };
  },
});
