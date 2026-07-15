/**
 * Active Operator System
 *
 * Bounded autonomy policy and user-control services above the core work
 * coordinator. This module owns no executable queue and invokes no executor.
 *
 * The queue, work lifecycle, ordering, execution registry, and recovery owner
 * is packages/core/src/queue.
 */

// Types
export * from './types.js';

// State persistence
export {
  loadConfig as loadActiveOperatorConfig,
  saveConfig as saveActiveOperatorConfig,
  updateConfig as updateActiveOperatorConfig,
} from './state-persister.js';

// Mode controller
export {
  ModeController,
  getModeController,
  getOperatorMode,
} from './mode-controller.js';

// Self-healing
export {
  type TSError,
  type FixProposal,
  type BigBrotherHealingContext,
  type BigBrotherHealingResult,
  parseTscOutput,
  runTypeCheck,
  analyzeError,
  saveProposal,
  loadPendingProposals,
  updateProposalStatus,
  runSelfHealing,
  getErrorCount,
  triggerBigBrotherHealing,
} from './self-healing.js';

// Critic (Superego - review and approval)
export {
  type ProposedChange,
  type CriticReview,
  type ApprovalRequest,
  generateDiff,
  formatDiffSummary,
  assessRisk,
  checkPolicies,
  reviewProposal,
  queueForApproval,
  getPendingApprovals,
  resolveApproval,
  submitForReview,
  proposeFileWrite,
  proposeFileDelete,
} from './critic.js';

// Pause Manager (intelligent pause/resume for user interaction)
export {
  // State updates
  updateTTSState,
  setCuriosityAwaiting,
  clearCuriosityAwaiting,
  setDesireAwaiting,
  clearDesireAwaiting,
  recordUserMessage,
  setLLMStreaming,
  // State queries
  isTTSSpeaking,
  isAwaitingCuriosity,
  isAwaitingDesireInput,
  isActiveConversation,
  shouldPauseForUser,
  getPauseState,
  clearAllPauseState,
  getUsersWithActivePauses,
  // Types
  type PauseCheckResult,
} from './pause-manager.js';

// Operator Proposals (Human-in-the-Loop approval system)
export {
  // Types
  type TrustLevel as ProposalTrustLevel,
  type TaskRisk,
  type ProposalTaskType,
  type ProposalResponse,
  type OperatorProposal,
  type ProposalFeedback,
  type ProposalStats,
  type PostExecutionFeedback,
  type PostFeedbackRequest,
  // Risk levels
  TASK_RISK_LEVELS,
  // Event emitter for waking Active Operator on approval
  proposalEvents,
  // Proposal CRUD
  createProposal,
  getPendingProposals as getOperatorPendingProposals,
  getPendingProposalTaskTypes,
  hasPendingProposalForTask,
  getProposal,
  respondToProposal,
  // Trust-based approval
  getApprovalRequirement,
  getUserTrustLevel,
  // Feedback collection
  getFeedback as getProposalFeedback,
  getProposalStats,
  getTaskApprovalRate,
  exportTrainingData as exportProposalTrainingData,
  // Post-execution feedback
  getPendingPostFeedback,
  submitPostFeedback,
  getPostFeedbackStats,
  // Combined training data
  exportAllTrainingData,
  // Cleanup
  cleanupOldProposals,
  // Big Brother execution review
  type ExecutionReviewResult,
  triggerBigBrotherExecutionReview,
  submitImprovementRequest,
} from './operator-proposals.js';
