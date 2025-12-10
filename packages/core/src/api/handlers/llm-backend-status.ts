/**
 * LLM Backend Status API Handlers
 *
 * GET LLM backend status and available backends.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * NOTE: Cloud models are now provided by the unified /api/status endpoint.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let getBackendStatus: any;
let detectAvailableBackends: any;
let loadBackendConfig: any;

async function ensureBackendFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    getBackendStatus = core.getBackendStatus;
    detectAvailableBackends = core.detectAvailableBackends;
    loadBackendConfig = core.loadBackendConfig;
    return !!(getBackendStatus && detectAvailableBackends && loadBackendConfig);
  } catch {
    return false;
  }
}

/**
 * GET /api/llm-backend/status - Get LLM backend status
 */
export async function handleGetLlmBackendStatus(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureBackendFunctions();
    if (!available) {
      return { status: 501, error: 'Backend functions not available' };
    }

    const [status, availableBackends, config] = await Promise.all([
      getBackendStatus(),
      detectAvailableBackends(),
      Promise.resolve(loadBackendConfig()),
    ]);

    return successResponse({
      active: status,
      available: availableBackends,
      config: {
        activeBackend: config.activeBackend,
        preferredLocalBackend: config.preferredLocalBackend || 'ollama',
        ollama: {
          endpoint: config.ollama.endpoint,
          defaultModel: config.ollama.defaultModel,
        },
        vllm: {
          endpoint: config.vllm.endpoint,
          model: config.vllm.model,
          gpuMemoryUtilization: config.vllm.gpuMemoryUtilization,
          maxModelLen: config.vllm.maxModelLen,
          enforceEager: config.vllm.enforceEager,
          autoUtilization: config.vllm.autoUtilization,
          enableThinking: config.vllm.enableThinking,
        },
        remote: config.remote ? {
          provider: config.remote.provider,
          serverUrl: config.remote.serverUrl,
          model: config.remote.model,
        } : null,
      },
    });
  } catch (error) {
    console.error('[llm-backend-status] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
