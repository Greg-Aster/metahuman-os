/**
 * Model Resolver
 *
 * Resolves model roles to concrete model configurations from the registry.
 * Enables configuration-driven model selection and hot-swapping.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './path-builder.js';
import { storageClient } from './storage-client.js';
import { loadBackendConfig, type BackendType } from './llm-backend.js';

export type ModelRole = 'orchestrator' | 'persona' | 'curator' | 'coder' | 'planner' | 'summarizer' | 'psychotherapist' | 'fallback';
export type ModelProvider = 'ollama' | 'openai' | 'local' | 'runpod_serverless' | 'huggingface' | 'vllm';

export interface ModelDefinition {
  provider: ModelProvider;
  model: string;
  adapters: string[];
  baseModel?: string;
  roles: string[];
  description: string;
  options: {
    contextWindow?: number;
    temperature?: number;
    topP?: number;
    repeatPenalty?: number;
    [key: string]: any;
  };
  metadata?: {
    priority?: 'high' | 'medium' | 'low';
    alwaysLoaded?: boolean;
    estimatedLatency?: 'fast' | 'medium' | 'slow';
    adapterLoadTime?: number;
    trainedOn?: string;
    evalScore?: number;
    [key: string]: any;
  };
}

export interface ModelRegistry {
  version: string;
  description: string;
  globalSettings?: {
    includePersonaSummary?: boolean;
    useAdapter?: boolean;
    activeAdapter?: any;
  };
  defaults: Record<ModelRole, string>;
  models: Record<string, ModelDefinition>;
  roleHierarchy?: Record<ModelRole, string[]>;
  cognitiveModeMappings?: Record<string, any>;
  providers?: Record<ModelProvider, {
    baseUrl: string;
    timeout: number;
    retries: number;
  }>;
}

export interface ResolvedModel {
  id: string;
  provider: ModelProvider;
  model: string;
  adapters: string[];
  baseModel?: string;
  roles: string[];
  options: Record<string, any>;
  metadata: Record<string, any>;
}

const CACHE_TTL = 60000; // 1 minute
const registryCache = new Map<string, { registry: ModelRegistry; timestamp: number }>();

/**
 * Get the active LLM backend (ollama or vllm)
 * Used to ensure model resolution respects the configured backend
 */
function getActiveBackend(): BackendType {
  try {
    const config = loadBackendConfig();
    return config.activeBackend;
  } catch {
    return 'ollama'; // Default fallback
  }
}

/**
 * Apply backend override to resolved model
 * When vLLM is active but model is configured for Ollama, use vLLM's model instead
 * This ensures consistent behavior regardless of how cognitive mode mappings are configured
 */
function applyBackendOverride(resolved: ResolvedModel, registry: ModelRegistry): ResolvedModel {
  const activeBackend = getActiveBackend();

  // If resolved model uses ollama but vLLM is active, check for vllm.active model
  if (activeBackend === 'vllm' && resolved.provider === 'ollama') {
    const vllmModel = registry.models['vllm.active'];
    if (vllmModel) {
      return {
        id: 'vllm.active',
        provider: 'vllm' as ModelProvider,
        model: vllmModel.model,
        adapters: vllmModel.adapters || [],
        baseModel: vllmModel.baseModel,
        roles: vllmModel.roles,
        options: { ...resolved.options, ...vllmModel.options },
        metadata: { ...resolved.metadata, ...vllmModel.metadata, backendOverride: 'vllm' },
      };
    }
  }

  // If resolved model uses vllm but Ollama is active, use default model
  if (activeBackend === 'ollama' && resolved.provider === 'vllm') {
    // Keep the original but the bridge will handle routing to Ollama
    // The model name won't matter since Ollama will use its loaded model
  }

  return resolved;
}

/**
 * Invalidate the model registry cache
 * Call this after updating the registry to force a reload
 */
export function invalidateModelCache(): void {
  registryCache.clear();
}

/**
 * Load and parse the model registry from etc/models.json
 *
 * NOTE: Uses context-aware paths.etc which resolves to:
 * - profiles/{username}/etc/models.json when user context is set
 * - etc/models.json at root when no context is set
 *
 * This allows each user to have their own base models and preferences!
 *
 * @param forceFresh - If true, bypass cache and reload from disk
 * @param username - Optional username to explicitly resolve user's profile path
 */
export function loadModelRegistry(forceFresh = false, username?: string): ModelRegistry {
  const now = Date.now();

  const registryPath = resolveRegistryPath(username);

  if (!forceFresh) {
    const cached = registryCache.get(registryPath);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.registry;
    }
  }

  if (!fs.existsSync(registryPath)) {
    throw new Error(`Model registry not found at ${registryPath}`);
  }

  try {
    const content = fs.readFileSync(registryPath, 'utf-8');
    const registry = JSON.parse(content) as ModelRegistry;

    // Validate required fields
    if (!registry.defaults || !registry.models) {
      throw new Error('Invalid model registry: missing required fields (defaults, models)');
    }

    registryCache.set(registryPath, { registry, timestamp: now });

    return registry;
  } catch (error) {
    throw new Error(`Failed to load model registry: ${(error as Error).message}`);
  }
}

function resolveRegistryPath(username?: string): string {
  // Use storage router to resolve user-specific config path
  if (username) {
    try {
      const result = storageClient.resolvePath({
        username,
        category: 'config',
        subcategory: 'etc',
        relativePath: 'models.json',
      });

      if (result.success && result.path) {
        // Check if user's config actually exists
        if (fs.existsSync(result.path)) {
          return result.path;
        } else {
          // User is authenticated but their models.json doesn't exist - FAIL with helpful message
          const errorMsg = `[model-resolver] ERROR: User models.json not found!\n` +
            `  Expected location: ${result.path}\n` +
            `  The user '${username}' needs a models.json config file.\n` +
            `  Create it by copying from etc/models.json or via the Settings UI.`;
          console.error(errorMsg);
          throw new Error(`User models.json not found at ${result.path}. Please create your user-specific model configuration.`);
        }
      }
    } catch (err) {
      // Re-throw if it's our custom error
      if (err instanceof Error && err.message.includes('User models.json not found')) {
        throw err;
      }
      console.warn(`[model-resolver] Failed to resolve user path for ${username}:`, err);
    }
  }

  // Only use global config for anonymous/system operations
  return path.join(ROOT, 'etc', 'models.json');
}

/**
 * Resolve a model role to its concrete configuration
 */
export function resolveModel(
  role: ModelRole,
  overrides?: Partial<ResolvedModel>,
  username?: string
): ResolvedModel {
  const registry = loadModelRegistry(false, username);

  // Get the default model ID for this role
  const defaultModelId = registry.defaults[role];
  if (!defaultModelId) {
    throw new Error(`No default model configured for role: ${role}`);
  }

  // Look up the model definition
  const modelDef = registry.models[defaultModelId];
  if (!modelDef) {
    throw new Error(`Model definition not found for ID: ${defaultModelId}`);
  }

  // Build resolved model
  const resolved: ResolvedModel = {
    id: defaultModelId,
    provider: modelDef.provider,
    model: modelDef.model,
    adapters: modelDef.adapters || [],
    baseModel: modelDef.baseModel,
    roles: modelDef.roles,
    options: { ...modelDef.options },
    metadata: { ...modelDef.metadata },
  };

  // Apply overrides if provided
  if (overrides) {
    Object.assign(resolved, overrides);
    if (overrides.options) {
      resolved.options = { ...resolved.options, ...overrides.options };
    }
    if (overrides.metadata) {
      resolved.metadata = { ...resolved.metadata, ...overrides.metadata };
    }
  }

  // Apply backend override to ensure correct model for active backend
  return applyBackendOverride(resolved, registry);
}

/**
 * Resolve a model by ID instead of role
 */
export function resolveModelById(modelId: string, username?: string): ResolvedModel {
  const registry = loadModelRegistry(false, username);

  const modelDef = registry.models[modelId];
  if (!modelDef) {
    throw new Error(`Model definition not found for ID: ${modelId}`);
  }

  const resolved: ResolvedModel = {
    id: modelId,
    provider: modelDef.provider,
    model: modelDef.model,
    adapters: modelDef.adapters || [],
    baseModel: modelDef.baseModel,
    roles: modelDef.roles,
    options: { ...modelDef.options },
    metadata: { ...modelDef.metadata || {} },
  };

  // Apply backend override to ensure correct model for active backend
  return applyBackendOverride(resolved, registry);
}

/**
 * Resolve model based on cognitive mode
 *
 * BACKEND-AWARE: When vLLM is active but cognitive mode maps to an Ollama model,
 * this function will override to use vllm.active instead. This ensures consistent
 * behavior across all cognitive modes when a specific backend is active.
 */
export function resolveModelForCognitiveMode(
  cognitiveMode: string,
  role: ModelRole,
  username?: string
): ResolvedModel {
  const registry = loadModelRegistry(false, username);

  // Check if there's a cognitive mode mapping
  if (registry.cognitiveModeMappings && registry.cognitiveModeMappings[cognitiveMode]) {
    const mapping = registry.cognitiveModeMappings[cognitiveMode];
    const modelId = mapping[role];

    // If null, this role is disabled for this cognitive mode
    if (modelId === null) {
      throw new Error(`Role ${role} is disabled in cognitive mode: ${cognitiveMode}`);
    }

    // If specific model ID provided, use it
    if (modelId && typeof modelId === 'string') {
      const resolved = resolveModelById(modelId, username);
      // Apply backend override to ensure correct model for active backend
      return applyBackendOverride(resolved, registry);
    }

    // Role exists in mapping but has no value (undefined, not null)
    // This is a configuration issue - warn loudly
    console.warn(
      `[model-resolver] ⚠️ MISSING CONFIG: Role '${role}' has no model assigned in cognitive mode '${cognitiveMode}'.` +
      `\n  → Falling back to default: ${registry.defaults[role] || 'NONE'}` +
      `\n  → Fix: Add "${role}": "vllm.active" to cognitiveModeMappings.${cognitiveMode} in models.json`
    );
  } else {
    // No cognitive mode mapping exists at all for this mode
    console.warn(
      `[model-resolver] ⚠️ MISSING CONFIG: Cognitive mode '${cognitiveMode}' has no mappings defined.` +
      `\n  → Falling back to defaults for role '${role}': ${registry.defaults[role] || 'NONE'}` +
      `\n  → Fix: Add cognitiveModeMappings.${cognitiveMode} section to models.json`
    );
  }

  // Fall back to default role resolution (with warning already logged above)
  const resolved = resolveModel(role, undefined, username);
  // Apply backend override to ensure correct model for active backend
  return applyBackendOverride(resolved, registry);
}

/**
 * List all available roles
 */
export function listAvailableRoles(username?: string): ModelRole[] {
  const registry = loadModelRegistry(false, username);
  return Object.keys(registry.defaults) as ModelRole[];
}

/**
 * List all available model IDs
 */
export function listAvailableModels(username?: string): string[] {
  const registry = loadModelRegistry(false, username);
  return Object.keys(registry.models);
}

/**
 * Get all models that can fulfill a specific role
 */
export function getModelsForRole(role: ModelRole, username?: string): string[] {
  const registry = loadModelRegistry(false, username);

  // Check role hierarchy first
  if (registry.roleHierarchy && registry.roleHierarchy[role]) {
    return registry.roleHierarchy[role];
  }

  // Otherwise, find all models that declare this role
  return Object.entries(registry.models)
    .filter(([_, def]) => def.roles.includes(role))
    .map(([id, _]) => id);
}

/**
 * Validate the model registry for correctness
 */
export function validateRegistry(username?: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const registry = loadModelRegistry(true, username); // Force fresh load

    // Check that all default roles point to existing models
    for (const [role, modelId] of Object.entries(registry.defaults)) {
      if (!registry.models[modelId]) {
        errors.push(`Default role '${role}' references non-existent model: ${modelId}`);
      }
    }

    // Check that all role hierarchy references exist
    if (registry.roleHierarchy) {
      for (const [role, modelIds] of Object.entries(registry.roleHierarchy)) {
        for (const modelId of modelIds) {
          if (!registry.models[modelId]) {
            errors.push(`Role hierarchy '${role}' references non-existent model: ${modelId}`);
          }
        }
      }
    }

    // Check that all cognitive mode mappings are valid
    if (registry.cognitiveModeMappings) {
      for (const [mode, mapping] of Object.entries(registry.cognitiveModeMappings)) {
        for (const [role, modelId] of Object.entries(mapping)) {
          if (role === 'description') continue; // Skip description field
          if (modelId !== null && typeof modelId === 'string' && !registry.models[modelId]) {
            errors.push(`Cognitive mode '${mode}' role '${role}' references non-existent model: ${modelId}`);
          }
        }
      }
    }

    // Check that all models have required fields
    for (const [modelId, def] of Object.entries(registry.models)) {
      if (!def.provider) {
        errors.push(`Model '${modelId}' missing required field: provider`);
      }
      if (!def.model) {
        errors.push(`Model '${modelId}' missing required field: model`);
      }
      if (!def.roles || def.roles.length === 0) {
        errors.push(`Model '${modelId}' missing or empty roles array`);
      }
    }

  } catch (error) {
    errors.push(`Failed to load registry: ${(error as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get provider configuration
 */
export function getProviderConfig(provider: ModelProvider, username?: string): {
  baseUrl: string;
  timeout: number;
  retries: number;
} {
  const registry = loadModelRegistry(false, username);

  if (registry.providers && registry.providers[provider]) {
    return registry.providers[provider];
  }

  // Return defaults if not configured
  return {
    baseUrl: provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1',
    timeout: 120000,
    retries: 2,
  };
}

/**
 * Clear the registry cache (useful for hot-reload)
 * @deprecated Use invalidateModelCache() instead
 */
export function clearRegistryCache(): void {
  invalidateModelCache();
}
