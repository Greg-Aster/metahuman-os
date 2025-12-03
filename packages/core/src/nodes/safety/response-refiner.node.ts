/**
 * Response Refiner Node
 * Polishes and improves response quality
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { refineResponseSafely } from '../../cognitive-layers/index.js';

const execute: NodeExecutor = async (inputs, context) => {
  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response && typeof inputs[0].response === 'string') {
    response = inputs[0].response;
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
  } else if (inputs[0]?.cleaned && typeof inputs[0].cleaned === 'string') {
    response = inputs[0].cleaned;
  }

  const safetyResult = inputs[1]?.safetyResult || inputs[1];

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
