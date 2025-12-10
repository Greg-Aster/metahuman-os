/**
 * Model Info API Handlers
 *
 * Unified handlers for current model and LoRA adapter information.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getActiveAdapter } from '../../adapters.js';
import { loadModelRegistry } from '../../model-resolver.js';

/**
 * GET /api/model-info - Get current model and adapter info
 */
export async function handleGetModelInfo(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Get base model from model registry (user-specific if authenticated)
    let baseModel = 'phi3:mini';
    try {
      const username = user.isAuthenticated ? user.username : undefined;
      const registry = loadModelRegistry(false, username);
      const fallbackId = registry.defaults?.fallback || 'default.fallback';
      const fallbackModel = registry.models?.[fallbackId];
      baseModel = fallbackModel?.model || 'phi3:mini';
    } catch {
      // Use default if config not found
    }

    // Get active adapter info
    let adapter: any = null;
    let adapter2: any = null;
    const active = getActiveAdapter();
    if (active && active.status === 'loaded') {
      adapter = {
        name: active.modelName,
        dataset: active.dataset,
        evalScore: active.evalScore,
        activatedAt: active.activatedAt,
        adapterPath: active.adapterPath ?? active.ggufAdapterPath,
      };
      if (active.isDualAdapter || active.dual) {
        adapter2 = {
          name: 'history-merged',
          mergedPath: active.mergedPath ?? active.adapters?.historical,
        };
      }
      if (active.baseModel) {
        baseModel = active.baseModel;
      }
    }

    // Get actual base model from env if adapter is loaded
    let actualBaseModel = baseModel;
    if (adapter?.name) {
      // The active model is using an adapter, so show the base it's built on
      actualBaseModel = process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest';
    }

    return successResponse({
      baseModel: actualBaseModel,
      adapter,
      adapter2,
      activeModel: adapter?.name || baseModel,
    });
  } catch (error) {
    console.error('[model-info] GET error:', error);
    return { status: 500, error: 'Failed to get model info' };
  }
}
