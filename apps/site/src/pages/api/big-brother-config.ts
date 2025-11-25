import type { APIRoute } from 'astro';
import { loadOperatorConfig, saveUserConfig, invalidateOperatorConfig } from '@metahuman/core/config';
import { getAuthenticatedUser } from '@metahuman/core/auth';
import { audit } from '@metahuman/core';

/**
 * GET: Retrieve current Big Brother mode configuration
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const config = loadOperatorConfig();

    return new Response(JSON.stringify({
      success: true,
      config: config.bigBrotherMode || {
        enabled: false,
        provider: 'claude-code',
        escalateOnStuck: true,
        escalateOnRepeatedFailures: true,
        maxRetries: 1,
        includeFullScratchpad: true,
        autoApplySuggestions: false
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load Big Brother config'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * POST: Update Big Brother mode configuration
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owners can modify Big Brother settings
    if (user.role !== 'owner') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Only owners can modify Big Brother settings'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { enabled, provider, escalateOnStuck, escalateOnRepeatedFailures, maxRetries, includeFullScratchpad, autoApplySuggestions } = body;

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
      autoApplySuggestions: autoApplySuggestions ?? false
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
        updatedBy: user.username
      },
      actor: user.username
    });

    return new Response(JSON.stringify({
      success: true,
      config: config.bigBrotherMode
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update Big Brother config'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
