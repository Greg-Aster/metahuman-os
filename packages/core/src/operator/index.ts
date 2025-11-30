/**
 * Shared Operator Module
 *
 * Common utilities for the ReAct operator system used by both:
 * - brain/agents/operator-react.ts (standalone operator)
 * - packages/core/src/node-executors/operator-executors.ts (cognitive graph)
 */

export {
  formatObservation,
  formatObservationV2,
  DEFAULT_OBSERVATION_CONFIG,
  type ObservationConfig,
} from './observation-formatter.js';
