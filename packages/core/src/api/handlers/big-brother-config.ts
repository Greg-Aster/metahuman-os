/**
 * Big Brother Config API Handlers
 *
 * Unified handlers for Big Brother mode configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadFreshOperatorConfig, saveUserConfig, invalidateOperatorConfig } from '../../config.js';
import { getBigBrotherSessionState, stopBigBrotherSession } from '../../terminal/client.js';
import { audit } from '../../audit.js';
import { isBackendId } from '../../escalation-constants.js';

const DEFAULT_CONFIG = {
  enabled: false,
  provider: 'claude-code',
  model: 'sonnet',
  delegateAll: false,
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
          model: 'sonnet',
          delegateAll: false,
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

    const config = loadFreshOperatorConfig(user.isAuthenticated ? user.username : 'anonymous');

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
 * Body: { enabled, provider, delegateAll, escalateOnStuck, escalateOnRepeatedFailures, maxRetries, includeFullScratchpad, autoApplySuggestions }
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
    model,
    reasoningEffort,
    delegateAll,
    escalateOnStuck,
    escalateOnRepeatedFailures,
    maxRetries,
    includeFullScratchpad,
    autoApplySuggestions,
    } = body || {};

    if (provider !== undefined && !isBackendId(provider)) {
      return { status: 400, error: 'Unsupported Big Brother provider. Choose a supported provider in Settings.' };
    }

    // Load current config (fresh, no cache - critical for merge operations)
    const config = loadFreshOperatorConfig(user.username);

    const previousProvider = config.bigBrotherMode?.provider || 'claude-code';
    const previousEnabled = config.bigBrotherMode?.enabled ?? false;
    const nextProvider = provider ?? previousProvider;
    if (!isBackendId(nextProvider)) {
      return { status: 400, error: 'The saved Big Brother provider is unavailable. Choose a supported provider in Settings.' };
    }

    // Update Big Brother mode settings (preserve model if not provided)
    const existingModel = config.bigBrotherMode?.model;
    config.bigBrotherMode = {
      enabled: enabled ?? config.bigBrotherMode?.enabled ?? false,
      provider: nextProvider,
      model: model ?? (nextProvider === previousProvider ? existingModel : undefined) ?? (nextProvider === 'claude-code' ? 'sonnet' : ''),
      reasoningEffort: reasoningEffort ?? config.bigBrotherMode?.reasoningEffort,
      delegateAll: delegateAll ?? config.bigBrotherMode?.delegateAll ?? false,
      escalateOnStuck: escalateOnStuck ?? config.bigBrotherMode?.escalateOnStuck ?? true,
      escalateOnRepeatedFailures: escalateOnRepeatedFailures ?? config.bigBrotherMode?.escalateOnRepeatedFailures ?? true,
      maxRetries: maxRetries ?? config.bigBrotherMode?.maxRetries ?? 1,
      includeFullScratchpad: includeFullScratchpad ?? config.bigBrotherMode?.includeFullScratchpad ?? true,
      autoApplySuggestions: autoApplySuggestions ?? config.bigBrotherMode?.autoApplySuggestions ?? false,
    };

    const nextEnabled = config.bigBrotherMode.enabled;

    // A provider change or disable always tears down the one shared session.
    if ((previousEnabled && !nextEnabled) || previousProvider !== nextProvider) {
      const state = await getBigBrotherSessionState();
      if (state.sessionOpen || state.processRunning) {
        await stopBigBrotherSession();
      }
    }

    // Persist only after the prior provider has stopped successfully.
    saveUserConfig('operator.json', config, user.username);
    invalidateOperatorConfig(user.username);

    // Audit the change
    audit({
      level: 'info',
      category: 'security',
      event: 'big_brother_config_updated',
      details: {
        enabled,
        provider,
        model: config.bigBrotherMode.model,
        delegateAll,
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
