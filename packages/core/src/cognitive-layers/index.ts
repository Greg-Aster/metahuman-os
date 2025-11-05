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

// Layer 2: Personality Core (to be implemented in Phase 2)
// export { PersonalityCoreLayer } from './layers/personality-core-layer.js';

// Layer 3: Meta-Cognition (to be implemented in Phase 3)
// export { MetaCognitionLayer } from './layers/meta-cognition-layer.js';
