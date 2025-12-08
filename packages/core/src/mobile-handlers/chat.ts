/**
 * Mobile Chat Handler
 *
 * Handles chat requests on mobile when offline (no server).
 * Uses direct cloud API calls via mobile-providers.ts
 */

import type { MobileRequest, MobileResponse, MobileUserContext } from './types.js';
import { successResponse, errorResponse } from './types.js';
import { resolveCredentials, checkQuota, recordUsage, getUsageSummary } from '../llm-config.js';
import { callMobileProvider, type ChatMessage } from '../mobile-providers.js';
import { getProfilePaths } from '../paths.js';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

interface ChatRequestBody {
  message: string;
  mode?: 'conversation' | 'inner';
  sessionId?: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
}

// In-memory conversation history (per session)
const conversationHistories: Map<string, ChatMessage[]> = new Map();

// ============================================================================
// Handlers
// ============================================================================

/**
 * POST /api/chat - Send a chat message
 */
export async function handleChat(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required for chat');
  }

  const body = request.body as ChatRequestBody;
  if (!body?.message) {
    return errorResponse(request.id, 400, 'Message is required');
  }

  const { message, mode = 'conversation', sessionId, model, provider, temperature, maxTokens } = body;
  const historyKey = `${user.username}:${mode}:${sessionId || 'default'}`;

  // Check quota
  const quotaCheck = checkQuota(user.username);
  if (!quotaCheck.allowed) {
    return errorResponse(request.id, 429, quotaCheck.reason || 'Quota exceeded');
  }

  // Resolve credentials
  const creds = resolveCredentials(user.username, provider);
  if (!creds) {
    return errorResponse(request.id, 503, 'No LLM provider available. Configure API keys in Settings.');
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

  // Call LLM
  try {
    console.log(`[mobile-chat] Calling ${creds.provider} for ${user.username}`);

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

    // Save history
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

    return successResponse(request.id, {
      response: response.content,
      model: response.model,
      provider: creds.provider,
      source: creds.source,
      usage: response.usage,
    });
  } catch (error) {
    console.error('[mobile-chat] Error:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * POST /api/chat/clear - Clear conversation history
 */
export async function handleClearChat(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  const body = request.body as { mode?: string; sessionId?: string };
  const mode = body?.mode || 'conversation';
  const sessionId = body?.sessionId || 'default';
  const historyKey = `${user.username}:${mode}:${sessionId}`;

  conversationHistories.delete(historyKey);

  return successResponse(request.id, { cleared: true });
}

/**
 * GET /api/chat/usage - Get usage summary
 */
export async function handleGetUsage(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  const summary = getUsageSummary(user.username);
  const creds = resolveCredentials(user.username);

  return successResponse(request.id, {
    usage: summary,
    provider: creds ? {
      name: creds.provider,
      source: creds.source,
      hasCredentials: true,
    } : {
      hasCredentials: false,
    },
  });
}

/**
 * GET /api/chat/providers - List available providers
 */
export async function handleListProviders(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  // Check which providers the user has configured
  const providers: Array<{ name: string; configured: boolean; source: 'user' | 'system' | null }> = [];

  for (const providerName of ['runpod', 'claude', 'openrouter', 'openai']) {
    const creds = resolveCredentials(user.username, providerName);
    providers.push({
      name: providerName,
      configured: creds !== null,
      source: creds?.source || null,
    });
  }

  return successResponse(request.id, { providers });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build system prompt from persona
 */
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
    console.warn('[mobile-chat] Failed to load persona:', error);
    return getDefaultSystemPrompt(mode);
  }
}

function getDefaultSystemPrompt(mode: string): string {
  return mode === 'inner'
    ? 'You are having an internal dialogue with yourself.'
    : 'You are a helpful AI assistant.';
}
