/**
 * Data Transform Node
 *
 * Map/filter/reduce operations on arrays
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const data = inputs[0] || [];
  const operation = properties?.operation || 'map';
  const field = properties?.field;
  const condition = properties?.condition;
  const initialValue = properties?.initialValue;

  try {
    if (!Array.isArray(data)) {
      throw new Error('Input must be an array');
    }

    let result: any;

    switch (operation) {
      case 'map':
        result = field
          ? data.map((item: any) => item[field])
          : data;
        break;

      case 'filter':
        if (condition) {
          result = data.filter((item: any) => {
            const [key, value] = Object.entries(condition)[0] || [];
            return item[key] === value;
          });
        } else {
          result = data.filter((item: any) => item != null && item !== '');
        }
        break;

      case 'reduce':
        const reduceOp = properties?.reduceOperation || 'count';
        if (reduceOp === 'count') {
          result = data.length;
        } else if (reduceOp === 'sum' && field) {
          result = data.reduce((sum: number, item: any) => sum + (Number(item[field]) || 0), 0);
        } else if (reduceOp === 'concat' && field) {
          result = data.map((item: any) => item[field]).join(', ');
        } else {
          result = initialValue || 0;
        }
        break;

      case 'unique':
        result = [...new Set(data)];
        break;

      case 'sort':
        result = field
          ? [...data].sort((a: any, b: any) => {
              const aVal = a[field];
              const bVal = b[field];
              if (aVal < bVal) return -1;
              if (aVal > bVal) return 1;
              return 0;
            })
          : [...data].sort();
        break;

      default:
        result = data;
    }

    return {
      result,
      operation,
      count: Array.isArray(result) ? result.length : 1,
    };
  } catch (error) {
    console.error('[DataTransform] Error:', error);
    return {
      result: data,
      error: (error as Error).message,
    };
  }
};

export const DataTransformNode: NodeDefinition = defineNode({
  id: 'data_transform',
  name: 'Data Transform',
  category: 'utility',
  inputs: [
    { name: 'data', type: 'array', description: 'Array to transform' },
  ],
  outputs: [
    { name: 'result', type: 'any', description: 'Transformed data' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    operation: 'map',
    field: '',
  },
  propertySchemas: {
    operation: {
      type: 'select',
      default: 'map',
      label: 'Operation',
      options: ['map', 'filter', 'reduce', 'unique', 'sort'],
    },
    field: {
      type: 'string',
      default: '',
      label: 'Field',
      description: 'Field to extract/sort by',
    },
  },
  description: 'Map/filter/reduce operations on arrays',
  execute,
});
