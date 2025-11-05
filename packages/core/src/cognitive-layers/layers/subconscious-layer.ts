/**
 * Subconscious Layer (Layer 1)
 *
 * Background memory and context preparation
 * Wraps the existing context-builder.ts for use in the cognitive pipeline
 *
 * @module cognitive-layers/layers/subconscious-layer
 */

import { buildContextPackage, type ContextPackage, type ContextBuilderOptions } from '../../context-builder.js';
import type { CognitiveLayer, LayerContext, ValidationResult, SubconsciousInput, SubconsciousOutput } from '../types.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';

// ============================================================================
// Subconscious Layer
// ============================================================================

/**
 * Layer 1: Subconscious Processing
 *
 * Responsibilities:
 * - Memory retrieval (semantic search via vector index)
 * - Context filtering and relevance scoring
 * - Pattern recognition across episodic memories
 * - Short-term state management (current focus, active tasks)
 * - Context package caching (5min TTL)
 *
 * Input: User message (string)
 * Output: ContextPackage (memories, persona, state, patterns)
 */
export class SubconsciousLayer implements CognitiveLayer<SubconsciousInput, SubconsciousOutput> {
  name = 'subconscious';
  version = '1.0.0';
  enabled = true;

  async process(
    input: SubconsciousInput,
    context: LayerContext
  ): Promise<SubconsciousOutput> {
    const { userMessage } = input;
    const mode = context.cognitiveMode;

    // Get mode-specific options
    const options = this.getOptionsForMode(mode, context);

    // Build context package (uses existing implementation)
    const contextPackage = await buildContextPackage(
      userMessage,
      mode,
      options
    );

    return {
      contextPackage,
      patterns: contextPackage.patterns || [],
      retrievalTime: contextPackage.retrievalTime || 0
    };
  }

  /**
   * Validate input before processing
   */
  validate(input: SubconsciousInput): ValidationResult {
    const errors: string[] = [];

    if (!input.userMessage || typeof input.userMessage !== 'string') {
      errors.push('userMessage must be a non-empty string');
    }

    if (input.userMessage && input.userMessage.length > 10000) {
      errors.push('userMessage exceeds maximum length (10000 characters)');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Get context builder options for specific cognitive mode
   *
   * Each mode uses different search depths and filtering:
   * - Dual: Deep search (16 results), full patterns, all state
   * - Agent: Normal search (8 results), no patterns, active tasks only
   * - Emulation: Shallow search (4 results), read-only, no patterns
   */
  private getOptionsForMode(
    mode: CognitiveModeId,
    context: LayerContext
  ): ContextBuilderOptions {
    // Allow custom config from context metadata
    const customConfig = context.metadata?.subconsciousConfig as Partial<ContextBuilderOptions> | undefined;

    // Base config per mode
    const baseConfig = this.getBaseConfigForMode(mode);

    // Merge custom config over base
    return {
      ...baseConfig,
      ...customConfig
    };
  }

  /**
   * Get base configuration for each mode
   */
  private getBaseConfigForMode(mode: CognitiveModeId): ContextBuilderOptions {
    switch (mode) {
      case 'dual':
        // Full cognitive depth for dual consciousness
        return {
          searchDepth: 'deep',              // 16 results
          similarityThreshold: 0.62,
          maxMemories: 8,                   // More memories for operator
          maxContextChars: 1500,            // More context allowed
          filterInnerDialogue: true,
          filterReflections: true,
          includeShortTermState: true,      // Full state integration
          includePersonaCache: true,
          includeTaskContext: false,        // Detect from message
          detectPatterns: true,             // Pattern recognition enabled
          forceSemanticSearch: true,        // Require semantic index
          usingLoRA: false                  // Will be determined by personality layer
        };

      case 'agent':
        // Lightweight assistant mode
        return {
          searchDepth: 'normal',            // 8 results
          similarityThreshold: 0.62,
          maxMemories: 2,                   // Standard limit
          maxContextChars: 900,             // Standard context
          filterInnerDialogue: true,
          filterReflections: true,
          includeShortTermState: true,      // Active tasks only
          includePersonaCache: true,
          includeTaskContext: false,        // Detect from message
          detectPatterns: false,            // Skip pattern analysis
          forceSemanticSearch: false,       // Allow fallback
          usingLoRA: false
        };

      case 'emulation':
        // Read-only, frozen personality snapshot
        return {
          searchDepth: 'shallow',           // 4 results
          similarityThreshold: 0.62,
          maxMemories: 2,                   // Minimal context
          maxContextChars: 600,             // Reduced context
          filterInnerDialogue: true,
          filterReflections: true,
          includeShortTermState: false,     // No state updates (read-only)
          includePersonaCache: true,
          includeTaskContext: false,
          detectPatterns: false,            // Skip analysis
          forceSemanticSearch: false,       // Allow fallback
          usingLoRA: true                   // Will use LoRA snapshot
        };
    }
  }
}
