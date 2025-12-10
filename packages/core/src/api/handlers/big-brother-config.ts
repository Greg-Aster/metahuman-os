/**
 * Big Brother Config API Handlers
 *
 * Unified handlers for Big Brother mode configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadOperatorConfig, saveUserConfig, invalidateOperatorConfig } from '../../config.js';
import { audit } from '../../audit.js';

const DEFAULT_CONFIG = {
  enabled: false,
  provider: 'claude-code',
  escalateOnStuck: true,
  escalateOnRepeatedFailures: true,
  maxRetries: 1,
  includeFullScratchpad: true,
  autoApplySuggestions: false,
};

/**
 * GET /api/big-brother-config - Retrieve Big Brother mode configuration
 */
export async function handleGetBigBrotherConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Guests can see the config but it's always disabled for them
    if (!user.isAuthenticated) {
      return successResponse({
        success: true,
        config: {
          enabled: false,
          provider: 'claude-code',
          escalateOnStuck: false,
          escalateOnRepeatedFailures: false,
          maxRetries: 0,
          includeFullScratchpad: false,
          autoApplySuggestions: false,
        },
        guestMode: true,
        warning: 'Big Brother mode is not available for guest users',
      });
    }

    const config = loadOperatorConfig();

    return successResponse({
      success: true,
      config: config.bigBrotherMode || DEFAULT_CONFIG,
    });
  } catch (error) {
    console.error('[big-brother-config] GET error:', error);
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to load Big Brother config',
    };
  }
}

/**
 * POST /api/big-brother-config - Update Big Brother mode configuration (owner only)
 * Body: { enabled, provider, escalateOnStuck, escalateOnRepeatedFailures, maxRetries, includeFullScratchpad, autoApplySuggestions }
 */
export async function handleSetBigBrotherConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    // Guests cannot modify settings
    if (!user.isAuthenticated) {
      return {
        status: 403,
        error: 'Big Brother settings cannot be modified in guest mode',
        data: { guestMode: true },
      };
    }

    // Only owners can modify Big Brother settings
    if (user.role !== 'owner') {
      return { status: 403, error: 'Only owners can modify Big Brother settings' };
    }

    const {
      enabled,
      provider,
      escalateOnStuck,
      escalateOnRepeatedFailures,
      maxRetries,
      includeFullScratchpad,
      autoApplySuggestions,
    } = body || {};

    // Load current config
    const config = loadOperatorConfig();

    // Update Big Brother mode settings
    config.bigBrotherMode = {
      enabled: enabled ?? false,
      provider: provider || 'claude-code',
      escalateOnStuck: escalateOnStuck ?? true,
      escalateOnRepeatedFailures: escalateOnRepeatedFailures ?? true,
      maxRetries: maxRetries ?? 1,
      includeFullScratchpad: includeFullScratchpad ?? true,
      autoApplySuggestions: autoApplySuggestions ?? false,
    };

    // Save to operator.json
    saveUserConfig('operator.json', config);
    invalidateOperatorConfig();

    // Audit the change
    audit({
      level: 'info',
      category: 'security',
      event: 'big_brother_config_updated',
      details: {
        enabled,
        provider,
        escalateOnStuck,
        escalateOnRepeatedFailures,
        maxRetries,
        updatedBy: user.username,
      },
      actor: user.username,
    });

    return successResponse({
      success: true,
      config: config.bigBrotherMode,
    });
  } catch (error) {
    console.error('[big-brother-config] POST error:', error);
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to update Big Brother config',
    };
  }
}
