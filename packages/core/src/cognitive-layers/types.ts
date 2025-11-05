/**
 * Cognitive Layers - Type Definitions
 *
 * Defines the standard interfaces for the extensible multi-layer cognitive architecture.
 * All layers must implement the CognitiveLayer interface for composability.
 *
 * @module cognitive-layers/types
 */

import type { CognitiveModeId } from '../cognitive-mode.js';

// ============================================================================
// Core Layer Interfaces
// ============================================================================

/**
 * Universal layer interface for cognitive processing
 *
 * All cognitive layers implement this interface to enable:
 * - Composability (layers can be chained)
 * - Observability (track per-layer metrics)
 * - Configurability (enable/disable layers per mode)
 *
 * @template TInput - Input type for this layer
 * @template TOutput - Output type for this layer
 *
 * @example
 * ```typescript
 * class MyLayer implements CognitiveLayer<string, ProcessedString> {
 *   name = 'my-layer';
 *   version = '1.0.0';
 *   enabled = true;
 *
 *   async process(input: string, context: LayerContext): Promise<ProcessedString> {
 *     // Process input
 *     return { processed: input.toUpperCase() };
 *   }
 * }
 * ```
 */
export interface CognitiveLayer<TInput = any, TOutput = any> {
  /** Unique layer name (e.g., 'subconscious', 'personality-core') */
  name: string;

  /** Layer version for tracking changes */
  version: string;

  /** Whether this layer is enabled (can be toggled per mode) */
  enabled: boolean;

  /**
   * Process input through this layer
   *
   * @param input - Input data from previous layer (or user input for first layer)
   * @param context - Shared context passed to all layers
   * @returns Processed output to pass to next layer
   */
  process(input: TInput, context: LayerContext): Promise<TOutput>;

  /**
   * Optional: Validate input before processing
   *
   * @param input - Input to validate
   * @returns Validation result with any errors
   */
  validate?(input: TInput): ValidationResult;

  /**
   * Optional: Finalize/cleanup after processing
   *
   * Useful for:
   * - Saving results to disk
   * - Updating caches
   * - Triggering side effects
   *
   * @param output - Output from process()
   */
  finalize?(output: TOutput): Promise<void>;
}

// ============================================================================
// Context and Results
// ============================================================================

/**
 * Context passed to all layers during pipeline execution
 *
 * Contains:
 * - Cognitive mode (dual/agent/emulation)
 * - User and session IDs
 * - Results from previous layers
 * - Arbitrary metadata
 */
export interface LayerContext {
  /** Current cognitive mode */
  cognitiveMode: CognitiveModeId;

  /** User ID (for multi-user support) */
  userId?: string;

  /** Session ID for tracking conversation */
  sessionId?: string;

  /** Results from layers that have already executed */
  previousLayers: LayerResult[];

  /** Arbitrary metadata (can be used for layer communication) */
  metadata: Record<string, any>;
}

/**
 * Result from a single layer execution
 *
 * Captured for:
 * - Observability (per-layer timing)
 * - Debugging (see what each layer produced)
 * - Audit logging (track layer execution)
 */
export interface LayerResult {
  /** Name of layer that produced this result */
  layerName: string;

  /** Whether layer execution succeeded */
  success: boolean;

  /** Output from layer (null if failed) */
  output: any;

  /** Time taken to execute layer (milliseconds) */
  processingTime: number;

  /** Additional metadata from layer execution */
  metadata: Record<string, any>;
}

/**
 * Result from full pipeline execution
 *
 * Contains:
 * - Final output (from last layer)
 * - Results from all layers
 * - Total execution time
 */
export interface PipelineResult<TOutput = any> {
  /** Final output from last layer in pipeline */
  output: TOutput;

  /** Results from all executed layers */
  layers: LayerResult[];

  /** Total time across all layers (milliseconds) */
  totalTime: number;

  /** Cognitive mode that was used */
  cognitiveMode: CognitiveModeId;

  /** Timestamp when pipeline started */
  timestamp: string;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Result from layer input validation
 */
export interface ValidationResult {
  /** Whether input is valid */
  valid: boolean;

  /** Validation errors (if any) */
  errors?: string[];

  /** Validation warnings (non-fatal) */
  warnings?: string[];
}

// ============================================================================
// Layer Configuration
// ============================================================================

/**
 * Configuration for a single layer
 *
 * Loaded from etc/cognitive-layers.json
 */
export interface LayerConfig {
  /** Layer name (must match layer.name) */
  name: string;

  /** Whether this layer is enabled for this mode */
  enabled: boolean;

  /** Layer-specific configuration options */
  config?: Record<string, any>;
}

/**
 * Configuration for all layers in a cognitive mode
 *
 * Defines which layers run and how they're configured
 */
export interface ModeLayerConfig {
  /** List of layer configurations */
  layers: LayerConfig[];

  /** Description of what this mode does */
  description?: string;
}

/**
 * Complete layer configuration (all modes)
 *
 * Root object from etc/cognitive-layers.json
 */
export interface LayerConfigFile {
  /** Configuration for dual consciousness mode */
  dual: ModeLayerConfig;

  /** Configuration for agent mode */
  agent: ModeLayerConfig;

  /** Configuration for emulation mode */
  emulation: ModeLayerConfig;
}

// ============================================================================
// Layer-Specific Types (for common patterns)
// ============================================================================

/**
 * Input/output types for specific layers
 * These are convenience types - layers can use custom types
 */

/** Input to Subconscious Layer (Layer 1) */
export interface SubconsciousInput {
  userMessage: string;
  sessionId?: string;
}

/** Output from Subconscious Layer */
export interface SubconsciousOutput {
  contextPackage: any;  // ContextPackage from context-builder
  patterns: any[];
  retrievalTime: number;
}

/** Input to Personality Core Layer (Layer 2) */
export interface PersonalityInput {
  userMessage: string;
  contextPackage: any;  // From Layer 1
  operatorResult?: any; // Optional: from operator pipeline
}

/** Output from Personality Core Layer */
export interface PersonalityOutput {
  response: string;
  metadata: {
    modelUsed: string;
    loraAdapter?: string;
    tokensGenerated: number;
    voiceConsistency: number;  // 0-1 score
  };
}

/** Input to Meta-Cognition Layer (Layer 3) */
export interface MetaCognitionInput {
  response: string;
  contextPackage: any;  // From Layer 1
  metadata: PersonalityOutput['metadata'];
}

/** Output from Meta-Cognition Layer */
export interface MetaCognitionOutput {
  finalResponse: string;
  validation: {
    valueAlignment: boolean;
    consistencyCheck: boolean;
    safetyFilters: boolean;
    refined: boolean;
  };
  edits: string[];  // List of changes made
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when layer execution fails
 */
export class LayerExecutionError extends Error {
  constructor(
    public layerName: string,
    public originalError: Error,
    message?: string
  ) {
    super(message || `Layer '${layerName}' failed: ${originalError.message}`);
    this.name = 'LayerExecutionError';
  }
}

/**
 * Error thrown when layer validation fails
 */
export class LayerValidationError extends Error {
  constructor(
    public layerName: string,
    public validationErrors: string[],
    message?: string
  ) {
    super(message || `Layer '${layerName}' validation failed: ${validationErrors.join(', ')}`);
    this.name = 'LayerValidationError';
  }
}

/**
 * Error thrown when pipeline configuration is invalid
 */
export class PipelineConfigError extends Error {
  constructor(
    public configIssues: string[],
    message?: string
  ) {
    super(message || `Pipeline configuration invalid: ${configIssues.join(', ')}`);
    this.name = 'PipelineConfigError';
  }
}
