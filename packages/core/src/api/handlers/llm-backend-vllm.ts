/**
 * vLLM Server Control API Handlers
 *
 * POST control vLLM server (start, stop, restart, cleanup, gpu_check).
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * LoRA Support:
 * - On start/restart, reads user's LoRA config from their models.json
 * - Discovers valid adapters and passes them to vLLM via --lora-modules flag
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let vllm: any;
let loadBackendConfig: any;
let cleanupVLLMProcesses: any;
let checkVLLMGPUMemory: any;
let getProfilePaths: any;
let getAdaptersToLoad: any;
let getVllmLoraConfig: any;

async function ensureVllmFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    vllm = core.vllm;
    loadBackendConfig = core.loadBackendConfig;
    cleanupVLLMProcesses = core.cleanupVLLMProcesses;
    checkVLLMGPUMemory = core.checkVLLMGPUMemory;
    getProfilePaths = core.getProfilePaths;
    getAdaptersToLoad = core.getAdaptersToLoad;
    getVllmLoraConfig = core.getVllmLoraConfig;
    return !!(vllm && loadBackendConfig);
  } catch {
    return false;
  }
}

/**
 * POST /api/llm-backend/vllm - Control vLLM server
 */
export async function handleVllmControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required' };
    }

    const available = await ensureVllmFunctions();
    if (!available) {
      return { status: 501, error: 'vLLM functions not available' };
    }

    const config = loadBackendConfig();
    const action = body?.action;

    switch (action) {
      case 'status': {
        const health = await vllm.getHealth();
        return successResponse(health);
      }

      case 'start': {
        // Get LoRA adapters to load (if user is authenticated)
        let loraModules: Array<{ name: string; path: string }> = [];
        let maxLoraRank = 64;

        if (user.username && getProfilePaths && getAdaptersToLoad && getVllmLoraConfig) {
          try {
            const profilePaths = getProfilePaths(user.username);
            loraModules = await getAdaptersToLoad(profilePaths.out, profilePaths.etc);
            const loraConfig = getVllmLoraConfig(profilePaths.etc);
            maxLoraRank = loraConfig.maxLoraRank || 64;
          } catch (error) {
            console.warn('[llm-backend-vllm] Failed to load LoRA config:', error);
          }
        }

        const result = await vllm.startServer({
          endpoint: config.vllm.endpoint,
          model: body?.model || config.vllm.model,
          gpuMemoryUtilization: body?.gpuMemoryUtilization || config.vllm.gpuMemoryUtilization,
          maxModelLen: config.vllm.maxModelLen,
          tensorParallelSize: config.vllm.tensorParallelSize,
          dtype: config.vllm.dtype,
          quantization: config.vllm.quantization,
          enforceEager: config.vllm.enforceEager,
          autoUtilization: config.vllm.autoUtilization,
          enableThinking: config.vllm.enableThinking,
          loraModules,
          maxLoraRank,
        });

        if (!result.success) {
          return { status: 500, error: result.error };
        }
        return successResponse({
          success: true,
          pid: result.pid,
          loadedLoras: loraModules.map(l => l.name),
        });
      }

      case 'stop': {
        await vllm.stopServer();
        return successResponse({ success: true });
      }

      case 'restart': {
        await vllm.stopServer();

        // Get LoRA adapters to load (if user is authenticated)
        let loraModules: Array<{ name: string; path: string }> = [];
        let maxLoraRank = 64;

        if (user.username && getProfilePaths && getAdaptersToLoad && getVllmLoraConfig) {
          try {
            const profilePaths = getProfilePaths(user.username);
            loraModules = await getAdaptersToLoad(profilePaths.out, profilePaths.etc);
            const loraConfig = getVllmLoraConfig(profilePaths.etc);
            maxLoraRank = loraConfig.maxLoraRank || 64;
          } catch (error) {
            console.warn('[llm-backend-vllm] Failed to load LoRA config:', error);
          }
        }

        const result = await vllm.startServer({
          endpoint: config.vllm.endpoint,
          model: body?.model || config.vllm.model,
          gpuMemoryUtilization: body?.gpuMemoryUtilization || config.vllm.gpuMemoryUtilization,
          maxModelLen: config.vllm.maxModelLen,
          tensorParallelSize: config.vllm.tensorParallelSize,
          dtype: config.vllm.dtype,
          quantization: config.vllm.quantization,
          enforceEager: config.vllm.enforceEager,
          autoUtilization: config.vllm.autoUtilization,
          enableThinking: config.vllm.enableThinking,
          loraModules,
          maxLoraRank,
        });

        if (!result.success) {
          return { status: 500, error: result.error };
        }
        return successResponse({
          success: true,
          pid: result.pid,
          loadedLoras: loraModules.map(l => l.name),
        });
      }

      case 'cleanup': {
        if (cleanupVLLMProcesses) {
          await cleanupVLLMProcesses();
        }
        return successResponse({ success: true });
      }

      case 'gpu_check': {
        if (!checkVLLMGPUMemory) {
          return { status: 501, error: 'GPU check not available' };
        }
        const utilization = body?.gpuMemoryUtilization || config.vllm.gpuMemoryUtilization;
        const result = await checkVLLMGPUMemory(utilization);
        return successResponse(result);
      }

      default:
        return { status: 400, error: 'Invalid action. Must be "start", "stop", "restart", "status", "cleanup", or "gpu_check"' };
    }
  } catch (error) {
    console.error('[llm-backend-vllm] POST failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
