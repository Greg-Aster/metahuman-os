/**
 * Safety Validator Node
 * Checks response for safety/policy violations
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { checkResponseSafety } from '../../cognitive-layers/index.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
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
      threshold: properties?.threshold ?? 0.9,
    });

    return {
      response: safetyResult.response,
      isSafe: safetyResult.safe,
      issues: safetyResult.issues || [],
      safetyResult,
    };
  } catch (error) {
    console.error('[SafetyValidator] Error:', error);
    const message = (error as Error).message;
    const fallback = 'I apologize, but I cannot validate that response safely right now.';
    return {
      response: fallback,
      isSafe: false,
      issues: [{
        type: 'validator_error',
        severity: 'critical',
        description: `Safety validation failed: ${message}`,
      }],
      safetyResult: {
        safe: false,
        score: 0,
        severity: 'critical',
        sanitized: fallback,
        issues: [{
          type: 'validator_error',
          severity: 'critical',
          description: `Safety validation failed: ${message}`,
        }],
      },
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
  properties: {
    threshold: 0.9,
  },
  propertySchemas: {
    threshold: {
      type: 'slider',
      default: 0.9,
      label: 'Safety Threshold',
      description: 'Minimum safety score required to pass validation',
      min: 0.5,
      max: 1,
      step: 0.05,
    },
  },
  description: 'Checks response for safety/policy violations',
  execute,
});
