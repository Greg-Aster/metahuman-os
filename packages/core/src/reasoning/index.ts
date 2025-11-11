/**
 * Reasoning Service - Public API
 *
 * Unified reasoning engine for MetaHuman OS.
 * Provides structured ReAct loop with tool catalog integration,
 * error recovery, and multiple observation modes.
 *
 * ## Usage
 *
 * ```typescript
 * import { ReasoningEngine } from '@metahuman/core/reasoning';
 *
 * const engine = new ReasoningEngine({
 *   depth: 'focused',
 *   sessionId: 'session-123',
 *   enableFastPath: true,
 * });
 *
 * const result = await engine.run(
 *   'List my tasks',
 *   { memories: [], conversationHistory: [] },
 *   (event) => console.log(event)
 * );
 *
 * console.log(result.result); // Final response
 * console.log(result.scratchpad); // Full reasoning trace
 * ```
 *
 * ## Modules
 *
 * - `engine.ts` - Main ReasoningEngine class
 * - `planner.ts` - LLM-based planning with JSON validation
 * - `observers.ts` - Observation formatting (3 modes)
 * - `scratchpad.ts` - Scratchpad management
 * - `errors.ts` - Error analysis with recovery suggestions
 * - `validators.ts` - Failure loop detection
 * - `telemetry.ts` - Event emission (SSE + audit)
 * - `config.ts` - Configuration management
 * - `types.ts` - TypeScript interfaces
 */

// Main engine
export { ReasoningEngine } from './engine';

// Configuration
export { getDefaultConfig, getMaxStepsForDepth, validateConfig } from './config';

// Scratchpad
export {
  formatScratchpadForLLM,
  getObservations,
  getLastSuccessfulObservation,
  countErrors,
  getUsedTools,
} from './scratchpad';

// Planning
export { planNextStepV2, extractJsonBlock, validatePlanning } from './planner';

// Observation formatting
export {
  formatObservationV2,
  detectDataRetrievalIntent,
  checkVerbatimShortCircuit,
} from './observers';

// Error handling
export {
  analyzeError,
  formatErrorWithSuggestions,
  isRetryable,
  isTerminal,
} from './errors';

// Validation
export { detectFailureLoop, hasProgress, shouldStopEarly } from './validators';

// Telemetry
export {
  emitReasoningEvent,
  formatSSE,
  createReasoningLogger,
  logLoopStarted,
  logLoopCompleted,
  logLoopFailed,
  logVerbatimShortCircuit,
  logFailureLoopDetected,
} from './telemetry';

// Types
export type {
  ReasoningEngineConfig,
  ReasoningResult,
  ReasoningContext,
  ReasoningEvent,
  ReasoningDepth,
  ObservationMode,
  ScratchpadEntry,
  PlanningResponse,
  ReactState,
  ErrorAnalysis,
  FailureTracker,
  ObservationResult,
  SkillExecutionResult,
} from './types';
