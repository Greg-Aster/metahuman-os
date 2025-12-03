/**
 * Reasoning Service - Configuration
 *
 * Default configuration and depth-based settings.
 */

import type { ReasoningEngineConfig, ReasoningDepth } from './types';

/**
 * Get maximum steps based on reasoning depth.
 */
export function getMaxStepsForDepth(depth: ReasoningDepth): number {
  switch (depth) {
    case 'off':
      return 1; // Single shot
    case 'quick':
      return 5; // Fast responses
    case 'focused':
      return 10; // Default balanced
    case 'deep':
      return 15; // Thorough exploration
    default:
      return 10;
  }
}

/**
 * Get default configuration with all fields populated.
 */
export function getDefaultConfig(
  overrides: ReasoningEngineConfig = {}
): Required<ReasoningEngineConfig> {
  const depth = overrides.depth || 'focused';

  return {
    depth,
    maxSteps: overrides.maxSteps || getMaxStepsForDepth(depth),
    toolCatalog: overrides.toolCatalog || '', // Loaded by engine
    planningModel: overrides.planningModel || 'orchestrator',
    responseModel: overrides.responseModel || 'persona',
    useSingleModel: overrides.useSingleModel !== undefined ? overrides.useSingleModel : false,
    scratchpadTrimSize: overrides.scratchpadTrimSize || 10,
    observationMode: overrides.observationMode || 'structured',
    enableErrorRetry: overrides.enableErrorRetry !== false,
    enableFailureLoopDetection: overrides.enableFailureLoopDetection !== false,
    enableFastPath: overrides.enableFastPath !== false,
    enableVerbatimShortCircuit: overrides.enableVerbatimShortCircuit !== false,
    enableScratchpadDump: overrides.enableScratchpadDump || false,
    verboseErrors: overrides.verboseErrors || false,
    sessionId: overrides.sessionId || `session-${Date.now()}`,
    conversationId: overrides.conversationId ?? '',
    userId: overrides.userId ?? '',
  };
}

/**
 * Validate configuration (check for invalid values).
 */
export function validateConfig(config: Required<ReasoningEngineConfig>): void {
  if (config.maxSteps < 1 || config.maxSteps > 50) {
    throw new Error(`Invalid maxSteps: ${config.maxSteps}. Must be between 1 and 50.`);
  }

  if (config.scratchpadTrimSize < 1 || config.scratchpadTrimSize > 100) {
    throw new Error(
      `Invalid scratchpadTrimSize: ${config.scratchpadTrimSize}. Must be between 1 and 100.`
    );
  }

  const validDepths: ReasoningDepth[] = ['off', 'quick', 'focused', 'deep'];
  if (!validDepths.includes(config.depth)) {
    throw new Error(`Invalid depth: ${config.depth}. Must be one of: ${validDepths.join(', ')}`);
  }

  const validModes = ['narrative', 'structured', 'verbatim'];
  if (!validModes.includes(config.observationMode)) {
    throw new Error(
      `Invalid observationMode: ${config.observationMode}. Must be one of: ${validModes.join(', ')}`
    );
  }
}
