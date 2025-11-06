/**
 * Personality Core Layer (Layer 2)
 *
 * Generates responses using persona-tuned language models with optional LoRA adapters.
 * Maintains voice consistency and integrates operator results.
 *
 * @module cognitive-layers/layers/personality-core-layer
 */

import type {
  CognitiveLayer,
  LayerContext,
  ValidationResult,
  PersonalityInput,
  PersonalityOutput
} from '../types.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';
import {
  buildPromptFromContext,
  buildBasicPrompt,
  buildOperatorPrompt,
  type PromptBuilderOptions,
  type OperatorResult
} from '../utils/prompt-builder.js';
import {
  discoverLoRAAdapters,
  findLatestLoRA,
  loadLoRASnapshot,
  validateLoRAAdapter,
  type LoRAMetadata
} from '../utils/lora-utils.js';
import { callLLM } from '../../model-router.js';
import { audit } from '../../audit.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Layer configuration from cognitive-layers.json
 */
export interface PersonalityCoreConfig {
  /** Whether to use LoRA adapters */
  useLoRA?: boolean;

  /** LoRA selection mode */
  loraMode?: 'latest' | 'latest-dual' | 'snapshot';

  /** Snapshot ID for emulation mode */
  snapshotId?: string;

  /** Model role override (defaults to 'persona') */
  modelRole?: string;

  /** Enable voice consistency tracking */
  trackVoiceConsistency?: boolean;

  /** Additional prompt instructions */
  additionalInstructions?: string;
}

/**
 * Voice consistency metrics
 */
export interface VoiceMetrics {
  /** Adapter used (if any) */
  adapterName?: string;

  /** Adapter date */
  adapterDate?: string;

  /** Response length */
  responseLength: number;

  /** Model used */
  model: string;

  /** Generation timestamp */
  timestamp: string;
}

// ============================================================================
// PersonalityCoreLayer Implementation
// ============================================================================

export class PersonalityCoreLayer implements CognitiveLayer<PersonalityInput, PersonalityOutput> {
  name = 'personality-core';
  version = '1.0.0';
  enabled = true;

  /**
   * Process input through personality core
   *
   * Generates authentic response using:
   * 1. Context from Layer 1 (Subconscious)
   * 2. LoRA adapter (if enabled and available)
   * 3. Operator results (if present)
   * 4. Mode-specific model selection
   */
  async process(
    input: PersonalityInput,
    context: LayerContext
  ): Promise<PersonalityOutput> {
    const startTime = Date.now();

    // Debug logging for input validation
    console.log('[personality-core] Processing input...');
    console.log(`[personality-core] - Cognitive mode: ${context.cognitiveMode}`);
    console.log(`[personality-core] - Has chatHistory: ${!!input.chatHistory} (${input.chatHistory?.length || 0} messages)`);
    console.log(`[personality-core] - Has contextPackage: ${!!input.contextPackage}`);
    console.log(`[personality-core] - Memory count: ${input.contextPackage?.memoryCount || 0}`);
    console.log(`[personality-core] - Index status: ${input.contextPackage?.indexStatus || 'unknown'}`);
    console.log(`[personality-core] - Has userMessage: ${!!input.userMessage}`);

    // Get layer configuration
    const config = this.getConfigForMode(context.cognitiveMode, context);

    // 1. Determine LoRA adapter (if enabled)
    let loraAdapter: LoRAMetadata | undefined;
    if (config.useLoRA) {
      loraAdapter = await this.selectLoRAAdapter(config, context.cognitiveMode);

      if (loraAdapter) {
        const validation = validateLoRAAdapter(loraAdapter);
        if (!validation.valid) {
          console.warn('[personality-core] LoRA adapter validation failed:', validation.errors);
          loraAdapter = undefined;
        }
      }
    }

    // 2. Build messages (either from chatHistory or from prompt)
    const modelRole = config.modelRole || 'persona';
    let messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    let promptMetadata: any = {};

    if (input.chatHistory && input.chatHistory.length > 0) {
      // Use pre-built chat history (from persona_chat.ts)
      messages = input.chatHistory.map(h => ({
        role: h.role as 'system' | 'user' | 'assistant',
        content: h.content
      }));
      promptMetadata = { usedChatHistory: true, messageCount: messages.length };
    } else {
      // Build prompt from context (standard pipeline mode)
      const prompt = this.buildPrompt(input, config, context.cognitiveMode);
      messages = [
        { role: 'system' as const, content: prompt.system },
        { role: 'user' as const, content: prompt.user }
      ];
      promptMetadata = {
        usedChatHistory: false,
        personaIncluded: prompt.metadata.personaIncluded,
        memoriesCount: prompt.metadata.memoriesCount,
        patternsCount: prompt.metadata.patternsCount,
        operatorIncluded: prompt.metadata.operatorIncluded
      };
    }

    // Audit prompt construction
    await audit({
      category: 'action',
      level: 'info',
      action: 'personality_prompt_built',
      details: {
        cognitiveMode: context.cognitiveMode,
        ...promptMetadata,
        loraAdapter: loraAdapter?.name
      }
    });

    // 3. Get LLM options from context or use defaults
    const llmOptions = context.metadata?.llmOptions || {
      temperature: 0.7,
      max_tokens: 1000
    };

    // Call LLM with persona role
    const routerResponse = await callLLM({
      role: modelRole,
      messages,
      cognitiveMode: context.cognitiveMode,
      options: llmOptions
    });

    const processingTime = Date.now() - startTime;

    // Extract response text from router response
    const responseText = routerResponse.content;

    // 4. Build voice metrics
    const voiceMetrics: VoiceMetrics = {
      adapterName: loraAdapter?.name,
      adapterDate: loraAdapter?.date,
      responseLength: responseText.length,
      model: routerResponse.model,
      timestamp: new Date().toISOString()
    };

    // 5. Audit response generation
    await audit({
      category: 'action',
      level: 'info',
      action: 'personality_response_generated',
      details: {
        cognitiveMode: context.cognitiveMode,
        processingTime,
        responseLength: responseText.length,
        loraAdapter: loraAdapter?.name,
        model: routerResponse.model,
        modelId: routerResponse.modelId,
        provider: routerResponse.provider,
        latencyMs: routerResponse.latencyMs
      }
    });

    return {
      response: responseText,
      voiceMetrics,
      loraAdapter: loraAdapter ? {
        name: loraAdapter.name,
        path: loraAdapter.path,
        date: loraAdapter.date
      } : undefined
    };
  }

  /**
   * Validate input
   */
  validate(input: PersonalityInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Require context package (can be empty object)
    if (!input.contextPackage) {
      errors.push('contextPackage is required');
    }

    // Warn if contextPackage is empty or has no memories
    if (input.contextPackage && Object.keys(input.contextPackage).length === 0) {
      warnings.push('contextPackage is empty - no memory context available');
    } else if (input.contextPackage && (!input.contextPackage.memoryCount || input.contextPackage.memoryCount === 0)) {
      warnings.push('contextPackage has no memories - response may lack personal context');
    }

    // Require either chatHistory or userMessage
    if (!input.chatHistory && !input.userMessage) {
      errors.push('Either chatHistory or userMessage is required');
    }

    // If operator result provided, validate structure
    if (input.operatorResult) {
      if (!input.operatorResult.plan && !input.operatorResult.narratorOutput && !input.operatorResult.skills) {
        errors.push('operatorResult must contain plan, narratorOutput, or skills');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Finalize - track voice consistency
   */
  async finalize(output: PersonalityOutput): Promise<void> {
    // Could track voice metrics to file system here
    // For now, metrics are already in output.voiceMetrics
    // Future: Maintain voice consistency log for analysis
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
  ): PersonalityCoreConfig {
    // Use config from context metadata (loaded by pipeline from cognitive-layers.json)
    const configFromFile = context.metadata?.layerConfig as PersonalityCoreConfig | undefined;

    // Default configurations per mode
    const defaults: Record<CognitiveModeId, PersonalityCoreConfig> = {
      dual: {
        useLoRA: true,
        loraMode: 'latest-dual',
        trackVoiceConsistency: true,
        modelRole: 'persona'
      },
      agent: {
        useLoRA: true,
        loraMode: 'latest',
        trackVoiceConsistency: false,
        modelRole: 'persona'
      },
      emulation: {
        useLoRA: true,
        loraMode: 'snapshot',
        trackVoiceConsistency: false,
        modelRole: 'persona'
      }
    };

    // Merge config file with defaults
    return {
      ...defaults[mode],
      ...configFromFile
    };
  }

  /**
   * Select LoRA adapter based on configuration
   */
  private async selectLoRAAdapter(
    config: PersonalityCoreConfig,
    mode: CognitiveModeId
  ): Promise<LoRAMetadata | undefined> {
    try {
      switch (config.loraMode) {
        case 'latest-dual':
          // Prefer dual adapter (history + recent)
          return findLatestLoRA(true);

        case 'latest':
          // Latest adapter (single or dual)
          return findLatestLoRA(false);

        case 'snapshot':
          // Specific snapshot for emulation mode
          if (!config.snapshotId) {
            console.warn('[personality-core] Snapshot mode requires snapshotId, falling back to latest');
            return findLatestLoRA(false);
          }
          return loadLoRASnapshot(config.snapshotId);

        default:
          console.warn(`[personality-core] Unknown loraMode: ${config.loraMode}, using latest`);
          return findLatestLoRA(false);
      }
    } catch (error) {
      console.error('[personality-core] Failed to select LoRA adapter:', error);
      return undefined;
    }
  }

  /**
   * Build prompt from input
   */
  private buildPrompt(
    input: PersonalityInput,
    config: PersonalityCoreConfig,
    mode: CognitiveModeId
  ) {
    const { contextPackage, operatorResult } = input;

    // If operator result exists and has narrator output, use simplified prompt
    if (operatorResult?.narratorOutput) {
      return buildOperatorPrompt(
        contextPackage.userMessage || '',
        operatorResult,
        mode
      );
    }

    // If operator result exists but no narrator output, include it with context
    if (operatorResult) {
      return buildPromptFromContext(
        contextPackage,
        mode,
        {
          includePersona: true,
          includeMemories: true,
          includePatterns: true,
          operatorResult,
          additionalInstructions: config.additionalInstructions
        }
      );
    }

    // No operator result - build from context package
    return buildPromptFromContext(
      contextPackage,
      mode,
      {
        includePersona: true,
        includeMemories: true,
        includePatterns: true,
        additionalInstructions: config.additionalInstructions
      }
    );
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get summary of available LoRA adapters
 *
 * Useful for debugging and monitoring
 */
export function getLoRASummary(): {
  available: number;
  latest?: string;
  latestDual?: string;
} {
  const discovery = discoverLoRAAdapters();

  return {
    available: discovery.count,
    latest: discovery.latest?.name,
    latestDual: discovery.latestDual?.name
  };
}
