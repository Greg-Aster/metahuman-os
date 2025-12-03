/**
 * Agency Nodes
 *
 * Nodes for the agency (desire) system.
 * These nodes handle desire lifecycle: loading, planning, reviewing, and execution.
 */

export { DesireLoaderNode } from './desire-loader.node.js';
export { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
export { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
export { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
export { DesireVerdictNode } from './desire-verdict.node.js';
export { DesireUpdaterNode } from './desire-updater.node.js';
export { ApprovalQueueNode } from './approval-queue.node.js';

// Re-export all nodes as an array for registration
import { DesireLoaderNode } from './desire-loader.node.js';
import { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
import { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
import { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
import { DesireVerdictNode } from './desire-verdict.node.js';
import { DesireUpdaterNode } from './desire-updater.node.js';
import { ApprovalQueueNode } from './approval-queue.node.js';

export const agencyNodes = [
  DesireLoaderNode,
  DesirePlanGeneratorNode,
  DesireAlignmentReviewerNode,
  DesireSafetyReviewerNode,
  DesireVerdictNode,
  DesireUpdaterNode,
  ApprovalQueueNode,
];
