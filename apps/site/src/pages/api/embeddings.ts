/**
 * Embeddings Config API - GET/POST /api/embeddings
 *
 * Manages embeddings.json config including indexContentMode.
 * Separate from embeddings-control which manages the backend config.
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser } from '@metahuman/core';

const ROOT = process.env.METAHUMAN_ROOT || path.resolve(process.cwd());
const EMBEDDINGS_CONFIG_PATH = path.join(ROOT, 'etc', 'embeddings.json');

interface EmbeddingsConfig {
  enabled?: boolean;
  model?: string;
  provider?: string;
  preloadAtStartup?: boolean;
  description?: string;
  localModels?: {
    endpoint?: string;
    model?: string;
  };
  indexContentMode?: 'user' | 'all' | 'agent';
  indexContentModeOptions?: Record<string, string>;
}

function loadConfig(): EmbeddingsConfig {
  try {
    const raw = fs.readFileSync(EMBEDDINGS_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { indexContentMode: 'user' };
  }
}

function saveConfig(config: EmbeddingsConfig): void {
  fs.writeFileSync(EMBEDDINGS_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * GET /api/embeddings - Read embeddings config
 */
export const GET: APIRoute = async () => {
  // Anyone can read the config (no auth required for GET)
  try {
    const config = loadConfig();
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[embeddings] GET error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * POST /api/embeddings - Update embeddings config (authenticated users only)
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owners can update config
    if (user.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Owner role required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const currentConfig = loadConfig();

    // Only update fields that are provided
    const updatedConfig: EmbeddingsConfig = { ...currentConfig };

    if (typeof body.indexContentMode === 'string') {
      if (['user', 'all', 'agent'].includes(body.indexContentMode)) {
        updatedConfig.indexContentMode = body.indexContentMode;
      }
    }

    saveConfig(updatedConfig);

    return new Response(JSON.stringify({
      success: true,
      config: updatedConfig
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if ((error as Error).message?.includes('Authentication required')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    console.error('[embeddings] POST error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
