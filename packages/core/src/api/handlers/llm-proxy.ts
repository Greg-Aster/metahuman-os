/**
 * LLM Proxy API Handler
 *
 * POST /api/llm/chat - Proxy chat requests to the local LLM backend.
 * Used by remote clients (mobile/laptop) to use the server's LLM.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports for LLM functions
let callProvider: any;
let loadBackendConfig: any;
let getBackendStatus: any;

async function ensureLlmFunctions(): Promise<boolean> {
  try {
    const bridge = await import('../../providers/bridge.js');
    const backend = await import('../../llm-backend.js');
    callProvider = bridge.callProvider;
    loadBackendConfig = backend.loadBackendConfig;
    getBackendStatus = backend.getBackendStatus;
    return !!(callProvider && loadBackendConfig && getBackendStatus);
  } catch (err) {
    console.error('[llm-proxy] Failed to load LLM functions:', err);
    return false;
  }
}

/**
 * POST /api/llm/chat - Proxy chat to local LLM backend
 *
 * Request body:
 * {
 *   model: string,        // Model name (e.g., "qwen3:14b")
 *   messages: Array<{role: string, content: string}>,
 *   options?: {
 *     temperature?: number,
 *     num_predict?: number,  // max tokens
 *     top_p?: number,
 *   }
 * }
 *
 * Response (Ollama-compatible format):
 * {
 *   message: { role: string, content: string },
 *   model: string,
 *   done: boolean,
 *   total_duration?: number,
 *   eval_count?: number,
 *   prompt_eval_count?: number,
 * }
 */
export async function handleLlmChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const available = await ensureLlmFunctions();
    if (!available) {
      return { status: 501, error: 'LLM functions not available' };
    }

    // Validate request body
    const { model, messages, options } = body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { status: 400, error: 'messages array is required' };
    }

    // Get backend status to determine which provider to use
    const backendStatus = await getBackendStatus();
    const provider = backendStatus.resolvedBackend || 'ollama';

    // Determine model to use
    const modelToUse = model || backendStatus.model || 'qwen3:14b';

    console.log(`[llm-proxy] Chat request: provider=${provider}, model=${modelToUse}, messages=${messages.length}`);

    // Call the provider
    const response = await callProvider(
      provider,
      messages.map((m: any) => ({
        role: m.role || 'user',
        content: m.content || '',
      })),
      {
        model: modelToUse,
        temperature: options?.temperature,
        maxTokens: options?.num_predict || options?.max_tokens,
        topP: options?.top_p,
      }
    );

    // Return Ollama-compatible response format
    return successResponse({
      message: {
        role: 'assistant',
        content: response.content,
      },
      model: response.model || modelToUse,
      done: true,
      provider: response.provider,
      usage: response.usage,
    });
  } catch (error) {
    console.error('[llm-proxy] Chat failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
