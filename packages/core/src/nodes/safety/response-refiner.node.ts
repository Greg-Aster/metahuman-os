/**
 * Response Refiner Node
 * Polishes and improves response quality
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { refineResponseSafely } from '../../cognitive-layers/index.js';

const execute: NodeExecutor = async (inputs, context) => {
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

  try {
    const refinement = await refineResponseSafely(response, safetyResult, {
      cognitiveMode: context.cognitiveMode,
      logToConsole: false,
      auditChanges: true,
    });

    const finalResponse = refinement.changed ? refinement.refined : response;

    return {
      response: finalResponse,
      refined: refinement.changed,
      changes: refinement.changes || [],
    };
  } catch (error) {
    console.error('[ResponseRefiner] Error:', error);
    return {
      response,
      refined: false,
      error: (error as Error).message,
    };
  }
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
