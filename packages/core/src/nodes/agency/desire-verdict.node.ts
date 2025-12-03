/**
 * Desire Verdict Node
 *
 * Synthesizes final verdict from alignment and safety reviews.
 * Determines whether to approve, reject, or revise the plan.
 *
 * Inputs:
 *   - desire: Desire object
 *   - plan: DesirePlan object
 *   - alignmentReview: alignment review output
 *   - safetyReview: safety review output
 *
 * Outputs:
 *   - verdict: 'approve' | 'reject' | 'revise'
 *   - review: DesireReview object
 *   - autoApprove: boolean (can skip approval queue)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesirePlan, DesireReview } from '../../agency/types.js';
import { generateReviewId } from '../../agency/types.js';
import { canAutoApprove, isRiskBlocked } from '../../agency/config.js';

interface AlignmentReviewInput {
  alignmentScore: number;
  concerns: string[];
  approved: boolean;
  reasoning: string;
}

interface SafetyReviewInput {
  safetyScore: number;
  risks: string[];
  mitigations: string[];
  approved: boolean;
  reasoning: string;
}

const execute: NodeExecutor = async (inputs, context, _properties) => {
  const desire = inputs.desire as Desire | undefined;
  const plan = inputs.plan as DesirePlan | undefined;
  const alignmentReview = inputs.alignmentReview as AlignmentReviewInput | undefined;
  const safetyReview = inputs.safetyReview as SafetyReviewInput | undefined;
  const username = context.userId;

  if (!desire || !plan || !alignmentReview || !safetyReview) {
    return {
      verdict: 'reject',
      review: null,
      autoApprove: false,
      reasoning: 'Missing required inputs for verdict',
    };
  }

  // Check if risk is blocked entirely
  const blocked = await isRiskBlocked(plan.estimatedRisk, username);
  if (blocked) {
    const review: DesireReview = {
      id: generateReviewId(desire.id),
      verdict: 'reject',
      reasoning: `Risk level "${plan.estimatedRisk}" is blocked by policy`,
      concerns: ['Risk level exceeds policy limits'],
      riskAssessment: `Blocked: ${plan.estimatedRisk}`,
      alignmentScore: alignmentReview.alignmentScore,
      reviewedAt: new Date().toISOString(),
    };

    return {
      verdict: 'reject',
      review,
      autoApprove: false,
      reasoning: review.reasoning,
    };
  }

  // Combine scores (weighted average)
  const combinedScore = (alignmentReview.alignmentScore * 0.4 + safetyReview.safetyScore * 0.6);

  // Collect all concerns
  const allConcerns = [
    ...alignmentReview.concerns,
    ...safetyReview.risks,
  ];

  // Determine verdict
  let verdict: 'approve' | 'reject' | 'revise';
  let reasoning: string;

  if (!alignmentReview.approved && !safetyReview.approved) {
    verdict = 'reject';
    reasoning = `Both alignment and safety reviews failed. Alignment: ${alignmentReview.reasoning}. Safety: ${safetyReview.reasoning}`;
  } else if (!safetyReview.approved) {
    verdict = 'reject';
    reasoning = `Safety review failed: ${safetyReview.reasoning}`;
  } else if (!alignmentReview.approved && combinedScore < 0.5) {
    verdict = 'reject';
    reasoning = `Alignment review failed with low combined score (${combinedScore.toFixed(2)}): ${alignmentReview.reasoning}`;
  } else if (!alignmentReview.approved && combinedScore >= 0.5) {
    verdict = 'revise';
    reasoning = `Alignment concerns but safety approved. Consider revising: ${alignmentReview.reasoning}`;
  } else if (combinedScore < 0.6) {
    verdict = 'revise';
    reasoning = `Combined score (${combinedScore.toFixed(2)}) below threshold. Consider improvements.`;
  } else {
    verdict = 'approve';
    reasoning = `Both reviews passed. Alignment: ${alignmentReview.alignmentScore.toFixed(2)}, Safety: ${safetyReview.safetyScore.toFixed(2)}`;
  }

  // Build review object
  const review: DesireReview = {
    id: generateReviewId(desire.id),
    verdict,
    reasoning,
    concerns: allConcerns.length > 0 ? allConcerns : undefined,
    suggestions: safetyReview.mitigations.length > 0 ? safetyReview.mitigations : undefined,
    riskAssessment: `Estimated: ${plan.estimatedRisk}, Safety Score: ${safetyReview.safetyScore.toFixed(2)}`,
    alignmentScore: alignmentReview.alignmentScore,
    reviewedAt: new Date().toISOString(),
  };

  // Check if can auto-approve
  let autoApprove = false;
  if (verdict === 'approve') {
    autoApprove = await canAutoApprove(plan.estimatedRisk, desire.strength, username);
  }

  return {
    verdict,
    review,
    autoApprove,
    reasoning,
  };
};

export const DesireVerdictNode: NodeDefinition = defineNode({
  id: 'desire_verdict',
  name: 'Desire Verdict',
  category: 'agency',
  description: 'Synthesizes final verdict from alignment and safety reviews',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire being reviewed' },
    { name: 'plan', type: 'object', description: 'Plan being reviewed' },
    { name: 'alignmentReview', type: 'object', description: 'Output from alignment reviewer' },
    { name: 'safetyReview', type: 'object', description: 'Output from safety reviewer' },
  ],
  outputs: [
    { name: 'verdict', type: 'string', description: 'approve, reject, or revise' },
    { name: 'review', type: 'object', description: 'Complete DesireReview object' },
    { name: 'autoApprove', type: 'boolean', description: 'Whether to skip approval queue' },
    { name: 'reasoning', type: 'string', description: 'Explanation of verdict' },
  ],
  properties: {},
  execute,
});

export default DesireVerdictNode;
