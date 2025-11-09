/**
 * Model Resolver
 *
 * Resolves model roles to concrete model configurations from the registry.
 * Enables configuration-driven model selection and hot-swapping.
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, ROOT } from './paths.js';

export type ModelRole = 'orchestrator' | 'persona' | 'curator' | 'coder' | 'planner' | 'summarizer' | 'fallback';
export type ModelProvider = 'ollama' | 'openai' | 'local';

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
 */
export function loadModelRegistry(forceFresh = false): ModelRegistry {
  const now = Date.now();

  const registryPath = resolveRegistryPath();

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

function resolveRegistryPath(): string {
  // paths.etc automatically resolves to user profile or root based on context
  // For anonymous users without a profile, fall back to system root
  try {
    return path.join(paths.etc, 'models.json');
  } catch (error) {
    // Anonymous user without profile - use system root
    return path.join(ROOT, 'etc', 'models.json');
  }
}

/**
 * Resolve a model role to its concrete configuration
 */
export function resolveModel(
  role: ModelRole,
  overrides?: Partial<ResolvedModel>
): ResolvedModel {
  const registry = loadModelRegistry();

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

  return resolved;
}

/**
 * Resolve a model by ID instead of role
 */
export function resolveModelById(modelId: string): ResolvedModel {
  const registry = loadModelRegistry();

  const modelDef = registry.models[modelId];
  if (!modelDef) {
    throw new Error(`Model definition not found for ID: ${modelId}`);
  }

  return {
    id: modelId,
    provider: modelDef.provider,
    model: modelDef.model,
    adapters: modelDef.adapters || [],
    baseModel: modelDef.baseModel,
    roles: modelDef.roles,
    options: { ...modelDef.options },
    metadata: { ...modelDef.metadata || {} },
  };
}

/**
 * Resolve model based on cognitive mode
 */
export function resolveModelForCognitiveMode(
  cognitiveMode: string,
  role: ModelRole
): ResolvedModel {
  const registry = loadModelRegistry();

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
      return resolveModelById(modelId);
    }
  }

  // Fall back to default role resolution
  return resolveModel(role);
}

/**
 * List all available roles
 */
export function listAvailableRoles(): ModelRole[] {
  const registry = loadModelRegistry();
  return Object.keys(registry.defaults) as ModelRole[];
}

/**
 * List all available model IDs
 */
export function listAvailableModels(): string[] {
  const registry = loadModelRegistry();
  return Object.keys(registry.models);
}

/**
 * Get all models that can fulfill a specific role
 */
export function getModelsForRole(role: ModelRole): string[] {
  const registry = loadModelRegistry();

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
export function validateRegistry(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const registry = loadModelRegistry(true); // Force fresh load

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
export function getProviderConfig(provider: ModelProvider): {
  baseUrl: string;
  timeout: number;
  retries: number;
} {
  const registry = loadModelRegistry();

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
