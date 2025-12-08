/**
 * Chat API Handlers
 *
 * Handles chat requests for both web and mobile.
 * Uses direct cloud API calls when local LLM is unavailable.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import {
  resolveCredentials,
  checkQuota,
  recordUsage,
  getUsageSummary,
  loadUserCredentials,
  saveUserCredentials,
  type UserCredentials,
} from '../../llm-config.js';
import { callMobileProvider, testProvider, type ChatMessage } from '../../mobile-providers.js';
import { getProfilePaths } from '../../paths.js';
import fs from 'node:fs';

// ============================================================================
// In-memory conversation history
// ============================================================================

const conversationHistories: Map<string, ChatMessage[]> = new Map();

// ============================================================================
// Handlers
// ============================================================================

/**
 * POST /api/chat - Send a chat message (mobile/offline mode)
 */
export async function handleChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!body?.message) {
    return { status: 400, error: 'Message is required' };
  }

  const {
    message,
    mode = 'conversation',
    sessionId,
    model,
    provider: preferredProvider,
    temperature,
    maxTokens,
  } = body as {
    message: string;
    mode?: string;
    sessionId?: string;
    model?: string;
    provider?: string;
    temperature?: number;
    maxTokens?: number;
  };

  const historyKey = `${user.username}:${mode}:${sessionId || 'default'}`;

  // Check quota
  const quotaCheck = checkQuota(user.username);
  if (!quotaCheck.allowed) {
    return { status: 429, error: quotaCheck.reason || 'Quota exceeded' };
  }

  // Resolve credentials
  const creds = resolveCredentials(user.username, preferredProvider);
  if (!creds) {
    return {
      status: 503,
      error: 'No LLM provider available. Configure API keys in Settings → LLM Providers.',
    };
  }

  // Build conversation history
  let history = conversationHistories.get(historyKey) || [];

  // Add system prompt if new conversation
  if (history.length === 0) {
    const systemPrompt = await buildSystemPrompt(user.username, mode);
    history.push({ role: 'system', content: systemPrompt });
  }

  // Add user message
  history.push({ role: 'user', content: message });

  try {
    console.log(`[chat-handler] Calling ${creds.provider} for ${user.username}`);

    const response = await callMobileProvider(
      {
        provider: creds.provider,
        apiKey: creds.apiKey,
        endpoint: creds.endpoint,
        model: model || creds.model,
      },
      history,
      {
        model: model || creds.model,
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens ?? 2048,
      }
    );

    // Add assistant response to history
    history.push({ role: 'assistant', content: response.content });

    // Trim history to last 20 messages (keep system prompt)
    if (history.length > 21) {
      const systemPrompt = history[0];
      history = [systemPrompt, ...history.slice(-20)];
    }
    conversationHistories.set(historyKey, history);

    // Record usage
    if (response.usage) {
      recordUsage(user.username, {
        provider: creds.provider,
        model: response.model,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        source: creds.source,
      });
    }

    return {
      status: 200,
      data: {
        response: response.content,
        model: response.model,
        provider: creds.provider,
        source: creds.source,
        usage: response.usage,
      },
    };
  } catch (error) {
    console.error('[chat-handler] Error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * DELETE /api/chat - Clear conversation history
 */
export async function handleClearChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;
  const { mode = 'conversation', sessionId } = (body || {}) as {
    mode?: string;
    sessionId?: string;
  };

  const historyKey = `${user.username}:${mode}:${sessionId || 'default'}`;
  conversationHistories.delete(historyKey);

  return { status: 200, data: { cleared: true } };
}

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

// ============================================================================
// Helpers
// ============================================================================

async function buildSystemPrompt(username: string, mode: string): Promise<string> {
  try {
    const profilePaths = getProfilePaths(username);
    const corePath = profilePaths.personaCore;

    if (!fs.existsSync(corePath)) {
      return getDefaultSystemPrompt(mode);
    }

    const persona = JSON.parse(fs.readFileSync(corePath, 'utf-8'));
    const identity = persona.identity || {};
    const personality = persona.personality || {};
    const values = persona.values?.core || [];

    const tone = personality.communicationStyle?.tone;
    const toneText = Array.isArray(tone) ? tone.join(', ') : tone || 'adaptive';
    const valueList = values.map((v: any) => v.value || v).filter(Boolean).join(', ');

    return `
You are ${identity.name || 'an AI assistant'}, an autonomous digital personality extension.
Your role is: ${identity.role || 'general assistant'}.
Your purpose is: ${identity.purpose || 'to help and assist'}.

Your personality is defined by these traits:
- Communication Style: ${toneText}.
- Values: ${valueList || 'Not specified'}.

You are having a ${mode === 'inner' ? 'internal dialogue' : 'conversation'}.
    `.trim();
  } catch (error) {
    console.warn('[chat-handler] Failed to load persona:', error);
    return getDefaultSystemPrompt(mode);
  }
}

function getDefaultSystemPrompt(mode: string): string {
  return mode === 'inner'
    ? 'You are having an internal dialogue with yourself.'
    : 'You are a helpful AI assistant.';
}
