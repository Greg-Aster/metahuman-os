/**
 * Model Registry API Handlers
 *
 * Manages user's model registry for role assignments.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getProfilePaths, systemPaths, audit, loadBackendConfig, storageClient } from '../../index.js';
import { invalidateModelCache } from '../../model-resolver.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve models.json path for a user
 */
function resolveModelsPath(username: string): string {
  const result = storageClient.resolvePath({
    username,
    category: 'config',
    subcategory: 'etc',
    relativePath: 'models.json',
  });
  if (result.success && result.path) {
    return result.path;
  }
  // Fallback to profile path
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.etc, 'models.json');
}

/**
 * Read model registry from user's profile
 */
function readModelRegistry(username: string) {
  try {
    const p = resolveModelsPath(username);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    console.error('[model-registry] Failed to read registry:', e);
  }
  return { globalSettings: {}, defaults: {}, models: {}, cognitiveModeMappings: {}, roleHierarchy: {} };
}

/**
 * Write model registry to user's profile
 */
async function writeModelRegistry(username: string, registry: any) {
  const p = resolveModelsPath(username);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(registry, null, 2));
  // Invalidate cache to force reload
  invalidateModelCache();
}

const ALL_ROLES = ['persona', 'orchestrator', 'coder', 'planner', 'curator', 'summarizer', 'fallback'];

/**
 * GET /api/model-registry - Get model registry (owner only)
 */
export async function handleGetModelRegistry(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required to access model registry' };
    }

    const registry = readModelRegistry(user.username);

    // Load system registry for cloud provider models
    let systemRegistry: any = { models: {} };
    try {
      const systemModelsPath = path.join(systemPaths.etc, 'models.json');
      if (fs.existsSync(systemModelsPath)) {
        systemRegistry = JSON.parse(fs.readFileSync(systemModelsPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[model-registry] Failed to load system models.json:', err);
    }

    // Get backend config
    const backendConfig = loadBackendConfig();

    // Build available models list from registry
    const cloudProviders = ['runpod_serverless', 'huggingface', 'openai', 'openrouter'];

    // Process user registry models
    const registryModels = Object.entries(registry.models || {})
      .filter(([_id, config]: [string, any]) => {
        // Cloud providers are always valid
        if (cloudProviders.includes(config.provider)) {
          return true;
        }
        // Local providers - just include them
        return true;
      })
      .map(([id, config]: [string, any]) => ({
        id,
        provider: config.provider,
        model: config.model,
        roles: Array.from(new Set(config.roles || [])),
        description: config.description || '',
        adapters: config.adapters || [],
        baseModel: config.baseModel || null,
        metadata: config.metadata || {},
        options: config.options || {},
        source: 'registry' as const
      }));

    // Add cloud models from system registry that aren't in user registry
    const userModelIds = new Set(registryModels.map(m => m.id));
    const systemCloudModels = Object.entries(systemRegistry.models || {})
      .filter(([id, config]: [string, any]) => {
        if (!cloudProviders.includes(config.provider)) return false;
        if (userModelIds.has(id)) return false;
        return true;
      })
      .map(([id, config]: [string, any]) => ({
        id,
        provider: config.provider,
        model: config.model,
        roles: Array.from(new Set(config.roles || [])),
        description: config.description || '',
        adapters: config.adapters || [],
        baseModel: config.baseModel || null,
        metadata: config.metadata || {},
        options: config.options || {},
        source: 'system' as const
      }));

    const availableModels = [...registryModels, ...systemCloudModels];

    // Extract role assignments
    const roleAssignments = registry.defaults || {};
    const cognitiveModeMappings = registry.cognitiveModeMappings || {};
    const globalSettings = registry.globalSettings || {};

    // Backend info
    const activeBackend = backendConfig.activeBackend;
    const isVLLMActive = activeBackend === 'vllm';

    // Local model info
    let localModel: {
      id: string;
      name: string;
      provider: 'ollama' | 'vllm';
      locked: boolean;
    };

    if (isVLLMActive) {
      localModel = {
        id: 'vllm.active',
        name: backendConfig.vllm?.model || 'unknown',
        provider: 'vllm',
        locked: true
      };
    } else {
      const defaultOllamaModel = backendConfig.ollama?.defaultModel || 'phi3:mini';
      localModel = {
        id: `ollama.${defaultOllamaModel}`,
        name: defaultOllamaModel,
        provider: 'ollama',
        locked: false
      };
    }

    // Model categories
    const cloudProviderSet = new Set(['runpod_serverless', 'huggingface', 'openai', 'openrouter']);
    const bigBrotherProviders = new Set(['claude-code', 'anthropic']);

    const modelCategories = {
      local: isVLLMActive
        ? [{ id: 'vllm.active', model: backendConfig.vllm?.model || 'unknown', provider: 'vllm', locked: true }]
        : availableModels.filter(m => m.provider === 'ollama'),
      lora: [],
      remote: availableModels.filter(m => cloudProviderSet.has(m.provider)),
      bigBrother: availableModels.filter(m => bigBrotherProviders.has(m.provider))
    };

    await audit({
      category: 'action',
      level: 'info',
      action: 'model_registry_view',
      actor: user.username,
      context: {
        userId: user.id,
        activeBackend
      }
    });

    return successResponse({
      success: true,
      availableModels,
      roleAssignments,
      cognitiveModeMappings,
      globalSettings,
      version: registry.version || '1.0.0',
      activeBackend,
      localModel,
      modelCategories
    });
  } catch (error) {
    console.error('[model-registry] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/model-registry - Assign model to role (owner only)
 */
export async function handleAssignModelRole(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required to modify model registry' };
    }

    const { role, modelId, cognitiveMode } = body || {};

    if (!role || !modelId) {
      return { status: 400, error: 'role and modelId are required' };
    }

    const registry = readModelRegistry(user.username);
    registry.models = registry.models || {};

    // Auto-register models that aren't in user's registry
    if (!registry.models[modelId]) {
      // Check system registry for cloud models
      let systemModelConfig: any = null;
      try {
        const systemModelsPath = path.join(systemPaths.etc, 'models.json');
        if (fs.existsSync(systemModelsPath)) {
          const systemRegistry = JSON.parse(fs.readFileSync(systemModelsPath, 'utf-8'));
          if (systemRegistry.models && systemRegistry.models[modelId]) {
            systemModelConfig = systemRegistry.models[modelId];
          }
        }
      } catch (err) {
        console.error('[model-registry] Failed to check system registry:', err);
      }

      if (systemModelConfig) {
        // Copy from system registry (preserves cloud provider)
        registry.models[modelId] = {
          provider: systemModelConfig.provider,
          model: systemModelConfig.model,
          roles: [role],
          adapters: systemModelConfig.adapters || [],
          description: systemModelConfig.description || `Imported from system registry`,
          options: systemModelConfig.options || {},
          metadata: { ...systemModelConfig.metadata, source: 'system-registry' }
        };
      } else if (modelId.startsWith('vllm.')) {
        // vLLM model
        const backendConfig = loadBackendConfig();
        registry.models[modelId] = {
          provider: 'vllm',
          model: backendConfig.vllm?.model || 'unknown',
          roles: [role],
          adapters: [],
          description: `vLLM backend model`,
          options: {},
          metadata: { source: 'vllm-backend', locked: true }
        };
      } else if (modelId.startsWith('lora.')) {
        // LoRA adapter
        const adapterName = modelId.replace(/^lora\./, '');
        const backendConfig = loadBackendConfig();
        const baseModel = backendConfig.activeBackend === 'vllm'
          ? backendConfig.vllm?.model
          : backendConfig.ollama?.defaultModel;

        registry.models[modelId] = {
          provider: backendConfig.activeBackend || 'ollama',
          model: adapterName,
          baseModel: baseModel,
          roles: [role],
          adapters: [],
          description: `LoRA adapter: ${adapterName}`,
          options: {},
          metadata: { source: 'lora-discovery' }
        };
      } else {
        // Assume Ollama model
        const isOllamaModel = modelId.startsWith('ollama.');
        const inferredName = isOllamaModel ? modelId.replace(/^ollama\./, '') : modelId;

        registry.models[modelId] = {
          provider: 'ollama',
          model: inferredName,
          roles: [role],
          adapters: [],
          description: `Ollama model ${inferredName}`,
          options: {},
          metadata: { source: 'ollama-discovery' }
        };
      }
    }

    // Ensure role list includes this role
    const entry = registry.models[modelId];
    if (!Array.isArray(entry.roles)) {
      entry.roles = [];
    }
    if (!entry.roles.includes(role)) {
      entry.roles.push(role);
    }

    // Update cognitive mode mapping or default role assignment
    if (cognitiveMode) {
      registry.cognitiveModeMappings = registry.cognitiveModeMappings || {};
      registry.cognitiveModeMappings[cognitiveMode] = registry.cognitiveModeMappings[cognitiveMode] || {};
      registry.cognitiveModeMappings[cognitiveMode][role] = modelId;
    } else {
      registry.defaults = registry.defaults || {};
      registry.defaults[role] = modelId;
    }

    await writeModelRegistry(user.username, registry);

    await audit({
      category: 'data_change',
      level: 'info',
      action: 'model_role_updated',
      actor: user.username,
      context: {
        userId: user.id,
        role,
        modelId,
        cognitiveMode: cognitiveMode || 'default',
        profilePath: resolveModelsPath(user.username)
      }
    });

    return successResponse({
      success: true,
      message: `Role ${role} assigned to model ${modelId}`,
      registry: {
        availableModels: Object.keys(registry.models || {}),
        roleAssignments: registry.defaults,
        cognitiveModeMappings: registry.cognitiveModeMappings
      }
    });
  } catch (error) {
    console.error('[model-registry] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/model-registry - Update global settings (owner only)
 */
export async function handleUpdateModelSettings(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required to modify global settings' };
    }

    const { globalSettings } = body || {};

    if (!globalSettings) {
      return { status: 400, error: 'globalSettings object is required' };
    }

    const registry = readModelRegistry(user.username);

    // Merge global settings
    registry.globalSettings = {
      ...(registry.globalSettings || {}),
      ...globalSettings
    };

    await writeModelRegistry(user.username, registry);

    await audit({
      category: 'data_change',
      level: 'info',
      action: 'model_global_settings_updated',
      actor: user.username,
      context: {
        userId: user.id,
        settings: globalSettings,
        profilePath: resolveModelsPath(user.username)
      }
    });

    return successResponse({
      success: true,
      message: 'Global settings updated',
      globalSettings: registry.globalSettings
    });
  } catch (error) {
    console.error('[model-registry] PUT error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
