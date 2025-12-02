/**
 * Scratchpad Completion Checker Node
 *
 * Determines if ReAct task is complete based on response content and iteration count
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs) => {
  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Received inputs:`, {
    inputCount: inputs.length,
    input0Type: typeof inputs[0],
    input0Keys: inputs[0] ? Object.keys(inputs[0]) : [],
  });

  // Extract scratchpad data (comes from scratchpad_updater)
  const scratchpadData = inputs[0] || {};
  const scratchpad = scratchpadData.scratchpad || [];
  const iteration = scratchpadData.iteration || 0;
  const maxIterations = scratchpadData.maxIterations || 10;

  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Extracted: iteration=${iteration}/${maxIterations}, scratchpadLength=${scratchpad.length}`);

  // Get the latest entry to check for completion markers
  const latestEntry = scratchpad[scratchpad.length - 1] || {};
  const latestThought = latestEntry.thought || '';
  const latestObservation = latestEntry.observation || '';
  const combinedText = `${latestThought} ${latestObservation}`;

  // Check for completion markers in the latest thought or observation
  const hasFinalAnswer = /Final Answer:|FINAL_ANSWER|Task Complete/i.test(combinedText);
  const hasExceededMax = iteration >= maxIterations;

  // Auto-complete after successful conversational_response
  const isConversationalResponse = latestEntry.action === 'conversational_response';
  const hasSuccessfulResponse = latestObservation.includes('"success":true') && latestObservation.includes('"response"');
  const shouldAutoComplete = isConversationalResponse && hasSuccessfulResponse;

  const isComplete = hasFinalAnswer || hasExceededMax || shouldAutoComplete;

  const reason = hasFinalAnswer ? 'final_answer' :
    hasExceededMax ? 'max_iterations' :
    shouldAutoComplete ? 'auto_complete_conversational' :
    'continue';

  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Iteration: ${iteration}/${maxIterations}, Complete: ${isComplete}, Reason: ${reason}`);

  return {
    isComplete,
    hasFinalAnswer,
    hasExceededMax,
    shouldAutoComplete,
    iteration,
    scratchpad,
    maxIterations,
    reason,
  };
};

export const ScratchpadCompletionCheckerNode: NodeDefinition = defineNode({
  id: 'scratchpad_completion_checker',
  name: 'Completion Checker',
  category: 'operator',
  inputs: [
    { name: 'scratchpad', type: 'object', description: 'Scratchpad with iteration data' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Object with isComplete, reason, scratchpad' },
  ],
  description: 'Checks if ReAct task is complete based on scratchpad content',
  execute,
});
