/**
 * Chat Provider Management Handlers
 *
 * Manages cloud LLM provider credentials and usage tracking.
 * Used by mobile app for configuring RunPod, Claude, OpenRouter, etc.
 *
 * NOTE: The actual chat functionality uses /api/persona_chat (unified handler).
 * This file only handles provider credential management.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import {
  resolveCredentials,
  getUsageSummary,
  loadUserCredentials,
  saveUserCredentials,
  type UserCredentials,
} from '../../llm-config.js';
import { testProvider } from '../../mobile-providers.js';

// ============================================================================
// Handlers
// ============================================================================

/**
 * GET /api/chat/usage - Get usage summary
 */
export async function handleGetUsage(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  const summary = getUsageSummary(user.username);
  const creds = resolveCredentials(user.username);

  return {
    status: 200,
    data: {
      usage: summary,
      provider: creds
        ? { name: creds.provider, source: creds.source, hasCredentials: true }
        : { hasCredentials: false },
    },
  };
}

/**
 * GET /api/chat/providers - List available providers for user
 */
export async function handleListProviders(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  const providers: Array<{ name: string; configured: boolean; source: 'user' | 'system' | null }> = [];

  for (const providerName of ['runpod', 'claude', 'openrouter', 'openai']) {
    const creds = resolveCredentials(user.username, providerName);
    providers.push({
      name: providerName,
      configured: creds !== null,
      source: creds?.source || null,
    });
  }

  return { status: 200, data: { providers } };
}

/**
 * PUT /api/chat/provider - Set preferred offline provider
 */
export async function handleSetProvider(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  const { provider } = (body || {}) as { provider?: string };

  const validProviders = ['runpod', 'claude', 'openrouter', 'openai'];
  if (!provider || !validProviders.includes(provider)) {
    return {
      status: 400,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    };
  }

  // Load existing credentials or create new
  const creds: UserCredentials = loadUserCredentials(user.username) || {};

  // Set preferred offline provider
  creds.offlineProvider = provider as UserCredentials['offlineProvider'];

  // Save
  saveUserCredentials(user.username, creds);

  console.log(`[chat-handler] Set preferred provider for ${user.username}: ${provider}`);

  return {
    status: 200,
    data: {
      provider,
      message: `Preferred provider set to ${provider}`,
    },
  };
}

/**
 * POST /api/chat/credentials - Save user's API credentials for a provider
 */
export async function handleSaveCredentials(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  const { provider, apiKey, endpoint } = (body || {}) as {
    provider?: string;
    apiKey?: string;
    endpoint?: string;
  };

  const validProviders = ['runpod', 'claude', 'openrouter', 'openai'];
  if (!provider || !validProviders.includes(provider)) {
    return {
      status: 400,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    };
  }

  if (!apiKey) {
    return { status: 400, error: 'API key is required' };
  }

  // Test the credentials first
  try {
    console.log(`[chat-handler] Testing ${provider} credentials for ${user.username}...`);

    const testResult = await testProvider({
      provider,
      apiKey,
      endpoint,
    });

    if (!testResult.success) {
      return {
        status: 400,
        error: `Credential test failed: ${testResult.error}`,
      };
    }
  } catch (error) {
    return {
      status: 400,
      error: `Credential test failed: ${(error as Error).message}`,
    };
  }

  // Load existing credentials or create new
  const creds: UserCredentials = loadUserCredentials(user.username) || {};

  // Update provider credentials
  switch (provider) {
    case 'runpod':
      creds.runpod = { apiKey, endpointId: endpoint };
      break;
    case 'claude':
      creds.claude = { apiKey };
      break;
    case 'openrouter':
      creds.openrouter = { apiKey };
      break;
    case 'openai':
      creds.openai = { apiKey, endpoint };
      break;
  }

  // Save
  saveUserCredentials(user.username, creds);

  console.log(`[chat-handler] Saved ${provider} credentials for ${user.username}`);

  return {
    status: 200,
    data: {
      provider,
      configured: true,
      message: `${provider} credentials saved successfully`,
    },
  };
}

/**
 * DELETE /api/chat/credentials - Remove user's API credentials for a provider
 */
export async function handleDeleteCredentials(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  const { provider } = (body || {}) as { provider?: string };

  const validProviders = ['runpod', 'claude', 'openrouter', 'openai'];
  if (!provider || !validProviders.includes(provider)) {
    return {
      status: 400,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    };
  }

  // Load existing credentials
  const creds = loadUserCredentials(user.username);
  if (!creds) {
    return { status: 200, data: { provider, deleted: true } };
  }

  // Remove provider credentials
  delete creds[provider as keyof UserCredentials];

  // Save
  saveUserCredentials(user.username, creds);

  console.log(`[chat-handler] Removed ${provider} credentials for ${user.username}`);

  return {
    status: 200,
    data: {
      provider,
      deleted: true,
      message: `${provider} credentials removed`,
    },
  };
}
