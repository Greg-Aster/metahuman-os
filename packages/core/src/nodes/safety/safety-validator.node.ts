/**
 * Safety Validator Node
 * Checks response for safety/policy violations
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { checkResponseSafety } from '../../cognitive-layers/index.js';

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

  if (!response || response.trim().length === 0) {
    return {};
  }

  try {
    const safetyResult = await checkResponseSafety(response, {
      cognitiveMode: context?.cognitiveMode || 'emulation',
      userId: context?.userId || 'anonymous',
      logToConsole: false,
      auditIssues: true,
    });

    return {
      response: safetyResult.response,
      isSafe: safetyResult.safe,
      issues: safetyResult.issues || [],
      safetyResult,
    };
  } catch (error) {
    console.error('[SafetyValidator] Error:', error);
    return {
      response,
      isSafe: true,
      issues: [],
    };
  }
};

export const SafetyValidatorNode: NodeDefinition = defineNode({
  id: 'safety_validator',
  name: 'Safety Validator',
  category: 'safety',
  inputs: [
    { name: 'response', type: 'any', description: 'Response to validate' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Validated response' },
    { name: 'isSafe', type: 'boolean' },
    { name: 'issues', type: 'array' },
    { name: 'safetyResult', type: 'object' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Checks response for safety/policy violations',
  execute,
});
