/**
 * Response Refiner Node
 * Polishes and improves response quality
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs) => {
  // Extract response string from various input formats
  // Use named inputs with positional fallback
  const inputData = inputs.response ?? inputs[0];

  let response = '';
  if (typeof inputData === 'string') {
    response = inputData;
  } else if (inputData?.response && typeof inputData.response === 'string') {
    response = inputData.response;
  } else if (inputData?.content && typeof inputData.content === 'string') {
    response = inputData.content;
  } else if (inputData?.cleaned && typeof inputData.cleaned === 'string') {
    response = inputData.cleaned;
  }

  const safetyResult = inputs.safetyResult ?? inputs[1];

  if (!response || response.trim().length === 0) {
    return {};
  }

  if (!safetyResult || safetyResult.safe) {
    return { response };
  }

  const refinedResponse = typeof safetyResult.sanitized === 'string'
    ? safetyResult.sanitized
    : response;

  return {
    response: refinedResponse,
    refined: refinedResponse !== response,
    changes: refinedResponse !== response ? safetyResult.issues : [],
  };
};

export const ResponseRefinerNode: NodeDefinition = defineNode({
  id: 'response_refiner',
  name: 'Response Refiner',
  category: 'safety',
  inputs: [
    { name: 'response', type: 'any', description: 'Response to refine' },
    { name: 'safetyResult', type: 'object', optional: true, description: 'Safety validation result' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Refined response' },
    { name: 'refined', type: 'boolean' },
    { name: 'changes', type: 'array' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Polishes and improves response quality',
  execute,
});
