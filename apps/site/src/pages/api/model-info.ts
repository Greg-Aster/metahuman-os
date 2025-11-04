/**
 * API endpoint to get current model and LoRA adapter information
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, getActiveAdapter } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    // Get base model from config
    let baseModel = 'phi3:mini';
    try {
      const configPath = path.join(paths.root, 'etc', 'agent.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      baseModel = config.baseModel || config.model || 'phi3:mini';
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

    // Get actual base model from Ollama if adapter is loaded
    let actualBaseModel = baseModel;
    if (adapter?.name) {
      // The active model is using an adapter, so show the base it's built on
      // Default to dolphin-mistral since that's what we use
      actualBaseModel = process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest';
    }

    return new Response(
      JSON.stringify({
        baseModel: actualBaseModel,
        adapter,
        adapter2,
        activeModel: adapter?.name || baseModel,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to get model info' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};
