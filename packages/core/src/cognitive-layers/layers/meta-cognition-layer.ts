/**
 * Meta-Cognition Layer (Layer 3)
 *
 * Validates and refines responses from PersonalityCoreLayer.
 * Ensures responses align with values, are consistent with persona,
 * and meet safety requirements.
 *
 * @module cognitive-layers/layers/meta-cognition-layer
 */

import type {
  CognitiveLayer,
  LayerContext,
  ValidationResult,
  MetaCognitionInput,
  MetaCognitionOutput
} from '../types.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';
import {
  checkValueAlignment,
  quickAlignmentCheck,
  type ValueAlignmentResult
} from '../validators/value-alignment.js';
import {
  checkConsistency,
  quickConsistencyCheck,
  type ConsistencyResult
} from '../validators/consistency.js';
import {
  checkSafety,
  quickSafetyCheck,
  type SafetyResult
} from '../validators/safety.js';
import {
  refineResponse,
  quickRefine,
  type RefinementResult
} from '../utils/refiner.js';
import { audit } from '../../audit.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Layer configuration from cognitive-layers.json
 */
export interface MetaCognitionConfig {
  /** Validation level */
  validationLevel?: 'full' | 'safety-only' | 'quick' | 'none';

  /** Whether to refine responses that fail validation */
  refineResponses?: boolean;

  /** Whether to allow unsafe responses (emergency override) */
  allowUnsafe?: boolean;

  /** Alignment threshold (0-1) */
  alignmentThreshold?: number;

  /** Consistency threshold (0-1) */
  consistencyThreshold?: number;

  /** Safety threshold (0-1) */
  safetyThreshold?: number;
}

// ============================================================================
// MetaCognitionLayer Implementation
// ============================================================================

export class MetaCognitionLayer implements CognitiveLayer<MetaCognitionInput, MetaCognitionOutput> {
  name = 'meta-cognition';
  version = '1.0.0';
  enabled = true;

  /**
   * Process input through meta-cognition
   *
   * Validates response from Layer 2 and optionally refines it:
   * 1. Safety check (always performed)
   * 2. Value alignment check (mode-dependent)
   * 3. Consistency check (mode-dependent)
   * 4. Refinement (if issues found and enabled)
   */
  async process(
    input: MetaCognitionInput,
    context: LayerContext
  ): Promise<MetaCognitionOutput> {
    const startTime = Date.now();

    // Get layer configuration
    const config = this.getConfigForMode(context.cognitiveMode, context);

    // Extract response and context
    const { response, contextPackage } = input;

    // Determine validation level
    const level = config.validationLevel || 'full';

    let valueAlignment: ValueAlignmentResult | undefined;
    let consistency: ConsistencyResult | undefined;
    let safety: SafetyResult | undefined;
    let refinement: RefinementResult | undefined;

    // Perform validations based on level
    if (level === 'full') {
      // Full validation: all checks
      [safety, valueAlignment, consistency] = await Promise.all([
        checkSafety(response, {
          threshold: config.safetyThreshold || 0.9,
          sanitize: true
        }),
        checkValueAlignment(response, {
          threshold: config.alignmentThreshold || 0.7,
          includeSuggestions: true,
          cognitiveMode: context.cognitiveMode
        }),
        checkConsistency(response, contextPackage, {
          threshold: config.consistencyThreshold || 0.7,
          cognitiveMode: context.cognitiveMode
        })
      ]);
    } else if (level === 'safety-only') {
      // Safety only
      safety = await checkSafety(response, {
        threshold: config.safetyThreshold || 0.9,
        sanitize: true
      });
    } else if (level === 'quick') {
      // Quick checks (fast, minimal LLM calls)
      const [safeResult, alignedResult, consistentResult] = await Promise.all([
        quickSafetyCheck(response),
        quickAlignmentCheck(response),
        quickConsistencyCheck(response)
      ]);

      // Build minimal results
      safety = {
        safe: safeResult,
        score: safeResult ? 1.0 : 0.5,
        issues: safeResult ? [] : [{ type: 'harmful_content', description: 'Quick check failed', severity: 'medium' }],
        processingTime: 0
      };

      valueAlignment = {
        aligned: alignedResult,
        score: alignedResult ? 1.0 : 0.5,
        issues: [],
        valuesChecked: [],
        processingTime: 0
      };

      consistency = {
        consistent: consistentResult,
        score: consistentResult ? 1.0 : 0.5,
        issues: [],
        aspectsChecked: [],
        processingTime: 0
      };
    } else if (level === 'none') {
      // No validation - pass through
      return {
        validated: true,
        response,
        originalResponse: response,
        safety: { safe: true, score: 1.0, issues: [], processingTime: 0 },
        passedValidation: true
      };
    }

    // Determine if response passed validation
    const passedSafety = !safety || safety.safe || config.allowUnsafe;
    const passedAlignment = !valueAlignment || valueAlignment.aligned;
    const passedConsistency = !consistency || consistency.consistent;

    const passedValidation = passedSafety && passedAlignment && passedConsistency;

    // Refine if enabled and validation failed
    let finalResponse = response;
    if (!passedValidation && config.refineResponses) {
      refinement = await refineResponse({
        original: response,
        valueIssues: valueAlignment,
        consistencyIssues: consistency,
        safetyIssues: safety,
        cognitiveMode: context.cognitiveMode,
        preserveMeaning: true
      });

      if (refinement.changed) {
        finalResponse = refinement.refined;
      }
    }

    const processingTime = Date.now() - startTime;

    // Audit meta-cognition
    await audit({
      category: 'action',
      level: passedValidation ? 'info' : 'warn',
      action: 'meta_cognition_complete',
      details: {
        cognitiveMode: context.cognitiveMode,
        validationLevel: level,
        passedValidation,
        passedSafety,
        passedAlignment,
        passedConsistency,
        refined: refinement?.changed || false,
        processingTime
      }
    });

    return {
      validated: true,
      response: finalResponse,
      originalResponse: response,
      safety,
      valueAlignment,
      consistency,
      refinement,
      passedValidation
    };
  }

  /**
   * Validate input
   */
  validate(input: MetaCognitionInput): ValidationResult {
    const errors: string[] = [];

    // Require response from Layer 2
    if (!input.response || typeof input.response !== 'string') {
      errors.push('response is required and must be a string');
    }

    // Context package is optional but should be valid if provided
    if (input.contextPackage && !input.contextPackage.userMessage) {
      errors.push('contextPackage must have userMessage if provided');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Finalize - log validation summary
   */
  async finalize(output: MetaCognitionOutput): Promise<void> {
    // Log validation summary
    const summary: string[] = [];

    summary.push('Meta-Cognition Validation Summary:');
    summary.push(`  Overall: ${output.passedValidation ? '✓ PASSED' : '✗ FAILED'}`);

    if (output.safety) {
      summary.push(`  Safety: ${output.safety.safe ? '✓' : '✗'} (${(output.safety.score * 100).toFixed(1)}%)`);
    }

    if (output.valueAlignment) {
      summary.push(`  Alignment: ${output.valueAlignment.aligned ? '✓' : '✗'} (${(output.valueAlignment.score * 100).toFixed(1)}%)`);
    }

    if (output.consistency) {
      summary.push(`  Consistency: ${output.consistency.consistent ? '✓' : '✗'} (${(output.consistency.score * 100).toFixed(1)}%)`);
    }

    if (output.refinement?.changed) {
      summary.push(`  Refined: ✓ (${output.refinement.changes.length} changes)`);
    }

    console.log(summary.join('\n'));
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Get configuration for cognitive mode
   */
  private getConfigForMode(
    mode: CognitiveModeId,
    context: LayerContext
  ): MetaCognitionConfig {
    // Use config from context metadata (loaded by pipeline from cognitive-layers.json)
    const configFromFile = context.metadata?.layerConfig as MetaCognitionConfig | undefined;

    // Default configurations per mode
    const defaults: Record<CognitiveModeId, MetaCognitionConfig> = {
      dual: {
        validationLevel: 'full',
        refineResponses: true,
        allowUnsafe: false,
        alignmentThreshold: 0.7,
        consistencyThreshold: 0.7,
        safetyThreshold: 0.9
      },
      agent: {
        validationLevel: 'safety-only',
        refineResponses: false,
        allowUnsafe: false,
        alignmentThreshold: 0.6,
        consistencyThreshold: 0.6,
        safetyThreshold: 0.8
      },
      emulation: {
        validationLevel: 'none', // Emulation is read-only, no need to validate
        refineResponses: false,
        allowUnsafe: true, // Frozen snapshot is already "safe"
        alignmentThreshold: 0.5,
        consistencyThreshold: 0.5,
        safetyThreshold: 0.7
      }
    };

    // Merge config file with defaults
    return {
      ...defaults[mode],
      ...configFromFile
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get validation summary for debugging
 */
export function getValidationSummary(output: MetaCognitionOutput): string {
  const parts: string[] = [];

  parts.push(`Overall: ${output.passedValidation ? '✓ PASSED' : '✗ FAILED'}`);
  parts.push('');

  if (output.safety) {
    parts.push(`Safety: ${output.safety.safe ? '✓ SAFE' : '✗ UNSAFE'} (${(output.safety.score * 100).toFixed(1)}%)`);
    if (output.safety.issues.length > 0) {
      parts.push(`  Issues: ${output.safety.issues.length}`);
      for (const issue of output.safety.issues.slice(0, 3)) {
        parts.push(`    - [${issue.severity}] ${issue.type}: ${issue.description}`);
      }
    }
  }

  if (output.valueAlignment) {
    parts.push(`Value Alignment: ${output.valueAlignment.aligned ? '✓ ALIGNED' : '✗ MISALIGNED'} (${(output.valueAlignment.score * 100).toFixed(1)}%)`);
    if (output.valueAlignment.issues.length > 0) {
      parts.push(`  Issues: ${output.valueAlignment.issues.length}`);
      for (const issue of output.valueAlignment.issues.slice(0, 3)) {
        parts.push(`    - [${issue.severity}] ${issue.value}: ${issue.description}`);
      }
    }
  }

  if (output.consistency) {
    parts.push(`Consistency: ${output.consistency.consistent ? '✓ CONSISTENT' : '✗ INCONSISTENT'} (${(output.consistency.score * 100).toFixed(1)}%)`);
    if (output.consistency.issues.length > 0) {
      parts.push(`  Issues: ${output.consistency.issues.length}`);
      for (const issue of output.consistency.issues.slice(0, 3)) {
        parts.push(`    - [${issue.severity}] ${issue.aspect}: ${issue.description}`);
      }
    }
  }

  if (output.refinement) {
    parts.push(`Refinement: ${output.refinement.changed ? '✓ REFINED' : '○ NO CHANGES'}`);
    if (output.refinement.changed) {
      for (const change of output.refinement.changes) {
        parts.push(`  - ${change}`);
      }
    }
  }

  return parts.join('\n');
}
