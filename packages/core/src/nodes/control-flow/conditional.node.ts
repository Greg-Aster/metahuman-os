/**
 * Conditional Node
 *
 * Compatibility executor for older graph files that route through ifTrue/ifFalse
 * handles. Keep this intentionally small and deterministic; it is not a general
 * JavaScript expression evaluator.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

function readPath(value: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, value);
}

function unwrapValue(value: any): any {
  if (value && typeof value === 'object') {
    if ('desire' in value && 'found' in value) return value.desire;
    if ('value' in value && Object.keys(value).length === 1) return value.value;
  }

  return value;
}

function evaluateCondition(value: any, condition: string | undefined): boolean {
  const normalized = condition?.trim() || 'value === true';
  const unwrapped = unwrapValue(value);

  if (normalized === 'value === true') {
    return value === true || unwrapped === true || value?.detected === true;
  }

  if (normalized === 'value !== true') {
    return !(value === true || unwrapped === true || value?.detected === true);
  }

  if (normalized === 'desire?.outcomeReview?.verdict === \'retry\'' ||
      normalized === 'desire?.outcomeReview?.verdict === "retry"') {
    return readPath(unwrapped, 'outcomeReview.verdict') === 'retry';
  }

  return Boolean(unwrapped ?? value);
}

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const value = inputs.value ?? inputs[0];
  const conditionMet = evaluateCondition(value, properties?.condition as string | undefined);

  return {
    ifTrue: conditionMet ? value : null,
    ifFalse: conditionMet ? null : value,
    conditionMet,
    branch: conditionMet ? 'true' : 'false',
    value,
  };
};

export const ConditionalNode: NodeDefinition = defineNode({
  id: 'conditional',
  name: 'Conditional',
  category: 'control_flow',
  inputs: [
    { name: 'value', type: 'any', description: 'Value to evaluate' },
  ],
  outputs: [
    { name: 'ifTrue', type: 'any', description: 'Output when condition is true' },
    { name: 'ifFalse', type: 'any', description: 'Output when condition is false' },
    { name: 'conditionMet', type: 'boolean', description: 'Whether condition was true' },
    { name: 'branch', type: 'string', description: 'Selected branch' },
    { name: 'value', type: 'any', description: 'Original input value' },
  ],
  properties: { condition: 'value === true' },
  propertySchemas: {
    condition: {
      type: 'string',
      default: 'value === true',
      label: 'Condition',
      description: 'Supported condition string from maintained graph files',
    },
  },
  description: 'Routes data through ifTrue or ifFalse based on a simple condition',
  execute,
});
