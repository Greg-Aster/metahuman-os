/**
 * Safety Node Executors
 * Handles chain-of-thought stripping, safety validation, and response refinement
 */

import { checkResponseSafety, refineResponseSafely } from '../cognitive-layers/index.js';
import type { NodeExecutor } from './types.js';

/**
 * Chain of Thought Stripper Node
 * Removes internal reasoning markers from LLM output
 */
export const chainOfThoughtStripperExecutor: NodeExecutor = async (inputs) => {
  console.log('[CoTStripper] Input[0]:', typeof inputs[0], inputs[0] ? Object.keys(inputs[0]) : null);

  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response && typeof inputs[0].response === 'string') {
    response = inputs[0].response;
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
  }

  console.log('[CoTStripper] Extracted:', response ? `"${response.substring(0, 80)}..."` : 'EMPTY');

  // Remove common CoT markers
  let cleaned = response
    // Remove <think>...</think> blocks (including multiline)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Remove stray closing </think> tags
    .replace(/<\/think>/gi, '')
    // Remove ReAct-style markers
    .replace(/^Thought:.*$/gm, '')
    .replace(/^Action:.*$/gm, '')
    .replace(/^Observation:.*$/gm, '')
    .replace(/^Final Answer:\s*/i, '')
    .trim();

  console.log('[CoTStripper] Cleaned:', `"${cleaned.substring(0, 80)}..."`);

  return {
    cleaned,
    response: cleaned,
  };
};

/**
 * Safety Validator Node
 * Checks response for safety/policy violations
 */
export const safetyValidatorExecutor: NodeExecutor = async (inputs, context) => {
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

/**
 * Response Refiner Node
 * Polishes and improves response quality
 */
export const responseRefinerExecutor: NodeExecutor = async (inputs, context) => {
  console.log('[ResponseRefiner] ========== RESPONSE REFINER ==========');
  console.log('[ResponseRefiner] Received', inputs.length, 'inputs');
  console.log('[ResponseRefiner] Input[0]:', typeof inputs[0], inputs[0] ? Object.keys(inputs[0]) : null);
  console.log('[ResponseRefiner] Input[1]:', typeof inputs[1], inputs[1] ? Object.keys(inputs[1]) : null);

  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
    console.log('[ResponseRefiner] Extracted from string input[0]');
  } else if (inputs[0]?.response && typeof inputs[0].response === 'string') {
    response = inputs[0].response;
    console.log('[ResponseRefiner] Extracted from input[0].response');
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
    console.log('[ResponseRefiner] Extracted from input[0].content');
  } else if (inputs[0]?.cleaned && typeof inputs[0].cleaned === 'string') {
    response = inputs[0].cleaned;
    console.log('[ResponseRefiner] Extracted from input[0].cleaned');
  }

  console.log('[ResponseRefiner] Extracted response:', response ? `"${response.substring(0, 100)}..."` : 'EMPTY');

  const safetyResult = inputs[1]?.safetyResult || inputs[1];

  if (!response || response.trim().length === 0) {
    console.log('[ResponseRefiner] ❌ Empty response, returning {}');
    return {};
  }

  if (!safetyResult || safetyResult.safe) {
    console.log('[ResponseRefiner] ✅ Safe response, returning:', `"${response.substring(0, 50)}..."`);
    return { response };
  }

  try {
    const refinement = await refineResponseSafely(response, safetyResult, {
      cognitiveMode: context.cognitiveMode,
      logToConsole: false,
      auditChanges: true,
    });

    const finalResponse = refinement.changed ? refinement.refined : response;

    console.log('[ResponseRefiner] ✅ Refined response, returning:', `"${finalResponse.substring(0, 50)}..."`);
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
