/**
 * LLM Backend Config API Handlers
 *
 * GET/PUT LLM backend configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let loadBackendConfig: any;
let saveBackendConfig: any;

async function ensureBackendFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    loadBackendConfig = core.loadBackendConfig;
    saveBackendConfig = core.saveBackendConfig;
    return !!(loadBackendConfig && saveBackendConfig);
  } catch {
    return false;
  }
}

/**
 * GET /api/llm-backend/config - Get LLM backend configuration
 */
export async function handleGetLlmBackendConfig(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureBackendFunctions();
    if (!available) {
      return { status: 501, error: 'Backend functions not available' };
    }

    const config = loadBackendConfig();
    return successResponse(config);
  } catch (error) {
    console.error('[llm-backend-config] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/llm-backend/config - Update LLM backend configuration
 */
export async function handleSetLlmBackendConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required' };
    }

    const available = await ensureBackendFunctions();
    if (!available) {
      return { status: 501, error: 'Backend functions not available' };
    }

    const updates = body || {};

    // Validate updates
    const validBackends = ['ollama', 'vllm', 'remote', 'auto'];
    if (updates.activeBackend && !validBackends.includes(updates.activeBackend)) {
      return { status: 400, error: `Invalid activeBackend. Must be one of: ${validBackends.join(', ')}` };
    }

    if (updates.ollama?.defaultModel !== undefined
      && (typeof updates.ollama.defaultModel !== 'string'
        || !updates.ollama.defaultModel.trim()
        || updates.ollama.defaultModel.length > 256)) {
      return { status: 400, error: 'Ollama defaultModel must be a non-empty model name' };
    }

    if (updates.ollama?.endpoint !== undefined) {
      try {
        const endpoint = new URL(updates.ollama.endpoint);
        if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('unsupported protocol');
      } catch {
        return { status: 400, error: 'Ollama endpoint must be a valid HTTP or HTTPS URL' };
      }
    }

    const ollamaIntegerFields: Array<[string, number, number]> = [
      ['contextWindow', 256, 1048576],
      ['maxTokens', 1, 131072],
      ['topK', 0, 10000],
    ];
    for (const [field, min, max] of ollamaIntegerFields) {
      const value = updates.ollama?.[field];
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
        return { status: 400, error: `Ollama ${field} must be an integer between ${min} and ${max}` };
      }
    }

    const ollamaNumberFields: Array<[string, number, number]> = [
      ['temperature', 0, 5],
      ['topP', 0, 1],
      ['minP', 0, 1],
      ['repeatPenalty', 0.1, 5],
    ];
    for (const [field, min, max] of ollamaNumberFields) {
      const value = updates.ollama?.[field];
      if (value !== undefined
        && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) {
        return { status: 400, error: `Ollama ${field} must be between ${min} and ${max}` };
      }
    }

    if (updates.ollama?.seed !== undefined && updates.ollama.seed !== null
      && (!Number.isInteger(updates.ollama.seed) || updates.ollama.seed < 0)) {
      return { status: 400, error: 'Ollama seed must be a non-negative integer or null' };
    }

    if (updates.ollama?.keepAlive !== undefined
      && (typeof updates.ollama.keepAlive !== 'string'
        || !updates.ollama.keepAlive.trim()
        || updates.ollama.keepAlive.length > 64)) {
      return { status: 400, error: 'Ollama keepAlive must be a non-empty duration such as 5m or 1h' };
    }

    if (updates.ollama?.enableThinking !== undefined
      && typeof updates.ollama.enableThinking !== 'boolean') {
      return { status: 400, error: 'Ollama enableThinking must be a boolean' };
    }

    if (updates.vllm?.gpuMemoryUtilization !== undefined) {
      const util = updates.vllm.gpuMemoryUtilization;
      if (typeof util !== 'number' || !Number.isFinite(util) || util < 0.1 || util > 0.99) {
        return { status: 400, error: 'gpuMemoryUtilization must be between 0.1 and 0.99' };
      }
    }

    if (updates.vllm?.autoUtilizationMax !== undefined) {
      const util = updates.vllm.autoUtilizationMax;
      if (typeof util !== 'number' || !Number.isFinite(util) || util < 0.1 || util > 0.99) {
        return { status: 400, error: 'autoUtilizationMax must be between 0.1 and 0.99' };
      }
    }

    const nonNegativeGiBFields = [
      'gpuMemoryHeadroomGiB',
      'kvCacheMemoryGiB',
      'cpuOffloadGiB',
      'kvOffloadingGiB',
    ];
    for (const field of nonNegativeGiBFields) {
      const value = updates.vllm?.[field];
      if (value !== undefined && value !== null
        && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1024)) {
        return { status: 400, error: `${field} must be a non-negative GiB value` };
      }
    }

    if (updates.vllm?.maxModelLen !== undefined) {
      const maxModelLen = updates.vllm.maxModelLen;
      if (maxModelLen !== 'auto'
        && (!Number.isInteger(maxModelLen) || maxModelLen < 256)) {
        return { status: 400, error: 'maxModelLen must be "auto" or an integer of at least 256 tokens' };
      }
    }

    if (updates.vllm?.kvOffloadingBackend !== undefined
      && !['native', 'lmcache'].includes(updates.vllm.kvOffloadingBackend)) {
      return { status: 400, error: 'kvOffloadingBackend must be native or lmcache' };
    }

    saveBackendConfig(updates);

    const newConfig = loadBackendConfig(true);

    return successResponse({
      success: true,
      config: newConfig,
    });
  } catch (error) {
    console.error('[llm-backend-config] PUT failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
