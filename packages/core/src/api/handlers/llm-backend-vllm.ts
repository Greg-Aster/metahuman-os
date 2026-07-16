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
let calculateOptimalVLLMUtilization: any;
let buildVLLMStartConfig: any;
let getProfilePaths: any;
let getAdaptersToLoad: any;
let getVllmLoraConfig: any;
let listLocalModelArtifacts: any;
let preflightVLLMArtifacts: any;

async function ensureVllmFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    vllm = core.vllm;
    loadBackendConfig = core.loadBackendConfig;
    cleanupVLLMProcesses = core.cleanupVLLMProcesses;
    checkVLLMGPUMemory = core.checkVLLMGPUMemory;
    calculateOptimalVLLMUtilization = core.calculateOptimalVLLMUtilization;
    buildVLLMStartConfig = core.buildVLLMStartConfig;
    getProfilePaths = core.getProfilePaths;
    getAdaptersToLoad = core.getAdaptersToLoad;
    getVllmLoraConfig = core.getVllmLoraConfig;
    listLocalModelArtifacts = core.listLocalModelArtifacts;
    preflightVLLMArtifacts = core.preflightVLLMArtifacts;
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

      case 'preflight': {
        if (!listLocalModelArtifacts || !preflightVLLMArtifacts) {
          return { status: 501, error: 'vLLM artifact preflight is not available' };
        }
        const requestedIds = Array.isArray(body?.artifactIds)
          ? new Set(body.artifactIds.filter((id: unknown): id is string => typeof id === 'string'))
          : null;
        const artifacts = listLocalModelArtifacts().filter((artifact: { id: string }) =>
          !requestedIds || requestedIds.has(artifact.id)
        );
        return successResponse({
          success: true,
          results: preflightVLLMArtifacts(artifacts),
        });
      }

      case 'start': {
        const startConfig = buildVLLMStartConfig(config, body?.model, body?.gpuMemoryUtilization);
        // Get LoRA adapters to load (if user is authenticated)
        let loraModules: Array<{ name: string; path: string }> = [];
        let maxLoraRank = 64;
        let maxLoras = 1;
        let maxCpuLoras = 1;
        let loraDtype: 'auto' | 'float16' | 'bfloat16' = 'auto';

        if (user.username && getProfilePaths && getAdaptersToLoad && getVllmLoraConfig) {
          try {
            const profilePaths = getProfilePaths(user.username);
            const targetModel = startConfig.artifact?.displayName || startConfig.servedModelName || startConfig.model;
            loraModules = await getAdaptersToLoad(profilePaths.out, profilePaths.etc, targetModel);
            const loraConfig = getVllmLoraConfig(profilePaths.etc);
            maxLoraRank = loraConfig.maxLoraRank || 64;
            maxLoras = loraConfig.maxLoras || 1;
            maxCpuLoras = loraConfig.maxCpuLoras || maxLoras;
            loraDtype = loraConfig.loraDtype || 'auto';
          } catch (error) {
            console.warn('[llm-backend-vllm] Failed to load LoRA config:', error);
          }
        }

        const result = await vllm.startServer({
          ...startConfig,
          loraModules,
          maxLoraRank,
          maxLoras,
          maxCpuLoras,
          loraDtype,
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
        // A restart must apply memory, context, offload, and LoRA changes even
        // when the served model name is unchanged. startServer() intentionally
        // reuses a healthy matching server, so stop it explicitly here.
        await vllm.stopServer();
        const startConfig = buildVLLMStartConfig(config, body?.model, body?.gpuMemoryUtilization);

        // Get LoRA adapters to load (if user is authenticated)
        let loraModules: Array<{ name: string; path: string }> = [];
        let maxLoraRank = 64;
        let maxLoras = 1;
        let maxCpuLoras = 1;
        let loraDtype: 'auto' | 'float16' | 'bfloat16' = 'auto';

        if (user.username && getProfilePaths && getAdaptersToLoad && getVllmLoraConfig) {
          try {
            const profilePaths = getProfilePaths(user.username);
            const targetModel = startConfig.artifact?.displayName || startConfig.servedModelName || startConfig.model;
            loraModules = await getAdaptersToLoad(profilePaths.out, profilePaths.etc, targetModel);
            const loraConfig = getVllmLoraConfig(profilePaths.etc);
            maxLoraRank = loraConfig.maxLoraRank || 64;
            maxLoras = loraConfig.maxLoras || 1;
            maxCpuLoras = loraConfig.maxCpuLoras || maxLoras;
            loraDtype = loraConfig.loraDtype || 'auto';
          } catch (error) {
            console.warn('[llm-backend-vllm] Failed to load LoRA config:', error);
          }
        }

        const result = await vllm.startServer({
          ...startConfig,
          loraModules,
          maxLoraRank,
          maxLoras,
          maxCpuLoras,
          loraDtype,
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

      case 'memory_plan': {
        if (!calculateOptimalVLLMUtilization) {
          return { status: 501, error: 'Automatic vLLM memory planning is not available' };
        }
        const headroomGiB = body?.gpuMemoryHeadroomGiB ?? config.vllm.gpuMemoryHeadroomGiB ?? 1.5;
        const maxUtilization = body?.autoUtilizationMax ?? config.vllm.autoUtilizationMax ?? 0.95;
        const [result, health] = await Promise.all([
          calculateOptimalVLLMUtilization(headroomGiB, maxUtilization),
          vllm.getHealth(),
        ]);
        return successResponse({
          ...result,
          currentVllmRunning: health.running,
        });
      }

      default:
        return { status: 400, error: 'Invalid action. Must be "start", "stop", "restart", "status", "preflight", "cleanup", "gpu_check", or "memory_plan"' };
    }
  } catch (error) {
    console.error('[llm-backend-vllm] POST failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
