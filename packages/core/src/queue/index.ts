/**
 * Unified Queue System
 *
 * A unified intelligent queue that manages all LLM and agent tasks
 * with resource-aware scheduling and parallel lane execution.
 *
 * Features:
 * - Resource lanes (local-llm, vector-index, remote-llm)
 * - Sequential execution for GPU-bound tasks
 * - Parallel execution for non-competing resources
 * - Non-blocking remote dispatch with callbacks
 * - Chain execution (remote results can trigger follow-up tasks)
 * - Activity-based queue pausing
 *
 * @module queue
 */

// Types
export * from './types.js';

// Core components
export { UnifiedQueueManager, getQueueManager, resetQueueManager } from './unified-queue-manager.js';
export { ExecutionEngine } from './execution-engine.js';
export { TriggerManager } from './trigger-manager.js';
export type { TriggerType, AgentTriggerConfig, TriggerManagerConfig } from './trigger-manager.js';
export { RemoteDispatcher } from './remote-dispatcher.js';

// Facade
export { QueueSystem, getQueueSystem, resetQueueSystem } from './queue-system.js';

// Persistence
export {
  loadQueueState,
  clearQueueState,
  persistQueueState,
  saveCurrentTask,
  loadCurrentTask,
  clearCurrentTask,
  shouldRestoreState,
  getQueueStateDir,
} from './queue-persister.js';

// Metrics
export {
  type HourlyMetrics,
  type LaneMetrics,
  type QueueMetrics,
  loadMetrics as loadLaneMetrics,
  clearMetrics as clearLaneMetrics,
  recordTaskComplete,
  recordTaskFailed,
  recordTaskFromTask,
  getAllLaneMetrics,
  getLaneMetrics,
  getThroughputHistory,
  getLastHourSummary,
  getLastHourAvgDuration,
} from './lane-metrics.js';
