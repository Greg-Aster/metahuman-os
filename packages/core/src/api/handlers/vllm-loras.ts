/**
 * vLLM LoRA API Handlers
 *
 * GET /api/vllm/loras - List available and loaded LoRA adapters
 * PUT /api/vllm/loras - Update LoRA configuration (enable/disable adapters)
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import type { VllmLoraAdapter } from '../../vllm-lora.js';

// Dynamic imports to avoid circular dependencies
let getProfilePaths: any;
let discoverVllmLoraAdapters: any;
let getVllmLoraConfig: any;
let saveVllmLoraConfig: any;
let enableVllmLoraAdapter: any;
let disableVllmLoraAdapter: any;
let getVLLMLoadedLoras: any;
let loadBackendConfig: any;
let isVllmLoraCompatibleWithModel: any;

async function ensureLoraFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    getProfilePaths = core.getProfilePaths;
    discoverVllmLoraAdapters = core.discoverVllmLoraAdapters;
    getVllmLoraConfig = core.getVllmLoraConfig;
    saveVllmLoraConfig = core.saveVllmLoraConfig;
    enableVllmLoraAdapter = core.enableVllmLoraAdapter;
    disableVllmLoraAdapter = core.disableVllmLoraAdapter;
    getVLLMLoadedLoras = core.getVLLMLoadedLoras;
    loadBackendConfig = core.loadBackendConfig;
    isVllmLoraCompatibleWithModel = core.isVllmLoraCompatibleWithModel;
    return !!(getProfilePaths && discoverVllmLoraAdapters);
  } catch {
    return false;
  }
}

/**
 * GET /api/vllm/loras - List available LoRA adapters
 *
 * Returns:
 * - available: All discovered adapters with metadata
 * - loaded: Names of currently loaded adapters
 * - config: User's LoRA configuration
 */
export async function handleGetVllmLoras(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated || !user.username) {
      return { status: 401, error: 'Authentication required' };
    }

    const available = await ensureLoraFunctions();
    if (!available) {
      return { status: 501, error: 'LoRA functions not available' };
    }

    const profilePaths = getProfilePaths(user.username);
    const targetModel = req.query?.model || loadBackendConfig?.().vllm?.model;

    // Discover adapters
    const adapters = await discoverVllmLoraAdapters(profilePaths.out);

    // Get currently loaded LoRAs from vLLM
    let loadedLoras: string[] = [];
    try {
      loadedLoras = await getVLLMLoadedLoras();
    } catch {
      // vLLM might not be running
    }

    // Mark loaded status on adapters
    const adaptersWithStatus = adapters.map((a: VllmLoraAdapter) => ({
      ...a,
      loaded: loadedLoras.includes(a.name),
      compatibleWithTarget: targetModel
        ? isVllmLoraCompatibleWithModel?.(a.baseModel, targetModel) === true
        : undefined,
    }));

    // Get user's config
    const config = getVllmLoraConfig(profilePaths.etc);

    return successResponse({
      available: adaptersWithStatus,
      loaded: loadedLoras,
      config,
      targetModel,
    });
  } catch (error) {
    console.error('[vllm-loras] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/vllm/loras - Update LoRA configuration
 *
 * Body:
 * - action: 'enable' | 'disable' | 'set'
 * - adapterName: Name of adapter (for enable/disable)
 * - enabledAdapters: Array of names (for set)
 * - maxLoraRank: Optional rank override
 * - maxLoras: Maximum distinct adapters in one batch
 * - maxCpuLoras: Maximum adapters retained in CPU RAM
 * - loraDtype: auto, float16, or bfloat16
 *
 * Returns:
 * - success: boolean
 * - needsRestart: Whether vLLM needs restart
 * - config: Updated configuration
 */
export async function handleUpdateVllmLoras(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated || !user.username) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required' };
    }

    const available = await ensureLoraFunctions();
    if (!available) {
      return { status: 501, error: 'LoRA functions not available' };
    }

    const profilePaths = getProfilePaths(user.username);
    const action = body?.action;

    // Get currently loaded LoRAs to determine if restart needed
    let loadedLoras: string[] = [];
    try {
      loadedLoras = await getVLLMLoadedLoras();
    } catch {
      // vLLM might not be running
    }

    let needsRestart = false;

    switch (action) {
      case 'enable': {
        const adapterName = body?.adapterName;
        if (!adapterName) {
          return { status: 400, error: 'adapterName required' };
        }
        const wasAdded = enableVllmLoraAdapter(profilePaths.etc, adapterName, user.username);
        // Needs restart if adapter wasn't already loaded
        needsRestart = wasAdded && !loadedLoras.includes(adapterName);
        break;
      }

      case 'disable': {
        const adapterName = body?.adapterName;
        if (!adapterName) {
          return { status: 400, error: 'adapterName required' };
        }
        disableVllmLoraAdapter(profilePaths.etc, adapterName, user.username);
        // Needs restart if adapter was loaded
        needsRestart = loadedLoras.includes(adapterName);
        break;
      }

      case 'set': {
        const enabledAdapters = body?.enabledAdapters ?? [];
        const maxLoraRank = body?.maxLoraRank ?? 64;
        const maxLoras = body?.maxLoras ?? 1;
        const maxCpuLoras = body?.maxCpuLoras ?? maxLoras;
        const loraDtype = body?.loraDtype ?? 'auto';

        if (!Array.isArray(enabledAdapters) || enabledAdapters.some(name => typeof name !== 'string')) {
          return { status: 400, error: 'enabledAdapters must be an array of adapter names' };
        }
        const allowedRanks = [1, 8, 16, 32, 64, 128, 256, 320, 512];
        if (!allowedRanks.includes(maxLoraRank)) {
          return { status: 400, error: `maxLoraRank must be one of: ${allowedRanks.join(', ')}` };
        }
        if (!Number.isInteger(maxLoras) || maxLoras < 1 || maxLoras > 256) {
          return { status: 400, error: 'maxLoras must be an integer between 1 and 256' };
        }
        if (!Number.isInteger(maxCpuLoras) || maxCpuLoras < maxLoras || maxCpuLoras > 1024) {
          return { status: 400, error: 'maxCpuLoras must be an integer greater than or equal to maxLoras' };
        }
        if (!['auto', 'float16', 'bfloat16'].includes(loraDtype)) {
          return { status: 400, error: 'loraDtype must be auto, float16, or bfloat16' };
        }

        const discoveredAdapters = await discoverVllmLoraAdapters(profilePaths.out);
        const availableNames = new Set(discoveredAdapters.filter((adapter: VllmLoraAdapter) => adapter.valid).map((adapter: VllmLoraAdapter) => adapter.name));
        const unknownAdapter = enabledAdapters.find((name: string) => !availableNames.has(name));
        if (unknownAdapter) {
          return { status: 400, error: `Unknown or invalid LoRA adapter: ${unknownAdapter}` };
        }

        saveVllmLoraConfig(profilePaths.etc, {
          enabledAdapters,
          maxLoraRank,
          maxLoras,
          maxCpuLoras,
          loraDtype,
        }, user.username);

        // Needs restart if the enabled set is different from loaded set
        const enabledSet = new Set(enabledAdapters);
        const loadedSet = new Set(loadedLoras);
        needsRestart = enabledAdapters.some((a: string) => !loadedSet.has(a)) ||
                       loadedLoras.some(a => !enabledSet.has(a));
        break;
      }

      default:
        return { status: 400, error: 'Invalid action. Must be "enable", "disable", or "set"' };
    }

    // Return updated config
    const config = getVllmLoraConfig(profilePaths.etc);

    return successResponse({
      success: true,
      needsRestart,
      config,
    });
  } catch (error) {
    console.error('[vllm-loras] PUT failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
