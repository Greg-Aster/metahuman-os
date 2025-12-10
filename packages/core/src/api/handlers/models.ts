/**
 * Models API Handlers
 *
 * GET/POST model configuration and LoRA adapters.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { systemPaths, getProfilePaths } from '../../paths.js';

// Dynamic imports
let OllamaClient: any;
let listAdapterDatasets: any;
let getActiveAdapter: any;
let loadBackendConfig: any;
let storageClient: any;

async function ensureModelFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    OllamaClient = core.OllamaClient;
    listAdapterDatasets = core.listAdapterDatasets;
    getActiveAdapter = core.getActiveAdapter;
    loadBackendConfig = core.loadBackendConfig;
    storageClient = core.storageClient;
    return !!(listAdapterDatasets && getActiveAdapter && loadBackendConfig);
  } catch {
    return false;
  }
}

function resolveModelsPath(username: string): string {
  if (storageClient) {
    const result = storageClient.resolvePath({
      username,
      category: 'config',
      subcategory: 'etc',
      relativePath: 'models.json',
    });
    if (result.success && result.path) {
      return result.path;
    }
  }
  // Fallback to profile path
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.etc, 'models.json');
}

function readModelRegistry(username: string) {
  try {
    const p = resolveModelsPath(username);
    if (!existsSync(p)) {
      return { globalSettings: {}, defaults: {}, models: {} };
    }
    const data = require('fs').readFileSync(p, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { globalSettings: {}, defaults: {}, models: {} };
  }
}

function writeModelRegistry(username: string, registry: any) {
  const p = resolveModelsPath(username);
  require('fs').mkdirSync(path.dirname(p), { recursive: true });
  require('fs').writeFileSync(p, JSON.stringify(registry, null, 2));
}

/**
 * GET /api/models - Get model configuration
 */
export async function handleGetModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required to access system model configuration' };
    }

    const available = await ensureModelFunctions();
    if (!available) {
      return { status: 501, error: 'Model functions not available' };
    }

    const registry = readModelRegistry(user.username);
    const globalSettings = registry.globalSettings || {};
    const backendConfig = loadBackendConfig();
    let baseModels: string[] = [];

    // Only fetch Ollama models when Ollama is the active backend
    if (backendConfig.activeBackend === 'ollama' && OllamaClient) {
      try {
        const ollama = new OllamaClient();
        const tags = await ollama.listModels();
        baseModels = tags.map((m: any) => m.name);
      } catch {
        // Ignore Ollama errors
      }
    }

    const loras = listAdapterDatasets().map((d: any) => ({
      date: d.date,
      status: d.status,
      evalScore: d.evalScore,
    }));

    const dualAvailable = existsSync(
      path.join(systemPaths.out, 'adapters', 'history-merged', 'adapter-merged.gguf')
    );

    const active = getActiveAdapter();

    return successResponse({
      success: true,
      agent: globalSettings,
      baseModels,
      loras,
      active,
      dualAvailable,
    });
  } catch (error) {
    console.error('[models] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/models - Update model configuration
 */
export async function handleSetModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required to modify system model configuration' };
    }

    const baseModel = body?.baseModel;
    if (!baseModel) {
      return { status: 400, error: 'baseModel is required' };
    }

    const registry = readModelRegistry(user.username);

    // Update fallback model in defaults
    const fallbackId = registry.defaults?.fallback || 'default.fallback';
    if (registry.models?.[fallbackId]) {
      registry.models[fallbackId].model = baseModel;
    }

    writeModelRegistry(user.username, registry);

    return successResponse({
      success: true,
      agent: registry.globalSettings || {},
    });
  } catch (error) {
    console.error('[models] POST failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
