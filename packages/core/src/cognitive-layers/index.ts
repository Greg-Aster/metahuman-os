/**
 * Cognitive Layers - Main Entry Point
 *
 * Exports all cognitive layer infrastructure:
 * - Type definitions
 * - Pipeline executor
 * - Configuration loader
 * - Layer implementations (Layer 1 currently)
 *
 * @module cognitive-layers
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Core interfaces
  CognitiveLayer,
  LayerContext,
  LayerResult,
  PipelineResult,
  ValidationResult,

  // Configuration types
  LayerConfig,
  ModeLayerConfig,
  LayerConfigFile,

  // Layer-specific types
  SubconsciousInput,
  SubconsciousOutput,
  PersonalityInput,
  PersonalityOutput,
  MetaCognitionInput,
  MetaCognitionOutput
} from './types.js';

export {
  // Error types
  LayerExecutionError,
  LayerValidationError,
  PipelineConfigError
} from './types.js';

// ============================================================================
// Pipeline
// ============================================================================

export {
  CognitivePipeline,
  buildPipelineFromLayers,
  type PipelineOptions
} from './pipeline.js';

// ============================================================================
// Configuration
// ============================================================================

export {
  loadLayerConfigFile,
  loadLayerConfig,
  getLayerConfig,
  isLayerEnabled,
  validateLayerConfigFile,
  clearConfigCache,
  getConfigSummary,
  getConfigPath
} from './config-loader.js';

// ============================================================================
// Layer Implementations
// ============================================================================

// Layer 1: Subconscious
export { SubconsciousLayer } from './layers/subconscious-layer.js';

// Layer 2: Personality Core
export { PersonalityCoreLayer, getLoRASummary } from './layers/personality-core-layer.js';

// Layer 3: Meta-Cognition
export { MetaCognitionLayer, getValidationSummary } from './layers/meta-cognition-layer.js';

// ============================================================================
// Utilities
// ============================================================================

// LoRA utilities
export type { LoRAMetadata, LoRADiscoveryResult } from './utils/lora-utils.js';
export {
  discoverLoRAAdapters,
  findLatestLoRA,
  findLoRAByDate,
  findLoRAByName,
  loadLoRASnapshot,
  validateLoRAAdapter,
  getLoRASummary as getLoRAUtilsSummary
} from './utils/lora-utils.js';

// Prompt builder
export type { BuiltPrompt, PromptBuilderOptions, OperatorResult } from './utils/prompt-builder.js';
export {
  buildPromptFromContext,
  buildBasicPrompt,
  buildOperatorPrompt
} from './utils/prompt-builder.js';

// Response refiner
export type { RefinementResult, RefinementOptions } from './utils/refiner.js';
export {
  refineResponse,
  quickRefine,
  getRefinementSummary,
  compareResponses
} from './utils/refiner.js';

// Safety wrapper (Phase 4.2)
export type { SafetyCheckResult, SafetyWrapperOptions } from './utils/safety-wrapper.js';
export {
  checkResponseSafety,
  quickSafetyValidation,
  batchCheckSafety,
  getSafetyStats,
  formatSafetyStats
} from './utils/safety-wrapper.js';

// Refinement wrapper (Phase 4.3)
export type { RefinementCheckResult, RefinementChange, RefinementWrapperOptions } from './utils/refinement-wrapper.js';
export {
  refineResponseSafely,
  compareRefinementEffectiveness,
  getRefinementSummary as getRefinementWrapperSummary
} from './utils/refinement-wrapper.js';

// ============================================================================
// Validators
// ============================================================================

// Value alignment
export type { ValueAlignmentResult, ValueAlignmentIssue, ValueAlignmentOptions } from './validators/value-alignment.js';
export {
  checkValueAlignment,
  quickAlignmentCheck,
  getAlignmentSummary
} from './validators/value-alignment.js';

// Consistency
export type { ConsistencyResult, ConsistencyIssue, ConsistencyOptions, ConsistencyAspect } from './validators/consistency.js';
export {
  checkConsistency,
  quickConsistencyCheck,
  getConsistencySummary
} from './validators/consistency.js';

// Safety
export type { SafetyResult, SafetyIssue, SafetyOptions, SafetyIssueType } from './validators/safety.js';
export {
  checkSafety,
  quickSafetyCheck,
  getSafetySummary
} from './validators/safety.js';
