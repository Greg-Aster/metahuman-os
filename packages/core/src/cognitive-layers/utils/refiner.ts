/**
 * Response Refiner
 *
 * Refines responses to fix validation issues while preserving meaning.
 * Uses curator model to improve alignment, consistency, and safety.
 *
 * @module cognitive-layers/utils/refiner
 */

import type { ValueAlignmentResult } from '../validators/value-alignment.js';
import type { ConsistencyResult } from '../validators/consistency.js';
import type { SafetyResult } from '../validators/safety.js';
import { callLLM } from '../../model-router.js';
import { audit } from '../../audit.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Refinement result
 */
export interface RefinementResult {
  /** Refined response */
  refined: string;

  /** Whether refinement was needed */
  changed: boolean;

  /** What was changed */
  changes: string[];

  /** Processing time in ms */
  processingTime: number;
}

/**
 * Refinement options
 */
export interface RefinementOptions {
  /** Original response to refine */
  original: string;

  /** Value alignment issues (optional) */
  valueIssues?: ValueAlignmentResult;

  /** Consistency issues (optional) */
  consistencyIssues?: ConsistencyResult;

  /** Safety issues (optional) */
  safetyIssues?: SafetyResult;

  /** Cognitive mode for model selection */
  cognitiveMode?: string;

  /** Whether to preserve exact meaning (default: true) */
  preserveMeaning?: boolean;
}

// ============================================================================
// Response Refiner
// ============================================================================

/**
 * Refine response to fix validation issues
 *
 * Uses curator model to improve response while preserving core meaning.
 * Fixes issues in this order:
 * 1. Safety (critical - use sanitized version if available)
 * 2. Value alignment (important - adjust to match values)
 * 3. Consistency (nice-to-have - improve tone/style)
 *
 * @param options - Refinement options
 * @returns Refined response with changes
 */
export async function refineResponse(
  options: RefinementOptions
): Promise<RefinementResult> {
  const startTime = Date.now();

  const {
    original,
    valueIssues,
    consistencyIssues,
    safetyIssues,
    cognitiveMode = 'dual',
    preserveMeaning = true
  } = options;

  // If everything is fine, no refinement needed
  const needsRefinement =
    (valueIssues && !valueIssues.aligned) ||
    (consistencyIssues && !consistencyIssues.consistent) ||
    (safetyIssues && !safetyIssues.safe);

  if (!needsRefinement) {
    return {
      refined: original,
      changed: false,
      changes: [],
      processingTime: Date.now() - startTime
    };
  }

  // Priority 1: Safety - use sanitized version if available
  let workingResponse = original;
  const changes: string[] = [];

  if (safetyIssues && !safetyIssues.safe) {
    if (safetyIssues.sanitized) {
      workingResponse = safetyIssues.sanitized;
      changes.push('Applied safety sanitization');
    } else {
      changes.push('Safety issues detected (no sanitized version)');
    }
  }

  // Priority 2 & 3: Value alignment and consistency - use LLM refinement
  if ((valueIssues && !valueIssues.aligned) || (consistencyIssues && !consistencyIssues.consistent)) {
    try {
      const refinedByLLM = await refineWithLLM(
        workingResponse,
        valueIssues,
        consistencyIssues,
        preserveMeaning,
        cognitiveMode
      );

      if (refinedByLLM.changed) {
        workingResponse = refinedByLLM.refined;
        changes.push(...refinedByLLM.changes);
      }
    } catch (error) {
      console.error('[refiner] LLM refinement failed:', error);
      changes.push('LLM refinement failed (using original)');
    }
  }

  const result: RefinementResult = {
    refined: workingResponse,
    changed: changes.length > 0,
    changes,
    processingTime: Date.now() - startTime
  };

  // Audit refinement
  await audit({
    category: 'action',
    level: 'info',
    action: 'response_refined',
    details: {
      changed: result.changed,
      changesCount: changes.length,
      changes,
      processingTime: result.processingTime
    }
  });

  return result;
}

/**
 * Refine response using LLM
 */
async function refineWithLLM(
  response: string,
  valueIssues: ValueAlignmentResult | undefined,
  consistencyIssues: ConsistencyResult | undefined,
  preserveMeaning: boolean,
  cognitiveMode: string
): Promise<{ refined: string; changed: boolean; changes: string[] }> {
  const changes: string[] = [];

  // Build refinement instructions
  const instructions: string[] = [];

  instructions.push('# Response Refinement Task');
  instructions.push('');
  instructions.push('You are refining a response to fix validation issues while preserving its core meaning.');
  instructions.push('');

  // Add value alignment issues
  if (valueIssues && !valueIssues.aligned && valueIssues.issues.length > 0) {
    instructions.push('## Value Alignment Issues to Fix:');
    instructions.push('');
    for (const issue of valueIssues.issues) {
      instructions.push(`- **${issue.value}**: ${issue.description}`);
      if (issue.suggestion) {
        instructions.push(`  Suggestion: ${issue.suggestion}`);
      }
    }
    instructions.push('');
    changes.push('Fixed value alignment issues');
  }

  // Add consistency issues
  if (consistencyIssues && !consistencyIssues.consistent && consistencyIssues.issues.length > 0) {
    instructions.push('## Consistency Issues to Fix:');
    instructions.push('');
    for (const issue of consistencyIssues.issues) {
      instructions.push(`- **${issue.aspect}**: ${issue.description}`);
      if (issue.example) {
        instructions.push(`  Example: "${issue.example}"`);
      }
    }
    instructions.push('');
    changes.push('Fixed consistency issues');
  }

  // Add refinement guidelines
  instructions.push('## Refinement Guidelines:');
  instructions.push('');
  if (preserveMeaning) {
    instructions.push('- **Preserve core meaning**: Do not change what the response is saying, only how it says it');
  }
  instructions.push('- **Fix issues subtly**: Make minimal changes to address the issues');
  instructions.push('- **Maintain natural flow**: Ensure the response still sounds natural');
  instructions.push('- **Keep the same length**: Try to match the original response length');
  instructions.push('');
  instructions.push('Provide only the refined response, with no explanations or meta-commentary.');

  const systemPrompt = instructions.join('\n');

  // Call curator model for refinement
  const refinementResponse = await callLLM({
    role: 'curator',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Original response to refine:\n\n"${response}"` }
    ],
    cognitiveMode,
    options: {
      temperature: 0.5, // Moderate temperature for creative refinement
      max_tokens: 1000
    }
  });

  const refined = refinementResponse.content.trim();

  // Check if actually changed
  const actuallyChanged = refined !== response && refined.length > 10;

  return {
    refined: actuallyChanged ? refined : response,
    changed: actuallyChanged,
    changes: actuallyChanged ? changes : []
  };
}

/**
 * Quick refinement (minimal changes, fast)
 *
 * Only fixes critical safety issues using sanitization.
 * Skips value/consistency refinement.
 *
 * @param response - Response to refine
 * @param safetyIssues - Safety validation result
 * @returns Refined response
 */
export async function quickRefine(
  response: string,
  safetyIssues?: SafetyResult
): Promise<string> {
  if (!safetyIssues || safetyIssues.safe) {
    return response;
  }

  // Use sanitized version if available
  return safetyIssues.sanitized || response;
}

/**
 * Get refinement summary for debugging
 */
export function getRefinementSummary(result: RefinementResult): string {
  const parts: string[] = [];

  parts.push(`Refinement: ${result.changed ? '✓ CHANGED' : '○ NO CHANGES'}`);

  if (result.changed) {
    parts.push(`Changes made: ${result.changes.length}`);
    for (const change of result.changes) {
      parts.push(`  - ${change}`);
    }

    const lengthDiff = result.refined.length - (result.refined.length > 0 ? result.refined.length : 1);
    if (Math.abs(lengthDiff) > 50) {
      parts.push(`Length changed by ${lengthDiff} characters`);
    }
  }

  parts.push(`\nProcessing time: ${result.processingTime}ms`);

  return parts.join('\n');
}

/**
 * Compare original and refined responses
 *
 * Useful for debugging and understanding what changed.
 *
 * @param original - Original response
 * @param refined - Refined response
 * @returns Comparison summary
 */
export function compareResponses(original: string, refined: string): {
  lengthChange: number;
  wordCountChange: number;
  significantChange: boolean;
} {
  const lengthChange = refined.length - original.length;

  const originalWords = original.split(/\s+/).length;
  const refinedWords = refined.split(/\s+/).length;
  const wordCountChange = refinedWords - originalWords;

  // Significant change if more than 20% different
  const significantChange = Math.abs(lengthChange) / original.length > 0.2;

  return {
    lengthChange,
    wordCountChange,
    significantChange
  };
}
