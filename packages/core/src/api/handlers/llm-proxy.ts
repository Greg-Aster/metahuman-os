/**
 * LLM Proxy API Handler
 *
 * POST /api/llm/chat - Proxy chat requests to the local LLM backend.
 * POST /api/llm/proxy - OpenAI-compatible endpoint for Open Interpreter.
 * GET /api/llm/proxy/models - List available models.
 * GET /api/llm/proxy/config - Get proxy configuration.
 * POST /api/llm/proxy/config - Update proxy configuration.
 *
 * Used by remote clients (mobile/laptop) and Open Interpreter.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * The /api/llm/proxy endpoint uses user-configurable models from
 * tool-executor.json - NOT hardcoded! Users select their model in Settings.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse } from '../types.js';
import { audit } from '../../audit.js';
import { resolveModelById } from '../../model-resolver.js';
import {
  loadToolExecutorConfig,
  saveToolExecutorConfig,
  getToolExecutorModelId,
  setToolExecutorModel,
  type LLMProxyConfig,
} from '../../tool-executor-config.js';

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

/**
 * POST /api/llm/proxy - OpenAI-compatible endpoint for Open Interpreter
 *
 * This endpoint uses the modelId from tool-executor.json (user-configurable).
 * Users can select ANY backend (RunPod, Claude, Gemini, local, etc.) via Settings.
 *
 * Request body (OpenAI format):
 * {
 *   model: string,           // Ignored - we use tool-executor.json modelId
 *   messages: Array<{role: string, content: string}>,
 *   temperature?: number,
 *   max_tokens?: number,
 *   top_p?: number,
 *   stream?: boolean,        // Streaming not yet supported
 * }
 *
 * Response (OpenAI format):
 * {
 *   id: string,
 *   object: "chat.completion",
 *   created: number,
 *   model: string,
 *   choices: [{
 *     index: number,
 *     message: { role: string, content: string },
 *     finish_reason: string,
 *   }],
 *   usage: { prompt_tokens, completion_tokens, total_tokens }
 * }
 */
export async function handleLLMProxy(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    // Authentication required for LLM proxy
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const available = await ensureLlmFunctions();
    if (!available) {
      return { status: 501, error: 'LLM functions not available' };
    }

    // Load user's tool executor config to get their selected model
    const config = loadToolExecutorConfig(user.username);
    const proxyConfig = config.llmProxy;

    if (!proxyConfig.enabled) {
      return { status: 503, error: 'LLM proxy is disabled in configuration' };
    }

    // Validate request body
    const { messages, temperature, max_tokens, top_p, stream } = body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { status: 400, error: 'messages array is required' };
    }

    if (stream) {
      // TODO: Implement streaming support
      return { status: 501, error: 'Streaming not yet supported' };
    }

    // Resolve the user-configured model (NOT hardcoded!)
    const modelId = proxyConfig.modelId || 'default.coder';
    const resolvedModel = resolveModelById(modelId);

    if (!resolvedModel) {
      console.error(`[llm-proxy] Failed to resolve model: ${modelId}`);
      // Try fallback model
      const fallbackModelId = proxyConfig.fallbackModelId || 'default.fallback';
      const fallbackModel = resolveModelById(fallbackModelId);

      if (!fallbackModel) {
        return { status: 500, error: `Cannot resolve model ${modelId} or fallback ${fallbackModelId}` };
      }

      console.log(`[llm-proxy] Using fallback model: ${fallbackModelId}`);
    }

    const modelName = resolvedModel?.model || modelId;
    const provider = resolvedModel?.provider || 'ollama';

    console.log(`[llm-proxy] OpenAI proxy: user=${user.username}, modelId=${modelId}, provider=${provider}, model=${modelName}`);

    // Audit the request
    audit({
      level: 'info',
      category: 'action',
      event: 'llm_proxy_request',
      details: {
        modelId,
        provider,
        model: modelName,
        messageCount: messages.length,
        temperature: temperature ?? proxyConfig.temperature,
        maxTokens: max_tokens ?? proxyConfig.maxTokens,
      },
      actor: user.username,
    });

    // Call the provider through the existing bridge
    const startTime = Date.now();
    const response = await callProvider(
      provider,
      messages.map((m: any) => ({
        role: m.role || 'user',
        content: m.content || '',
      })),
      {
        model: modelName,
        temperature: temperature ?? proxyConfig.temperature,
        maxTokens: max_tokens ?? proxyConfig.maxTokens,
        topP: top_p,
      }
    );

    const duration = Date.now() - startTime;

    // Return OpenAI-compatible response format
    const completionId = `chatcmpl-mh-${Date.now()}`;
    const openAIResponse = {
      id: completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: response.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      // MetaHuman extensions (for debugging)
      _metahuman: {
        modelId,
        provider: response.provider || provider,
        durationMs: duration,
      },
    };

    // Audit the response
    audit({
      level: 'info',
      category: 'action',
      event: 'llm_proxy_response',
      details: {
        completionId,
        modelId,
        provider: response.provider || provider,
        durationMs: duration,
        tokenUsage: openAIResponse.usage,
      },
      actor: user.username,
    });

    return successResponse(openAIResponse);
  } catch (error) {
    console.error('[llm-proxy] OpenAI proxy failed:', error);

    // Return OpenAI-format error
    return {
      status: 500,
      body: {
        error: {
          message: (error as Error).message,
          type: 'server_error',
          code: 'internal_error',
        },
      },
    };
  }
}

/**
 * GET /api/llm/proxy/models - List available models for Open Interpreter
 *
 * Returns OpenAI-format model list with all user-configured models.
 */
export async function handleListProxyModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Get the current proxy model
    const config = loadToolExecutorConfig(user.username);
    const currentModelId = config.llmProxy.modelId;

    // Return a simplified model list for Open Interpreter
    // Open Interpreter just needs to know it can use "metahuman-proxy" as the model name
    const models = [
      {
        id: 'metahuman-proxy',
        object: 'model',
        created: Date.now(),
        owned_by: 'metahuman',
        permission: [],
        root: 'metahuman-proxy',
        parent: null,
        // MetaHuman extension: show actual configured model
        _metahuman: {
          actualModelId: currentModelId,
          description: 'Routes through MetaHuman model router to user-configured backend',
        },
      },
    ];

    return successResponse({
      object: 'list',
      data: models,
    });
  } catch (error) {
    console.error('[llm-proxy] List models failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * GET /api/llm/proxy/config - Get current LLM proxy configuration
 */
export async function handleGetProxyConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const config = loadToolExecutorConfig(user.username);

    return successResponse({
      llmProxy: config.llmProxy,
      activeBackend: config.activeBackend,
    });
  } catch (error) {
    console.error('[llm-proxy] Get config failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/llm/proxy/config - Update LLM proxy configuration
 *
 * Request body:
 * {
 *   modelId?: string,        // New model ID (from models.json)
 *   fallbackModelId?: string,
 *   temperature?: number,
 *   maxTokens?: number,
 *   enabled?: boolean,
 * }
 */
export async function handleSetProxyConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Only owners can modify configuration
    if (user.role !== 'owner') {
      return { status: 403, error: 'Only owner can modify LLM proxy configuration' };
    }

    const { modelId, fallbackModelId, temperature, maxTokens, enabled } = body || {};

    // Load current config
    const config = loadToolExecutorConfig(user.username);

    // Validate modelId if provided
    if (modelId !== undefined) {
      const resolved = resolveModelById(modelId);
      if (!resolved) {
        return { status: 400, error: `Unknown model ID: ${modelId}` };
      }
      config.llmProxy.modelId = modelId;
    }

    if (fallbackModelId !== undefined) {
      const resolved = resolveModelById(fallbackModelId);
      if (!resolved) {
        return { status: 400, error: `Unknown fallback model ID: ${fallbackModelId}` };
      }
      config.llmProxy.fallbackModelId = fallbackModelId;
    }

    if (temperature !== undefined) {
      if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
        return { status: 400, error: 'Temperature must be a number between 0 and 2' };
      }
      config.llmProxy.temperature = temperature;
    }

    if (maxTokens !== undefined) {
      if (typeof maxTokens !== 'number' || maxTokens < 1 || maxTokens > 128000) {
        return { status: 400, error: 'maxTokens must be a number between 1 and 128000' };
      }
      config.llmProxy.maxTokens = maxTokens;
    }

    if (enabled !== undefined) {
      config.llmProxy.enabled = !!enabled;
    }

    // Save updated config
    saveToolExecutorConfig(config, user.username);

    audit({
      level: 'info',
      category: 'action',
      event: 'llm_proxy_config_updated',
      details: {
        modelId: config.llmProxy.modelId,
        fallbackModelId: config.llmProxy.fallbackModelId,
        temperature: config.llmProxy.temperature,
        maxTokens: config.llmProxy.maxTokens,
        enabled: config.llmProxy.enabled,
      },
      actor: user.username,
    });

    return successResponse({
      success: true,
      llmProxy: config.llmProxy,
    });
  } catch (error) {
    console.error('[llm-proxy] Set config failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
