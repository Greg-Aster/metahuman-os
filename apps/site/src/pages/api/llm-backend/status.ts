/**
 * LLM Backend Status API
 *
 * GET: Returns current backend status and available backends
 */

import type { APIRoute } from 'astro';
import {
  getBackendStatus,
  detectAvailableBackends,
  loadBackendConfig,
} from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    const [status, available, config] = await Promise.all([
      getBackendStatus(),
      detectAvailableBackends(),
      Promise.resolve(loadBackendConfig()),
    ]);

    return new Response(JSON.stringify({
      active: status,
      available,
      config: {
        activeBackend: config.activeBackend,
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
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
