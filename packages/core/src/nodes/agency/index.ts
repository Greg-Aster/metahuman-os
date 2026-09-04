/**
 * Agency Nodes
 *
 * Nodes for the agency (desire) system.
 * These nodes handle desire lifecycle: detection, creation, planning, reviewing, execution, and outcome.
 */

export { DesireLoaderNode } from './desire-loader.node.js';
export { activeDesiresNode } from './active-desires.node.js';
export { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
export { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
export { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
export { DesireVerdictNode } from './desire-verdict.node.js';
export { DesireUpdaterNode } from './desire-updater.node.js';
export { DesirePlanReviewRecorderNode } from './desire-plan-review-recorder.node.js';
export { DesirePlanReviewTransitionNode } from './desire-plan-review-transition.node.js';
export { DesireExecutorNode } from './desire-executor.node.js';
export { OutcomeReviewerNode } from './outcome-reviewer.node.js';
export { DesireFeasibilityNode, parseFeasibilityResponse } from './desire-feasibility.node.js';
export {
  DesireCheckinEvaluatorNode,
  parseDesireCheckinEvaluation,
  validateDesireCheckinEvaluation,
} from './desire-checkin-evaluator.node.js';
export { definition as DesireQuestionGeneratorNode } from './desire-question-generator.node.js';
export { DesireQuestionTransitionNode } from './desire-question-transition.node.js';
export {
  DesireGenerationInputNode,
  DesireGenerationNode,
  parseDesireCandidates,
  parseReinforcementResponse,
  validateCandidateSources,
} from './desire-generation.node.js';

// Re-export all nodes as an array for registration
import { DesireLoaderNode } from './desire-loader.node.js';
import { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
import { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
import { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
import { DesireVerdictNode } from './desire-verdict.node.js';
import { DesireUpdaterNode } from './desire-updater.node.js';
import { DesirePlanReviewRecorderNode } from './desire-plan-review-recorder.node.js';
import { DesirePlanReviewTransitionNode } from './desire-plan-review-transition.node.js';
import { DesireExecutorNode } from './desire-executor.node.js';
import { OutcomeReviewerNode } from './outcome-reviewer.node.js';
import { DesireFeasibilityNode } from './desire-feasibility.node.js';
import { DesireCheckinEvaluatorNode } from './desire-checkin-evaluator.node.js';
import { definition as DesireQuestionGeneratorNode } from './desire-question-generator.node.js';
import { DesireQuestionTransitionNode } from './desire-question-transition.node.js';
import { DesireGenerationInputNode, DesireGenerationNode } from './desire-generation.node.js';

export const agencyNodes = [
  DesireLoaderNode,
  DesirePlanGeneratorNode,
  DesireAlignmentReviewerNode,
  DesireSafetyReviewerNode,
  DesireVerdictNode,
  DesireUpdaterNode,
  DesirePlanReviewRecorderNode,
  DesirePlanReviewTransitionNode,
  DesireExecutorNode,
  OutcomeReviewerNode,
  DesireFeasibilityNode,
  DesireCheckinEvaluatorNode,
  DesireQuestionGeneratorNode,
  DesireQuestionTransitionNode,
  DesireGenerationInputNode,
  DesireGenerationNode,
];
