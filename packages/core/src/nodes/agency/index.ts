/**
 * Agency Nodes
 *
 * Nodes for the agency (desire) system.
 * These nodes handle desire lifecycle: detection, creation, planning, reviewing, execution, and outcome.
 */

export { DesireDetectorNode } from './desire-detector.node.js';
export { DesireFolderCreatorNode } from './desire-folder-creator.node.js';
export { DesireMemoryAnalyzerNode } from './desire-memory-analyzer.node.js';
export { DesireLoaderNode } from './desire-loader.node.js';
export { DesireEnricherNode } from './desire-enricher.node.js';
export { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
export { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
export { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
export { DesireVerdictNode } from './desire-verdict.node.js';
export { DesireUpdaterNode } from './desire-updater.node.js';
export { ApprovalQueueNode } from './approval-queue.node.js';
export { DesireExecutorNode } from './desire-executor.node.js';
export { OutcomeReviewerNode } from './outcome-reviewer.node.js';
export { VerdictRouterNode } from './verdict-router.node.js';

// Re-export all nodes as an array for registration
import { DesireDetectorNode } from './desire-detector.node.js';
import { DesireFolderCreatorNode } from './desire-folder-creator.node.js';
import { DesireMemoryAnalyzerNode } from './desire-memory-analyzer.node.js';
import { DesireLoaderNode } from './desire-loader.node.js';
import { DesireEnricherNode } from './desire-enricher.node.js';
import { DesirePlanGeneratorNode } from './desire-plan-generator.node.js';
import { DesireAlignmentReviewerNode } from './desire-alignment-reviewer.node.js';
import { DesireSafetyReviewerNode } from './desire-safety-reviewer.node.js';
import { DesireVerdictNode } from './desire-verdict.node.js';
import { DesireUpdaterNode } from './desire-updater.node.js';
import { ApprovalQueueNode } from './approval-queue.node.js';
import { DesireExecutorNode } from './desire-executor.node.js';
import { OutcomeReviewerNode } from './outcome-reviewer.node.js';
import { VerdictRouterNode } from './verdict-router.node.js';

export const agencyNodes = [
  DesireDetectorNode,
  DesireFolderCreatorNode,
  DesireMemoryAnalyzerNode,
  DesireLoaderNode,
  DesireEnricherNode,
  DesirePlanGeneratorNode,
  DesireAlignmentReviewerNode,
  DesireSafetyReviewerNode,
  DesireVerdictNode,
  DesireUpdaterNode,
  ApprovalQueueNode,
  DesireExecutorNode,
  OutcomeReviewerNode,
  VerdictRouterNode,
];
