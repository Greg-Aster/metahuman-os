import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import {
  loadEmbeddingConfig,
  saveEmbeddingConfig,
  preloadEmbeddingModel,
  type EmbeddingConfig,
} from '@metahuman/core/embeddings';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owner can view embedding settings
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - owner only' }),
        { status: 403 }
      );
    }

    const config = loadEmbeddingConfig();

    return new Response(
      JSON.stringify(config),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 401 }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owner can modify embedding settings
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - owner only' }),
        { status: 403 }
      );
    }

    const body = await request.json();
    const currentConfig = loadEmbeddingConfig();

    // Merge updates with current config
    const updatedConfig: EmbeddingConfig = {
      ...currentConfig,
      ...(typeof body.enabled === 'boolean' && { enabled: body.enabled }),
      ...(typeof body.model === 'string' && { model: body.model }),
      ...(typeof body.provider === 'string' && { provider: body.provider }),
      ...(typeof body.preloadAtStartup === 'boolean' && {
        preloadAtStartup: body.preloadAtStartup,
      }),
      ...(typeof body.cpuOnly === 'boolean' && { cpuOnly: body.cpuOnly }),
    };

    saveEmbeddingConfig(updatedConfig);

    // If preload requested, trigger it now
    if (body.preloadNow === true && updatedConfig.enabled) {
      preloadEmbeddingModel().catch((err) => {
        console.error('[embeddings-control] Preload failed:', err);
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        config: updatedConfig,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500 }
    );
  }
};
