/**
 * Operator Module - Modular ReAct Operator System
 *
 * This module serves as the entry point for the operator system.
 * It re-exports all public APIs from the monolithic operator-react.ts file
 * while the codebase transitions to a modular architecture.
 *
 * Migration Status:
 * - [x] Types extracted to ./types.ts
 * - [ ] V1 loop to ./v1-loop.ts (future)
 * - [ ] V2 loop to ./v2-loop.ts (future)
 * - [ ] Step functions to ./step-functions.ts (future)
 *
 * Usage:
 *   import { runOperatorWithFeatureFlag } from '@brain/agents/operator';
 *   // or
 *   import { runOperatorWithFeatureFlag } from '../brain/agents/operator/index.js';
 */

// Re-export types from local types.ts
export type {
  OperatorTask,
  ReActStep,
  ReActContext,
  ReActConfig,
  ScratchpadEntry,
  PlanningResponse,
  ReactState,
  OperatorProgressEvent,
  ProgressCallback,
  OperatorContext,
  UserContext,
  OperatorResult,
} from './types.js';

export { DEFAULT_REACT_CONFIG } from './types.js';

// Re-export implementations from monolithic file (for backward compatibility)
// These will be migrated to modular files incrementally
export {
  runOperatorWithFeatureFlag,
  runReActLoop,
  runTask,
} from '../operator-react.js';
