/**
 * Active Operator System
 *
 * A proactive, LLM-controlled continuous thinking system that transforms
 * MetaHuman OS from passive response generation into active cognition.
 *
 * Key components:
 * - Service Manager: Lifecycle control for the decision loop
 * - Lizard Brain: Autonomous decision making with triggers
 * - Task Executor: Execute tasks via existing agents
 * - Mode Controller: Switch between passive/active modes
 * - State Persister: Disk persistence for crash recovery
 *
 * NOTE: The Active Operator now uses the unified lane-based queue system
 * from packages/core/src/queue/ for task management. The legacy UnifiedQueue
 * is kept for backwards compatibility but is no longer used internally.
 */

// Types
export * from './types.js';

// Queue (DEPRECATED: Use packages/core/src/queue/ instead)
// Kept for backwards compatibility - internal code uses lane-based queue
export { UnifiedQueue, createPersistentQueue } from './unified-queue.js';

// State persistence
export {
  // Scratchpad
  type ScratchpadEntry,
  type DecisionScratchpad,
  loadScratchpad,
  saveScratchpad,
  addScratchpadEntry,
  recordDecision,
  recordExecutionStart,
  recordTaskResult,
  recordThought,
  updateActivitySummary,
  createFreshScratchpad,
  clearScratchpad,
  getScratchpadContext,
  // Queue state
  saveQueueState,
  loadQueueState,
  clearQueueState,
  // Current task
  saveCurrentTask,
  loadCurrentTask,
  clearCurrentTask,
  // Metrics
  saveMetrics,
  loadMetrics,
  loadMetrics as loadActiveOperatorMetrics,
  resetMetrics,
  resetMetrics as resetActiveOperatorMetrics,
  // Config
  loadConfig as loadActiveOperatorConfig,
  saveConfig as saveActiveOperatorConfig,
  updateConfig as updateActiveOperatorConfig,
  // Full state
  clearAllState,
  getStateDir,
} from './state-persister.js';

// Mode controller
export {
  ModeController,
  getModeController,
  isActiveOperatorEnabled,
  getOperatorMode,
} from './mode-controller.js';

// System state gathering
export {
  gatherSystemState,
  formatSystemStateForLLM,
  getTaskRecommendations,
} from './system-state.js';

// Cost tracking
export {
  recordTokenUsage,
  recordTaskExecution,
  getTokensUsedThisHour,
  isWithinBudget,
  getRemainingBudget,
  getBudgetUtilization,
  getCostSummary,
  shouldPauseDueToErrors,
  getErrorStatus,
  resetErrorCounter,
} from './cost-tracker.js';

// Task execution
export {
  executeTask,
  isTaskExecutable,
  getAvailableTaskTypes,
} from './task-executor.js';

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

// Lizard Brain (autonomous triggers + unified decision)
export {
  type Trigger,
  type TriggerResult,
  type CircadianWindow,
  CIRCADIAN_WINDOWS,
  TRIGGERS,
  getCurrentCircadianWindow,
  isTaskCircadianAppropriate,
  getCircadianRecommendations,
  evaluateTrigger,
  getTriggerStatuses,
  checkFocusConstraints,
  // makeUnifiedDecision - DEPRECATED: now handled by lizard-brain.json graph
} from './lizard-brain.js';

// Lizard Brain Logger (structured decision logging)
export {
  type LizardBrainLogEntry,
  type LizardBrainLogFile,
  type LizardBrainLoggerConfig,
  getLizardBrainLogs,
  logLizardBrainCycle,
  updateLogEntry,
  recordExecutionResult,
  recordBigBrotherReview,
  getAvailableLogDates,
  cleanupOldLogs,
  getRecentEntries,
  getMultiDaySummary,
  createLogEntryFromCycle,
} from './lizard-brain-logger.js';

// Service Manager (lifecycle control)
export {
  startActiveOperatorService,
  stopActiveOperatorService,
  toggleActiveOperatorService,
  getActiveOperatorServiceStatus,
  enqueueUserMessage,
} from './service-manager.js';

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
  markProposalExecuted,
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
