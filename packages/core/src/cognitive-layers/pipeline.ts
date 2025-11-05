/**
 * Cognitive Pipeline - Layer Execution Engine
 *
 * Chains multiple cognitive layers together and executes them in sequence.
 * Handles error recovery, audit logging, and per-layer metrics.
 *
 * @module cognitive-layers/pipeline
 */

import { audit } from '../audit.js';
import type { CognitiveModeId } from '../cognitive-mode.js';
import type {
  CognitiveLayer,
  LayerContext,
  LayerResult,
  PipelineResult,
  LayerExecutionError,
  LayerValidationError
} from './types.js';

// ============================================================================
// Pipeline Configuration
// ============================================================================

export interface PipelineOptions {
  /** Whether to stop on first layer failure (default: true) */
  failFast?: boolean;

  /** Maximum time for entire pipeline (ms, default: 60000 = 1min) */
  timeout?: number;

  /** Enable detailed audit logging for each layer */
  auditLayers?: boolean;
}

// ============================================================================
// Cognitive Pipeline Class
// ============================================================================

/**
 * Pipeline that chains multiple cognitive layers together
 *
 * Usage:
 * ```typescript
 * const pipeline = new CognitivePipeline();
 * pipeline.addLayer(new SubconsciousLayer());
 * pipeline.addLayer(new PersonalityCoreLayer());
 * pipeline.addLayer(new MetaCognitionLayer());
 *
 * const result = await pipeline.execute(userMessage, 'dual');
 * console.log(result.output); // Final response
 * console.log(result.layers); // Per-layer metrics
 * ```
 */
export class CognitivePipeline {
  private layers: CognitiveLayer<any, any>[] = [];
  private options: Required<PipelineOptions>;

  constructor(options: PipelineOptions = {}) {
    this.options = {
      failFast: options.failFast ?? true,
      timeout: options.timeout ?? 60000,
      auditLayers: options.auditLayers ?? true
    };
  }

  /**
   * Add a layer to the pipeline
   *
   * Layers are executed in the order they are added:
   * Layer 1 → Layer 2 → Layer 3 → ...
   *
   * @param layer - Layer to add
   */
  addLayer(layer: CognitiveLayer<any, any>): void {
    this.layers.push(layer);
  }

  /**
   * Get all layers in pipeline
   */
  getLayers(): CognitiveLayer<any, any>[] {
    return [...this.layers];
  }

  /**
   * Get enabled layers for current context
   */
  private getEnabledLayers(): CognitiveLayer<any, any>[] {
    return this.layers.filter(layer => layer.enabled);
  }

  /**
   * Execute the pipeline
   *
   * Runs all enabled layers in sequence, passing output from one to the next.
   *
   * @param input - Initial input (typically user message)
   * @param cognitiveMode - Current cognitive mode
   * @param contextOverrides - Optional context overrides
   * @returns Pipeline result with final output and per-layer metrics
   */
  async execute<TInput = any, TOutput = any>(
    input: TInput,
    cognitiveMode: CognitiveModeId,
    contextOverrides: Partial<LayerContext> = {}
  ): Promise<PipelineResult<TOutput>> {
    const pipelineStartTime = Date.now();
    const timestamp = new Date().toISOString();

    // Build layer context
    const context: LayerContext = {
      cognitiveMode,
      userId: contextOverrides.userId,
      sessionId: contextOverrides.sessionId,
      previousLayers: [],
      metadata: contextOverrides.metadata || {}
    };

    const enabledLayers = this.getEnabledLayers();
    const results: LayerResult[] = [];
    let currentOutput: any = input;

    // Audit pipeline start
    if (this.options.auditLayers) {
      audit({
        level: 'info',
        category: 'action',
        event: 'cognitive_pipeline_start',
        details: {
          cognitiveMode,
          layerCount: enabledLayers.length,
          layers: enabledLayers.map(l => l.name),
          timestamp
        },
        actor: 'cognitive_pipeline'
      });
    }

    // Execute each layer
    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const layerStartTime = Date.now();

      try {
        // Validate input if layer supports it
        if (layer.validate) {
          const validation = layer.validate(currentOutput);
          if (!validation.valid) {
            const validationError = new Error(
              `Layer validation failed: ${validation.errors?.join(', ')}`
            ) as LayerValidationError;
            validationError.name = 'LayerValidationError';
            throw validationError;
          }

          // Log warnings if any
          if (validation.warnings && validation.warnings.length > 0 && this.options.auditLayers) {
            audit({
              level: 'warn',
              category: 'action',
              event: 'cognitive_layer_validation_warnings',
              details: {
                layerName: layer.name,
                warnings: validation.warnings
              },
              actor: 'cognitive_pipeline'
            });
          }
        }

        // Process through layer
        currentOutput = await layer.process(currentOutput, context);

        const processingTime = Date.now() - layerStartTime;

        // Record successful result
        const result: LayerResult = {
          layerName: layer.name,
          success: true,
          output: currentOutput,
          processingTime,
          metadata: {}
        };

        results.push(result);
        context.previousLayers.push(result);

        // Audit layer success
        if (this.options.auditLayers) {
          audit({
            level: 'info',
            category: 'action',
            event: 'cognitive_layer_executed',
            details: {
              layerName: layer.name,
              layerVersion: layer.version,
              processingTime,
              cognitiveMode,
              success: true
            },
            actor: 'cognitive_pipeline'
          });
        }

        // Finalize if layer supports it
        if (layer.finalize) {
          try {
            await layer.finalize(currentOutput);
          } catch (finalizeError) {
            // Finalization errors are non-fatal, just log them
            console.error(`[cognitive-pipeline] Finalize error in ${layer.name}:`, finalizeError);
            if (this.options.auditLayers) {
              audit({
                level: 'warn',
                category: 'action',
                event: 'cognitive_layer_finalize_error',
                details: {
                  layerName: layer.name,
                  error: String(finalizeError)
                },
                actor: 'cognitive_pipeline'
              });
            }
          }
        }

      } catch (error) {
        const processingTime = Date.now() - layerStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Record failed result
        const result: LayerResult = {
          layerName: layer.name,
          success: false,
          output: null,
          processingTime,
          metadata: { error: errorMessage }
        };

        results.push(result);

        // Audit layer failure
        if (this.options.auditLayers) {
          audit({
            level: 'error',
            category: 'action',
            event: 'cognitive_layer_failed',
            details: {
              layerName: layer.name,
              layerVersion: layer.version,
              processingTime,
              cognitiveMode,
              error: errorMessage,
              success: false
            },
            actor: 'cognitive_pipeline'
          });
        }

        // Decide whether to fail fast or continue
        if (this.options.failFast) {
          const layerError = new Error(
            `Pipeline failed at layer '${layer.name}': ${errorMessage}`
          ) as LayerExecutionError;
          layerError.name = 'LayerExecutionError';
          throw layerError;
        } else {
          // Continue with null output (next layer must handle it)
          currentOutput = null;
        }
      }
    }

    const totalTime = Date.now() - pipelineStartTime;

    // Audit pipeline completion
    if (this.options.auditLayers) {
      audit({
        level: 'info',
        category: 'action',
        event: 'cognitive_pipeline_complete',
        details: {
          cognitiveMode,
          layersExecuted: results.length,
          layersSucceeded: results.filter(r => r.success).length,
          layersFailed: results.filter(r => !r.success).length,
          totalTime,
          timestamp
        },
        actor: 'cognitive_pipeline'
      });
    }

    return {
      output: currentOutput as TOutput,
      layers: results,
      totalTime,
      cognitiveMode,
      timestamp
    };
  }

  /**
   * Execute pipeline with timeout
   *
   * Wraps execute() with a timeout to prevent hanging
   */
  async executeWithTimeout<TInput = any, TOutput = any>(
    input: TInput,
    cognitiveMode: CognitiveModeId,
    contextOverrides: Partial<LayerContext> = {}
  ): Promise<PipelineResult<TOutput>> {
    return Promise.race([
      this.execute<TInput, TOutput>(input, cognitiveMode, contextOverrides),
      this.createTimeout<TOutput>()
    ]);
  }

  /**
   * Create a timeout promise
   */
  private async createTimeout<TOutput>(): Promise<PipelineResult<TOutput>> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Pipeline timeout after ${this.options.timeout}ms`));
      }, this.options.timeout);
    });
  }

  /**
   * Clear all layers from pipeline
   */
  clear(): void {
    this.layers = [];
  }

  /**
   * Get pipeline summary (for debugging)
   */
  getSummary(): {
    layerCount: number;
    enabledLayers: string[];
    disabledLayers: string[];
    options: PipelineOptions;
  } {
    const enabled = this.layers.filter(l => l.enabled);
    const disabled = this.layers.filter(l => !l.enabled);

    return {
      layerCount: this.layers.length,
      enabledLayers: enabled.map(l => `${l.name} (v${l.version})`),
      disabledLayers: disabled.map(l => `${l.name} (v${l.version})`),
      options: this.options
    };
  }
}

// ============================================================================
// Helper: Build Pipeline from Configuration
// ============================================================================

/**
 * Build a pipeline from layer configuration
 *
 * This is a placeholder - actual implementation will load from etc/cognitive-layers.json
 *
 * @param cognitiveMode - Mode to build pipeline for
 * @param layers - Array of layer instances
 * @param options - Pipeline options
 * @returns Configured pipeline
 */
export function buildPipelineFromLayers(
  layers: CognitiveLayer<any, any>[],
  options: PipelineOptions = {}
): CognitivePipeline {
  const pipeline = new CognitivePipeline(options);

  for (const layer of layers) {
    pipeline.addLayer(layer);
  }

  return pipeline;
}
