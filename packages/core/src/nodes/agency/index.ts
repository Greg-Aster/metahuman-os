/**
 * Agency Nodes
 *
 * Nodes for the agency (desire) system.
 * These nodes handle desire lifecycle: detection, creation, planning, reviewing, execution, and outcome.
 */

export { DesireLoaderNode } from './desire-loader.node.js';
export { activeDesiresNode } from './active-desires.node.js';
export { DesireConversationLoaderNode } from './desire-conversation-loader.node.js';
export { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
export { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
export { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
export { DesireVerdictNode } from './desire-verdict.node.js';
export { DesireUpdaterNode } from './desire-updater.node.js';
export { ApprovalQueueNode } from './approval-queue.node.js';
export { DesireExecutorNode } from './desire-executor.node.js';
export { OutcomeReviewerNode } from './outcome-reviewer.node.js';

// Re-export all nodes as an array for registration
import { DesireLoaderNode } from './desire-loader.node.js';
import { DesireConversationLoaderNode } from './desire-conversation-loader.node.js';
import { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
import { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
import { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
import { DesireVerdictNode } from './desire-verdict.node.js';
import { DesireUpdaterNode } from './desire-updater.node.js';
import { ApprovalQueueNode } from './approval-queue.node.js';
import { DesireExecutorNode } from './desire-executor.node.js';
import { OutcomeReviewerNode } from './outcome-reviewer.node.js';

export const agencyNodes = [
  DesireLoaderNode,
  DesireConversationLoaderNode,
  DesirePlanGeneratorNode,
  DesireAlignmentReviewerNode,
  DesireSafetyReviewerNode,
  DesireVerdictNode,
  DesireUpdaterNode,
  ApprovalQueueNode,
  DesireExecutorNode,
  OutcomeReviewerNode,
];
