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

// Re-export common functions at top level for convenience
export {
  loadConfig,
  loadSystemConfig,
  isAgencyEnabled,
  getSourceWeight,
  isSourceEnabled,
  canAutoApprove,
  isRiskBlocked,
  DEFAULT_AGENCY_CONFIG,
} from './config.js';

export {
  saveDesire,
  loadDesire,
  deleteDesire,
  moveDesire,
  listActiveDesires,
  listPendingDesires,
  listNascentDesires,
  listDesiresByStatus,
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
} from './storage.js';

// Convenience namespace
import * as storage from './storage.js';
import * as config from './config.js';

export const agency = {
  storage,
  config,
  isEnabled: config.isAgencyEnabled,
};
