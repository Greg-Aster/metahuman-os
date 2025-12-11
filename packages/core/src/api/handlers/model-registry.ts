/**
 * Model Registry API Handlers
 *
 * Manages user's model registry for role assignments.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * CRITICAL: User's models.json is the ONLY source of truth.
 * System etc/models.json is ONLY used for one-time initialization of new users.
 * NEVER fall back to system config for existing users.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getProfilePaths, systemPaths, audit, loadBackendConfig, storageClient, getBackendStatus } from '../../index.js';
import { invalidateModelCache } from '../../model-resolver.js';
// NOTE: invalidateStatusCache was removed - statusCache no longer exists (was redundant)
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
 * Ensure user has their own models.json registry.
 * If not, initialize from system defaults (ONE-TIME only).
 *
 * CRITICAL: After this initialization, NEVER read from system registry again.
 * User's models.json is the ONLY source of truth.
 */
function ensureUserRegistry(username: string): void {
  const userPath = resolveModelsPath(username);

  if (fs.existsSync(userPath)) {
    // User already has a registry - do nothing
    return;
  }

  // Copy from system registry ONE TIME
  const systemPath = path.join(systemPaths.etc, 'models.json');
  let userRegistry: any = {
    version: '1.0.0',
    globalSettings: {},
    defaults: {},
    models: {},
    roleHierarchy: {},
    cognitiveModeMappings: {},
    providers: {}
  };

  if (fs.existsSync(systemPath)) {
    try {
      const systemRegistry = JSON.parse(fs.readFileSync(systemPath, 'utf-8'));

      // Copy structure from system registry
      userRegistry = {
        version: systemRegistry.version || '1.0.0',
        globalSettings: { ...(systemRegistry.globalSettings || {}) },
        defaults: { ...(systemRegistry.defaults || {}) },
        models: { ...(systemRegistry.models || {}) },
        roleHierarchy: { ...(systemRegistry.roleHierarchy || {}) },
        cognitiveModeMappings: { ...(systemRegistry.cognitiveModeMappings || {}) },
        providers: { ...(systemRegistry.providers || {}) }
      };

      // Remove system warning fields
      delete userRegistry._WARNING;
      delete userRegistry._WARNING2;
      delete userRegistry._WARNING3;
      delete userRegistry._WARNING4;
      delete userRegistry._WARNING5;
      delete userRegistry._WARNING6;

    } catch (err) {
      console.error('[model-registry] Failed to read system registry for initialization:', err);
    }
  }

  // Create directory and write user's registry
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, JSON.stringify(userRegistry, null, 2));
}

/**
 * Read model registry from user's profile
 */
function readModelRegistry(username: string) {
  // Ensure user has their own registry (one-time initialization)
  ensureUserRegistry(username);

  try {
    const p = resolveModelsPath(username);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    console.error('[model-registry] Failed to read registry:', e);
  }

  // This should rarely happen after ensureUserRegistry
  console.warn('[model-registry] No registry found after initialization - returning empty');
  return { globalSettings: {}, defaults: {}, models: {}, cognitiveModeMappings: {}, roleHierarchy: {} };
}

/**
 * Write model registry to user's profile
 */
async function writeModelRegistry(username: string, registry: any) {
  const p = resolveModelsPath(username);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(registry, null, 2));
  // Invalidate model cache to force reload
  invalidateModelCache();
}

const ALL_ROLES = ['persona', 'orchestrator', 'coder', 'planner', 'curator', 'summarizer', 'fallback'];

/**
 * GET /api/model-registry - Get model registry (owner or standard)
 */
export async function handleGetModelRegistry(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Allow authenticated users (owner or standard) to view model registry
    // Note: isAuthenticated check above already excludes guest/anonymous

    // CRITICAL: Read ONLY from user's registry (initialized from system on first access)
    // DO NOT fall back to system registry here
    const registry = readModelRegistry(user.username);

    // Get ACTUAL backend status (checks if servers are running)
    const backendStatus = await getBackendStatus();

    // Process user registry models - this is the ONLY source of truth
    const availableModels = Object.entries(registry.models || {})
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
        source: 'user-registry' as const
      }));

    // Extract base role assignments (defaults)
    const defaults = registry.defaults || {};
    const cognitiveModeMappings = registry.cognitiveModeMappings || {};

    // Get current cognitive mode from query param
    const currentMode = query?.cognitiveMode as string | undefined;

    // Compute EFFECTIVE role assignments:
    // Start with defaults, then overlay cognitive mode specific mappings
    // This ensures the UI shows what will ACTUALLY be used
    let roleAssignments = { ...defaults };
    if (currentMode && cognitiveModeMappings[currentMode]) {
      roleAssignments = { ...defaults, ...cognitiveModeMappings[currentMode] };
    }
    const globalSettings = registry.globalSettings || {};

    // Use RESOLVED backend (what's actually running), not just configured
    const activeBackend = backendStatus.backend;
    const resolvedBackend = backendStatus.resolvedBackend;
    const isVLLMRunning = resolvedBackend === 'vllm';
    const isOllamaRunning = resolvedBackend === 'ollama';

    // Local model info - ONLY for vLLM since it runs ONE model at a time
    // Ollama doesn't need this since users can select any model
    let localModel: {
      id: string;
      name: string;
      provider: 'ollama' | 'vllm';
      locked: boolean;
    } | null = null;

    if (isVLLMRunning && backendStatus.model) {
      localModel = {
        id: 'vllm.active',
        name: backendStatus.model,
        provider: 'vllm',
        locked: true
      };
    }

    // Model categories - only show local models if the server is actually running
    const cloudProviderSet = new Set(['runpod_serverless', 'huggingface', 'openai', 'openrouter']);
    const bigBrotherProviders = new Set(['claude-code', 'anthropic']);

    const modelCategories = {
      // Local models: vLLM shows the locked model, Ollama shows all ollama models IF running
      local: isVLLMRunning
        ? [{ id: 'vllm.active', model: backendStatus.model || 'unknown', provider: 'vllm', locked: true }]
        : isOllamaRunning
          ? availableModels.filter(m => m.provider === 'ollama')
          : [], // No local models if no local server running
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
      resolvedBackend,
      localModel,
      modelCategories
    });
  } catch (error) {
    console.error('[model-registry] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/model-registry - Assign model to role (owner or standard)
 */
export async function handleAssignModelRole(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Allow authenticated users (owner or standard) to modify their model registry
    // Note: isAuthenticated check above already excludes guest/anonymous

    const { role, modelId, cognitiveMode } = body || {};

    if (!role || !modelId) {
      return { status: 400, error: 'role and modelId are required' };
    }

    // CRITICAL: User's registry is the ONLY source of truth (initialized from system on first access)
    const registry = readModelRegistry(user.username);
    registry.models = registry.models || {};

    // Auto-register runtime-discovered models that aren't in user's registry
    // NO SYSTEM REGISTRY FALLBACK - only dynamic discovery types
    if (!registry.models[modelId]) {

      if (modelId.startsWith('vllm.')) {
        // vLLM model - runtime discovery
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
        // LoRA adapter - runtime discovery
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
      } else if (modelId.startsWith('ollama.')) {
        // Ollama model - runtime discovery
        const inferredName = modelId.replace(/^ollama\./, '');
        registry.models[modelId] = {
          provider: 'ollama',
          model: inferredName,
          roles: [role],
          adapters: [],
          description: `Ollama model ${inferredName}`,
          options: {},
          metadata: { source: 'ollama-discovery' }
        };
      } else {
        // Unknown model ID - should already be in user's registry
        // User's registry was initialized from system, so cloud models should be there
        console.error(`[model-registry] Model ${modelId} not found in user registry`);
        return { status: 400, error: `Model ${modelId} not found in your model registry` };
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
 * PUT /api/model-registry - Update global settings (owner or standard)
 */
export async function handleUpdateModelSettings(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Allow authenticated users (owner or standard) to modify their own settings
    // Note: isAuthenticated check above already excludes guest/anonymous

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
