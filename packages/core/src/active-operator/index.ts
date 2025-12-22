/**
 * Active Operator System
 *
 * A proactive, LLM-controlled continuous thinking system that transforms
 * MetaHuman OS from passive response generation into active cognition.
 *
 * Key components:
 * - UnifiedQueue: Priority-based task queue with user message priority
 * - StatePersister: Disk persistence for crash recovery
 * - ModeController: Switch between passive/active modes
 * - DecisionEngine: LLM-based task selection (Phase 2)
 * - TaskExecutor: Execute tasks via existing agents (Phase 3)
 */

// Types
export * from './types.js';

// Queue
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
  parseTscOutput,
  runTypeCheck,
  analyzeError,
  saveProposal,
  loadPendingProposals,
  updateProposalStatus,
  runSelfHealing,
  getErrorCount,
} from './self-healing.js';

// Lizard Brain (autonomous triggers)
export {
  type Trigger,
  type TriggerResult,
  type CircadianWindow,
  CIRCADIAN_WINDOWS,
  TRIGGERS,
  getCurrentCircadianWindow,
  isTaskCircadianAppropriate,
  getCircadianRecommendations,
  evaluateTriggers,
  evaluateTrigger,
  getTriggerStatuses,
} from './lizard-brain.js';

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
