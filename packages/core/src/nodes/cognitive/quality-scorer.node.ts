/**
 * Quality Scorer Node
 *
 * Scores response quality before final output, enabling iterative refinement.
 * This is a critical component for the feedback loop architecture.
 *
 * Purpose:
 * - Evaluate response quality against the original query
 * - Detect hallucinations and unsupported claims
 * - Check for factual grounding in provided memories
 * - Signal when response needs re-routing through the loop
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';

interface QualityIssue {
  type: 'hallucination' | 'irrelevant' | 'incomplete' | 'unsupported' | 'contradiction';
  severity: 'low' | 'medium' | 'high';
  description: string;
}

interface QualityScorerResult {
  qualityScore: number;
  issues: QualityIssue[];
  passesThreshold: boolean;
  needsRefinement: boolean;
  suggestions: string[];
  evaluation: string;
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Extract inputs
  const response = inputs.response ?? inputs[0] ?? '';
  const originalQuery = inputs.originalQuery ?? inputs[1] ?? context.userMessage ?? '';
  const memories = inputs.memories ?? inputs[2] ?? [];
  const unknownSignal = inputs.unknownSignal ?? inputs[3] ?? false;

  // Extract properties
  const qualityThreshold = properties?.qualityThreshold ?? 0.7;
  const strictHallucinationCheck = properties?.strictHallucinationCheck ?? true;
  const requireGrounding = properties?.requireGrounding ?? true;

  const responseText = typeof response === 'string' ? response : (response?.text || response?.content || '');

  console.log(`[quality_scorer] Evaluating response quality for: "${originalQuery.substring(0, 60)}..."`);

  // Early return for empty response
  if (!responseText || responseText.trim().length === 0) {
    return {
      qualityScore: 0,
      issues: [{ type: 'incomplete', severity: 'high', description: 'Empty response' }],
      passesThreshold: false,
      needsRefinement: true,
      suggestions: ['Generate a proper response'],
      evaluation: 'Response is empty',
    };
  }

  // Build memory context for grounding check
  const memoryContext = Array.isArray(memories)
    ? memories.slice(0, 5).map((m: any, i: number) => {
        const content = typeof m === 'string' ? m : (m.content || '');
        return `[Memory ${i + 1}]: ${content.substring(0, 150)}...`;
      }).join('\n')
    : '';

  try {
    const systemPrompt = `You are a Response Quality Evaluator.

Your purpose: Evaluate if a response is accurate, relevant, and grounded in facts.

CRITICAL EVALUATION CRITERIA:
1. HALLUCINATION CHECK: Does the response make claims not supported by the provided memories?
2. RELEVANCE CHECK: Does the response actually answer the question asked?
3. COMPLETENESS CHECK: Is the response complete and helpful?
4. GROUNDING CHECK: Are factual claims supported by the provided memory context?
5. HONEST UNCERTAINTY: If unknownSignal is true, does the response appropriately express uncertainty?

User's Question: "${originalQuery}"

Response to evaluate:
"${responseText}"

${memoryContext ? `Available memory context:\n${memoryContext}` : 'No memories were provided for this response.'}

unknownSignal (should respond "I don\'t know"): ${unknownSignal}

Output JSON:
{
  "qualityScore": 0.0-1.0,
  "issues": [
    {
      "type": "hallucination|irrelevant|incomplete|unsupported|contradiction",
      "severity": "low|medium|high",
      "description": "brief description"
    }
  ],
  "needsRefinement": boolean,
  "suggestions": ["specific improvement suggestions"],
  "evaluation": "brief summary of quality assessment"
}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: 'Evaluate this response quality.' },
    ];

    const llmResponse = await callLLM({
      role: 'orchestrator',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 768,
        temperature: 0.1,
      },
      onProgress: context.emitProgress,
    });

    // Parse the LLM response
    let evaluation;
    try {
      evaluation = JSON.parse(llmResponse.content);
    } catch {
      // Fallback parsing
      console.warn('[quality_scorer] Failed to parse LLM response, using defaults');
      const scoreMatch = llmResponse.content.match(/qualityScore[":]\s*([\d.]+)/i);
      const needsRefMatch = llmResponse.content.match(/needsRefinement[":]\s*(true|false)/i);

      evaluation = {
        qualityScore: scoreMatch ? parseFloat(scoreMatch[1]) : 0.5,
        issues: [],
        needsRefinement: needsRefMatch?.[1]?.toLowerCase() === 'true' ?? false,
        suggestions: [],
        evaluation: 'Unable to parse full evaluation',
      };
    }

    const qualityScore = Math.max(0, Math.min(1, evaluation.qualityScore ?? 0.5));
    const issues: QualityIssue[] = evaluation.issues || [];

    // Apply strict hallucination check
    if (strictHallucinationCheck && unknownSignal) {
      // If we should be saying "I don't know" but the response makes claims
      const hasAssertiveClaims = /(?:is|are|was|were|has|have|can|will)\s+(?!not sure|uncertain|unknown)/i.test(responseText);
      const acknowledgesUncertainty = /(?:don't know|not sure|uncertain|no (?:memory|information|record)|can't recall)/i.test(responseText);

      if (hasAssertiveClaims && !acknowledgesUncertainty) {
        issues.push({
          type: 'hallucination',
          severity: 'high',
          description: 'Response makes claims when it should express uncertainty (unknownSignal was true)',
        });
      }
    }

    // Apply grounding requirement
    if (requireGrounding && !unknownSignal && memoryContext.length === 0) {
      const makesClaims = /(?:you|your|we|our|greg|the)/i.test(responseText);
      if (makesClaims) {
        issues.push({
          type: 'unsupported',
          severity: 'medium',
          description: 'Response makes claims without memory grounding',
        });
      }
    }

    // Calculate final score based on issues
    let adjustedScore = qualityScore;
    for (const issue of issues) {
      if (issue.severity === 'high') adjustedScore -= 0.3;
      else if (issue.severity === 'medium') adjustedScore -= 0.15;
      else adjustedScore -= 0.05;
    }
    adjustedScore = Math.max(0, Math.min(1, adjustedScore));

    const passesThreshold = adjustedScore >= qualityThreshold;
    const needsRefinement = evaluation.needsRefinement ?? !passesThreshold;

    console.log(`[quality_scorer] Score: ${adjustedScore.toFixed(2)} (threshold: ${qualityThreshold}), issues: ${issues.length}, passes: ${passesThreshold}`);

    const result: QualityScorerResult = {
      qualityScore: adjustedScore,
      issues,
      passesThreshold,
      needsRefinement,
      suggestions: evaluation.suggestions || [],
      evaluation: evaluation.evaluation || `Quality score: ${adjustedScore.toFixed(2)}`,
    };

    return {
      response: responseText,  // Passthrough for downstream nodes
      qualityResult: result,   // Full result object for feedback router
      ...result,
      originalScore: qualityScore,
      adjustedScore,
      threshold: qualityThreshold,
    };

  } catch (error) {
    console.error('[quality_scorer] Error:', error);

    const errorResult = {
      qualityScore: 0.5,
      issues: [{ type: 'incomplete' as const, severity: 'medium' as const, description: 'Quality evaluation failed' }],
      passesThreshold: false,
      needsRefinement: true,
      suggestions: ['Re-evaluate response quality'],
      evaluation: 'Evaluation failed due to error',
    };

    // On error, be conservative - don't pass without evaluation, but still pass response through
    return {
      response: responseText,  // Still pass through the response
      qualityResult: errorResult,
      ...errorResult,
      error: (error as Error).message,
    };
  }
};

export const QualityScorerNode: NodeDefinition = defineNode({
  id: 'quality_scorer',
  name: 'Quality Scorer',
  category: 'cognitive',
  inputs: [
    { name: 'response', type: 'string', description: 'Generated response to evaluate' },
    { name: 'originalQuery', type: 'string', description: 'Original user query' },
    { name: 'memories', type: 'array', optional: true, description: 'Memories used for grounding check' },
    { name: 'unknownSignal', type: 'boolean', optional: true, description: 'Whether search interpreter signaled unknown' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Passthrough of the input response' },
    { name: 'qualityResult', type: 'object', description: 'Full quality evaluation result' },
    { name: 'qualityScore', type: 'number', description: 'Quality score 0-1' },
    { name: 'issues', type: 'array', description: 'List of quality issues found' },
    { name: 'passesThreshold', type: 'boolean', description: 'Whether response passes quality threshold' },
    { name: 'needsRefinement', type: 'boolean', description: 'Whether response needs another pass' },
    { name: 'suggestions', type: 'array', description: 'Specific improvement suggestions' },
    { name: 'evaluation', type: 'string', description: 'Summary of quality assessment' },
  ],
  properties: {
    qualityThreshold: 0.7,
    strictHallucinationCheck: true,
    requireGrounding: true,
  },
  propertySchemas: {
    qualityThreshold: {
      type: 'slider',
      default: 0.7,
      label: 'Quality Threshold',
      min: 0.5,
      max: 0.95,
      step: 0.05,
    },
    strictHallucinationCheck: {
      type: 'toggle',
      default: true,
      label: 'Strict Hallucination Check',
    },
    requireGrounding: {
      type: 'toggle',
      default: true,
      label: 'Require Memory Grounding',
    },
  },
  description: 'Evaluates response quality and detects hallucinations for iterative refinement',
  execute,
});
