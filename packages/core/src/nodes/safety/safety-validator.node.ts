/**
 * Safety Validator Node
 * Checks response for safety/policy violations
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { checkResponseSafety } from '../../cognitive-layers/index.js';

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
