/**
 * Feedback Router Node
 *
 * Routes responses based on quality/safety results, enabling iterative refinement loops.
 * This is the critical decision point for the feedback loop architecture.
 *
 * Purpose:
 * - Decide whether to pass response to output or loop back to orchestrator
 * - Track iteration count to prevent infinite loops
 * - Build feedback context for the orchestrator on re-routing
 * - Gracefully exit with best attempt when max iterations reached
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

interface QualityResult {
  qualityScore: number;
  passesThreshold: boolean;
  needsRefinement: boolean;
  issues: Array<{ type: string; severity: string; description: string }>;
  suggestions: string[];
  evaluation?: string;
}

interface SafetyResult {
  passed: boolean;
  violations: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface FeedbackContext {
  iteration: number;
  previousAttempts: Array<{
    response: string;
    qualityScore: number;
    issues: string[];
    suggestions: string[];
  }>;
  feedbackType: 'quality' | 'safety' | 'both';
  specificFeedback: string;
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Extract inputs
  const response = inputs.response ?? inputs[0] ?? '';
  const qualityResult: QualityResult = inputs.qualityResult ?? inputs[1] ?? { passesThreshold: true, qualityScore: 1 };
  const safetyResult: SafetyResult = inputs.safetyResult ?? inputs[2] ?? { passed: true, violations: [], severity: 'low' };
  // Get iteration from input, context (injected by graph executor), or default to 1
  const currentIteration = inputs.currentIteration ?? inputs[3] ?? context._graphExecutorIteration ?? 1;
  const previousFeedback: FeedbackContext | null = inputs.previousFeedback ?? inputs[4] ?? null;

  // Extract properties
  const maxIterations = properties?.maxIterations ?? 3;
  const qualityThresholdOverride = properties?.qualityThresholdOverride ?? null;
  const allowPartialSuccess = properties?.allowPartialSuccess ?? true;

  const responseText = typeof response === 'string' ? response : (response?.text || response?.content || '');
  const iteration = typeof currentIteration === 'number' ? currentIteration : 1;

  // Check safety first (higher priority than quality)
  const safetyPassed = safetyResult.passed ?? true;
  const safetyCritical = safetyResult.severity === 'critical';

  // Check quality
  const qualityPassed = qualityResult.passesThreshold ?? true;
  const qualityScore = qualityResult.qualityScore ?? 1;

  // Build previous attempts list for context
  const previousAttempts = previousFeedback?.previousAttempts ?? [];
  if (responseText && !qualityPassed) {
    previousAttempts.push({
      response: responseText.substring(0, 200),
      qualityScore,
      issues: (qualityResult.issues || []).map(i => i.description),
      suggestions: qualityResult.suggestions || [],
    });
  }

  // Decision logic
  const shouldPass = safetyPassed && qualityPassed;
  const shouldLoop = !shouldPass && iteration < maxIterations && !safetyCritical;
  const reachedMaxIterations = iteration >= maxIterations;

  // Determine routing
  let routedTo: 'output' | 'orchestrator';
  let exitReason: string;

  if (shouldPass) {
    routedTo = 'output';
    exitReason = 'passed_all_checks';
    console.log(`[feedback_router] PASS - routing to output`);
  } else if (safetyCritical) {
    routedTo = 'output';
    exitReason = 'safety_critical_block';
    console.log(`[feedback_router] BLOCKED - critical safety violation, cannot proceed`);
  } else if (reachedMaxIterations) {
    routedTo = 'output';
    exitReason = allowPartialSuccess ? 'max_iterations_partial' : 'max_iterations_failed';
    console.log(`[feedback_router] MAX ITERATIONS - routing to output with ${allowPartialSuccess ? 'best attempt' : 'failure'}`);
  } else {
    routedTo = 'orchestrator';
    exitReason = 'needs_refinement';
    console.log(`[feedback_router] LOOP - routing back to orchestrator for refinement`);
  }

  // Build feedback context for orchestrator (if looping back)
  let feedbackContext: FeedbackContext | null = null;
  if (routedTo === 'orchestrator') {
    const feedbackType = (!safetyPassed && !qualityPassed) ? 'both'
      : !safetyPassed ? 'safety'
      : 'quality';

    const specificIssues: string[] = [];
    if (!safetyPassed) {
      specificIssues.push(`Safety issues: ${safetyResult.violations?.join(', ') || 'unknown'}`);
    }
    if (!qualityPassed) {
      // Pass ALL issues - let the LLM decide what's important
      const qualityIssues = (qualityResult.issues || [])
        .map(i => i.description);
      if (qualityIssues.length > 0) {
        specificIssues.push(`Quality issues: ${qualityIssues.join(', ')}`);
      }
      if (qualityResult.suggestions?.length > 0) {
        specificIssues.push(`Suggestions: ${qualityResult.suggestions.join(', ')}`);
      }
      // Include evaluation summary if available
      if (qualityResult.evaluation) {
        specificIssues.push(`Evaluation: ${qualityResult.evaluation}`);
      }
    }

    feedbackContext = {
      iteration: iteration + 1,
      previousAttempts,
      feedbackType,
      specificFeedback: specificIssues.join('. '),
    };
  }

  // Determine final response
  let finalResponse = responseText;
  if (safetyCritical) {
    finalResponse = 'I apologize, but I cannot provide that response due to safety constraints.';
  } else if (reachedMaxIterations && !qualityPassed && !allowPartialSuccess) {
    finalResponse = `I'm having difficulty providing a good answer to "${context.userMessage?.substring(0, 50)}...". Could you rephrase your question?`;
  }

  return {
    routedTo,
    response: finalResponse,
    feedbackContext,
    exitReason,
    iteration,
    maxIterationsReached: reachedMaxIterations,
    qualityPassed,
    safetyPassed,
    qualityScore,
    previousAttemptCount: previousAttempts.length,
    shouldContinueLoop: routedTo === 'orchestrator',
  };
};

export const FeedbackRouterNode: NodeDefinition = defineNode({
  id: 'feedback_router',
  name: 'Feedback Router',
  category: 'control_flow',
  inputs: [
    { name: 'response', type: 'string', description: 'Generated response' },
    { name: 'qualityResult', type: 'object', description: 'Quality evaluation result' },
    { name: 'safetyResult', type: 'object', optional: true, description: 'Safety validation result' },
    { name: 'currentIteration', type: 'number', optional: true, description: 'Current loop iteration (default: 1)' },
    { name: 'previousFeedback', type: 'object', optional: true, description: 'Feedback from previous iteration' },
  ],
  outputs: [
    { name: 'routedTo', type: 'string', description: '"output" or "orchestrator"' },
    { name: 'response', type: 'string', description: 'Response to output (may be modified on failure)' },
    { name: 'feedbackContext', type: 'object', description: 'Feedback context for orchestrator (if looping)' },
    { name: 'exitReason', type: 'string', description: 'Reason for routing decision' },
    { name: 'shouldContinueLoop', type: 'boolean', description: 'True if routing back to orchestrator' },
    { name: 'iteration', type: 'number', description: 'Current iteration number' },
    { name: 'qualityScore', type: 'number', description: 'Quality score of the response' },
  ],
  properties: {
    maxIterations: 3,
    qualityThresholdOverride: null,
    allowPartialSuccess: true,
  },
  propertySchemas: {
    maxIterations: {
      type: 'slider',
      default: 3,
      label: 'Max Iterations',
      min: 1,
      max: 5,
      step: 1,
    },
    allowPartialSuccess: {
      type: 'toggle',
      default: true,
      label: 'Allow Partial Success',
    },
  },
  description: 'Routes responses based on quality/safety, enabling iterative refinement loops',
  execute,
});
