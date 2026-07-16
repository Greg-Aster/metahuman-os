/**
 * Work Coordinator
 *
 * The single MetaHuman OS work coordinator.
 *
 * Features:
 * Resource labels constrain concurrency; one ledger owns ordering, lifecycle,
 * retry, cancellation, persistence, replay, and terminal history.
 *
 * @module queue
 */

// Types
export * from './types.js';

// Core components
export { UnifiedQueueManager, getQueueManager, resetQueueManager } from './unified-queue-manager.js';
export { ExecutionEngine } from './execution-engine.js';
export { TriggerManager } from './trigger-manager.js';
export type {
  TriggerHandlerHealth,
  TriggerManagerLifecycle,
  TriggerManagerSnapshot,
  TriggerState,
  TriggerSuppressionReason,
  TriggerView,
} from './trigger-manager.js';
export {
  TriggerConfigService,
  getTriggerConfigService,
  resetTriggerConfigService,
} from './trigger-config-service.js';
export type {
  TriggerType,
  AgentTriggerConfig,
  TriggerConfigPatch,
  TriggerConfigRead,
  TriggerManagerConfig,
} from './trigger-config-service.js';
export {
  agentHandlerId,
  agentTaskType,
  defaultAgentLifecycle,
  isPersistentService,
} from './agent-work-catalog.js';
export type { AgentLifecycleClass, TriggerStartupPolicy } from './agent-work-catalog.js';
export { RemoteDispatcher } from './remote-dispatcher.js';

// Facade
export { QueueSystem, ensureQueueSystemStarted, getQueueSystem, resetQueueSystem } from './queue-system.js';
export {
  authorizeWorkSubmission,
  claimWorkCoordinatorOwnership,
  isWorkCoordinatorOwner,
  submitCoordinatorWork,
} from './work-submission.js';

// Persistence
export {
  loadQueueState,
  clearQueueState,
  persistQueueState,
  shouldRestoreState,
  getQueueStateDir,
} from './queue-persister.js';
