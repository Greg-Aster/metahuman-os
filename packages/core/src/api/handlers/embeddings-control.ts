/**
 * Embeddings Control API Handlers
 *
 * Unified handlers for embedding configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  loadEmbeddingConfig,
  saveEmbeddingConfig,
  preloadEmbeddingModel,
  type EmbeddingConfig,
} from '../../embeddings.js';

/**
 * GET /api/embeddings-control - Get embedding configuration (owner only)
 */
export async function handleGetEmbeddingsControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required' };
  }

  try {
    const config = loadEmbeddingConfig();
    return successResponse(config);
  } catch (error) {
    console.error('[embeddings-control] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/embeddings-control - Update embedding configuration (owner only)
 */
export async function handleSetEmbeddingsControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required' };
  }

  try {
    const currentConfig = loadEmbeddingConfig();

    // Merge updates with current config
    const updatedConfig: EmbeddingConfig = {
      ...currentConfig,
      ...(typeof body?.enabled === 'boolean' && { enabled: body.enabled }),
      ...(typeof body?.model === 'string' && { model: body.model }),
      ...(typeof body?.provider === 'string' && { provider: body.provider }),
      ...(typeof body?.preloadAtStartup === 'boolean' && {
        preloadAtStartup: body.preloadAtStartup,
      }),
      ...(typeof body?.cpuOnly === 'boolean' && { cpuOnly: body.cpuOnly }),
    };

    saveEmbeddingConfig(updatedConfig);

    // If preload requested, trigger it now
    if (body?.preloadNow === true && updatedConfig.enabled) {
      preloadEmbeddingModel().catch((err) => {
        console.error('[embeddings-control] Preload failed:', err);
      });
    }

    return successResponse({
      success: true,
      config: updatedConfig,
    });
  } catch (error) {
    console.error('[embeddings-control] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
