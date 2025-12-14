/**
 * Local Models API Handlers
 *
 * API endpoints for the local-model-service (Transformers.js).
 * Handles config, status, model download, and service control.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports to avoid circular dependencies
let isLocalModelServiceRunning: any;
let getLocalModelStatus: any;
let getAvailableLocalModels: any;
let downloadLocalModel: any;
let loadLocalModel: any;
let unloadLocalModel: any;
let loadBackendConfig: any;
let saveBackendConfig: any;
let startLocalModelService: any;
let stopLocalModelService: any;
let loadLocalModelsConfig: any;

async function ensureLocalModelsFunctions(): Promise<boolean> {
  try {
    const localModels = await import('../../providers/local-models.js');
    isLocalModelServiceRunning = localModels.isLocalModelServiceRunning;
    getLocalModelStatus = localModels.getLocalModelStatus;
    getAvailableLocalModels = localModels.getAvailableLocalModels;
    downloadLocalModel = localModels.downloadLocalModel;
    loadLocalModel = localModels.loadLocalModel;
    unloadLocalModel = localModels.unloadLocalModel;

    const backend = await import('../../llm-backend.js');
    loadBackendConfig = backend.loadBackendConfig;
    saveBackendConfig = backend.saveBackendConfig;

    const manager = await import('../../local-model-service-manager.js');
    startLocalModelService = manager.startLocalModelService;
    stopLocalModelService = manager.stopLocalModelService;
    loadLocalModelsConfig = manager.loadLocalModelsConfig;

    return !!(isLocalModelServiceRunning && loadBackendConfig);
  } catch (error) {
    console.error('[local-models-handler] Failed to load dependencies:', error);
    return false;
  }
}

/**
 * GET /api/local-models/status - Get local model service status
 */
export async function handleGetLocalModelsStatus(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const config = loadBackendConfig();
    const localModelsConfig = config.localModels;
    const endpoint = localModelsConfig?.endpoint || 'http://127.0.0.1:4324';

    const running = await isLocalModelServiceRunning(endpoint);
    let loadedModels = null;

    if (running) {
      loadedModels = await getLocalModelStatus(endpoint);
    }

    return successResponse({
      running,
      endpoint,
      enabled: localModelsConfig?.enabled ?? true,
      autoStart: localModelsConfig?.autoStart ?? false,
      downloadOnWifiOnly: localModelsConfig?.downloadOnWifiOnly ?? true,
      loadedModels,
      config: {
        embeddings: localModelsConfig?.embeddings ?? { model: 'qwen3-embedding-0.6b', preloadAtStartup: true },
        llm: localModelsConfig?.llm ?? { model: 'qwen3-1.7b', preloadAtStartup: false },
      },
    });
  } catch (error) {
    console.error('[local-models] GET status failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * GET /api/local-models/config - Get local models configuration
 */
export async function handleGetLocalModelsConfig(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const config = loadBackendConfig();
    return successResponse({
      localModels: config.localModels ?? {
        enabled: true,
        endpoint: 'http://127.0.0.1:4324',
        autoStart: false,
        downloadOnWifiOnly: true,
        embeddings: { model: 'qwen3-embedding-0.6b', preloadAtStartup: true },
        llm: { model: 'qwen3-1.7b', preloadAtStartup: false },
      },
    });
  } catch (error) {
    console.error('[local-models] GET config failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/local-models/config - Update local models configuration
 */
export async function handleSetLocalModelsConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const updates = req.body?.localModels;
    if (!updates) {
      return { status: 400, error: 'Missing localModels in request body' };
    }

    const config = loadBackendConfig();
    const currentLocalModels = config.localModels ?? {};

    // Merge updates with current config
    const newLocalModels = {
      ...currentLocalModels,
      ...updates,
      embeddings: updates.embeddings
        ? { ...currentLocalModels.embeddings, ...updates.embeddings }
        : currentLocalModels.embeddings,
      llm: updates.llm
        ? { ...currentLocalModels.llm, ...updates.llm }
        : currentLocalModels.llm,
    };

    saveBackendConfig({ localModels: newLocalModels });

    return successResponse({ localModels: newLocalModels });
  } catch (error) {
    console.error('[local-models] PUT config failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * GET /api/local-models/models - List available models with download status
 */
export async function handleGetLocalModelsAvailable(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const config = loadBackendConfig();
    const endpoint = config.localModels?.endpoint || 'http://127.0.0.1:4324';

    const running = await isLocalModelServiceRunning(endpoint);
    if (!running) {
      // Return static list if service not running
      return successResponse({
        embeddings: [
          { id: 'qwen3-embedding-0.6b', size: '560MB', dimensions: 1024, downloaded: false },
          { id: 'qwen3-embedding-4b', size: '2.5GB', dimensions: 1024, downloaded: false },
          { id: 'all-MiniLM-L6-v2', size: '23MB', dimensions: 384, downloaded: false },
        ],
        llm: [
          { id: 'qwen3-1.7b', size: '1.2GB', downloaded: false },
          { id: 'qwen2-0.5b', size: '400MB', downloaded: false },
          { id: 'tinyllama', size: '600MB', downloaded: false },
        ],
        serviceRunning: false,
      });
    }

    const models = await getAvailableLocalModels(endpoint);
    return successResponse({
      ...models,
      serviceRunning: true,
    });
  } catch (error) {
    console.error('[local-models] GET models failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/local-models/download - Start downloading a model
 */
export async function handleDownloadLocalModel(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const { type, model } = req.body || {};
    if (!type || !model) {
      return { status: 400, error: 'Missing type or model in request body' };
    }

    if (type !== 'embeddings' && type !== 'llm') {
      return { status: 400, error: 'Type must be "embeddings" or "llm"' };
    }

    const config = loadBackendConfig();
    const endpoint = config.localModels?.endpoint || 'http://127.0.0.1:4324';

    const running = await isLocalModelServiceRunning(endpoint);
    if (!running) {
      return { status: 503, error: 'Local model service not running. Start it first.' };
    }

    const result = await downloadLocalModel(type, model, endpoint);
    return successResponse(result);
  } catch (error) {
    console.error('[local-models] POST download failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/local-models/load - Load a specific model
 */
export async function handleLoadLocalModel(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const { type, model } = req.body || {};
    if (!type || !model) {
      return { status: 400, error: 'Missing type or model in request body' };
    }

    const config = loadBackendConfig();
    const endpoint = config.localModels?.endpoint || 'http://127.0.0.1:4324';

    const running = await isLocalModelServiceRunning(endpoint);
    if (!running) {
      return { status: 503, error: 'Local model service not running' };
    }

    const result = await loadLocalModel(type, model, endpoint);
    return successResponse(result);
  } catch (error) {
    console.error('[local-models] POST load failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/local-models/unload - Unload a model to free memory
 */
export async function handleUnloadLocalModel(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const { type } = req.body || {};
    if (!type) {
      return { status: 400, error: 'Missing type in request body' };
    }

    const config = loadBackendConfig();
    const endpoint = config.localModels?.endpoint || 'http://127.0.0.1:4324';

    const running = await isLocalModelServiceRunning(endpoint);
    if (!running) {
      return { status: 503, error: 'Local model service not running' };
    }

    const result = await unloadLocalModel(type, endpoint);
    return successResponse(result);
  } catch (error) {
    console.error('[local-models] POST unload failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/local-models/start - Start the local model service
 */
export async function handleStartLocalModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    const config = loadLocalModelsConfig();
    const endpoint = config.endpoint;

    // Check if already running
    const running = await isLocalModelServiceRunning(endpoint);
    if (running) {
      return successResponse({ status: 'already_running', endpoint });
    }

    // Get models directory (default to profile-based location)
    const modelsDir = req.body?.modelsDir || './models';

    const success = await startLocalModelService({
      modelsDir,
      preloadEmbeddings: config.embeddings.preloadAtStartup,
      preloadLLM: config.llm.preloadAtStartup,
    });

    if (!success) {
      return { status: 500, error: 'Failed to start local model service' };
    }

    return successResponse({ status: 'started', endpoint });
  } catch (error) {
    console.error('[local-models] POST start failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/local-models/stop - Stop the local model service
 */
export async function handleStopLocalModels(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureLocalModelsFunctions();
    if (!available) {
      return { status: 501, error: 'Local models functions not available' };
    }

    await stopLocalModelService();
    return successResponse({ status: 'stopped' });
  } catch (error) {
    console.error('[local-models] POST stop failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
