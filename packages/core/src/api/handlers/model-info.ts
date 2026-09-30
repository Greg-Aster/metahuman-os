/**
 * Model Info API Handlers
 *
 * Unified handlers for current model and LoRA adapter information.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getActiveAdapter } from '../../adapters.js';
import { resolveModel } from '../../model-resolver.js';

/**
 * GET /api/model-info - Get current model and adapter info
 */
export async function handleGetModelInfo(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;
  if (!user.isAuthenticated) return { status: 401, error: 'Authentication required' };

  try {
    const model = resolveModel('persona', undefined, user.username);
    let baseModel = model.model;

    // Get active adapter info
    let adapter: any = null;
    const active = getActiveAdapter(user.username);
    if (active) {
      adapter = {
        name: active.modelName,
        runLabel: active.runLabel,
        dataset: active.dataset,
        activatedAt: active.activatedAt,
        adapterPath: active.adapterPath ?? active.ggufAdapterPath,
      };
      if (active.baseModel) {
        baseModel = active.baseModel;
      }
    }

    return successResponse({
      baseModel,
      adapter,
      activeModel: model.model,
    });
  } catch (error) {
    console.error('[model-info] GET error:', error);
    return { status: 500, error: 'Failed to get model info' };
  }
}
