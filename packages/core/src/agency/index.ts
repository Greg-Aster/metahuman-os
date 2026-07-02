/**
 * Agency System
 *
 * Synthesizes outputs from services (curiosity, dreams, episodic memory,
 * tasks, persona) into desires - autonomous intentions that the system
 * can plan, review, and execute within trust boundaries.
 *
 * @example
 * ```typescript
 * import { agency } from '@metahuman/core';
 *
 * // Check if agency is enabled
 * const enabled = await agency.isEnabled('greggles');
 *
 * // Load all active desires
 * const desires = await agency.storage.listActiveDesires('greggles');
 *
 * // Get configuration
 * const config = await agency.config.loadConfig('greggles');
 * ```
 */

// Types
export * from './types.js';

// Storage
export * as agencyStorage from './storage.js';

// Config
export * as agencyConfig from './config.js';

// Question generation service
export * from './desire-questions.js';

// Executor (graph-based execution) - exclude clearGraphCache (conflicts with graph-streaming)
export {
  type DesireExecutionProgress,
  type DesireProgressCallback,
  loadDesireExecutorGraph,
  loadOutcomeReviewerGraph,
  type ExecuteDesireResult,
  executeDesireViaGraph,
  type ReviewOutcomeResult,
  reviewOutcomeViaGraph,
} from './executor.js';

// Re-export common functions at top level for convenience
export {
  loadConfig,
  loadSystemConfig,
  isAgencyEnabled,
  getSourceWeight,
  isSourceEnabled,
  getEnabledSources,
  canAutoApprove,
  calculateEffectiveTrustLevel,
  isRiskBlocked,
  DEFAULT_AGENCY_CONFIG,
} from './config.js';

export type { TrustDegradationConfig } from './config.js';

export {
  // Original status-based storage
  saveDesire,
  loadDesire,
  deleteDesire,
  moveDesire,
  listActiveDesires,
  listPendingDesires,
  listNascentDesires,
  listDesiresByStatus,
  listDesiresPendingApproval,
  listAllDesires,
  savePlan,
  loadPlan,
  saveReview,
  loadReview,
  loadMetrics,
  saveMetrics,
  initializeMetrics,
  incrementMetric,
  initializeAgencyStorage,
  saveAgencyConfig,
  // New folder-based storage
  getDesireFolderPath,
  createDesireFolder,
  saveDesireManifest,
  loadDesireFromFolder,
  addScratchpadEntryToFolder,
  listScratchpadEntries,
  loadScratchpadEntry,
  loadScratchpadEntriesPaginated,
  savePlanToFolder,
  listPlanVersions,
  loadPlanFromFolder,
  saveOutcomeReviewToFolder,
  saveExecutionToFolder,
  loadExecutionAttempts,
  loadExecutionAttempt,
  getDesireFolderSize,
  listDesireFolders,
  listDesiresFromFolders,
  // Long-running goal functions
  updateDesireMilestones,
  advanceDesireMilestone,
  listLongRunningDesiresNeedingCheckin,
  recordDesireCheckin,
} from './storage.js';

// Convenience namespace
import * as storage from './storage.js';
import * as config from './config.js';

export const agency = {
  storage,
  config,
  isEnabled: config.isAgencyEnabled,
};
