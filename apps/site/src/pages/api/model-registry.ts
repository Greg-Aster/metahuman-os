import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { systemPaths, audit, getAuthenticatedUser } from '@metahuman/core'
import { OllamaClient } from '@metahuman/core/ollama'
import { invalidateModelCache } from '@metahuman/core/model-resolver'

/**
 * API endpoint for managing user's model registry
 *
 * GET: Retrieve available models and current role assignments
 * POST: Update role assignments
 * PUT: Update global settings
 */

function readModelRegistry() {
  try {
    const p = path.join(systemPaths.etc, 'models.json')
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return { globalSettings: {}, defaults: {}, models: {}, cognitiveModeMappings: {}, roleHierarchy: {} }
  }
}

async function writeModelRegistry(registry: any) {
  const p = path.join(systemPaths.etc, 'models.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(registry, null, 2))
  // Invalidate both caches to force reload
  invalidateModelCache()

  // Also invalidate status cache (import dynamically to avoid circular dependency)
  try {
    const statusModule = await import('./status.js')
    if (statusModule.invalidateStatusCache) {
      statusModule.invalidateStatusCache()
    }
  } catch (e) {
    // Status module might not be loaded yet, that's okay
  }
}

/**
 * Helper to filter out training artifacts and temporary models
 */
function isTrainingArtifact(modelName: string): boolean {
  const patterns = [
    /^greg-local-/,           // Local training artifacts
    /^greg-dual-/,            // Dual adapter models
    /^greg-\d{4}-\d{2}-\d{2}/, // Date-stamped training models
    /^history-merged/,        // Consolidated historical adapter
    /-adapter\.gguf$/,        // Raw adapter files
    /-merged$/,               // Merged model artifacts
    /^adapter-/,              // Adapter prefixes
  ]
  return patterns.some(pattern => pattern.test(modelName))
}

const ALL_ROLES = ['persona', 'orchestrator', 'coder', 'planner', 'curator', 'summarizer', 'fallback'];

// GET: Retrieve model registry information
const getHandler: APIRoute = async ({ cookies }) => {
  try {
    // SECURITY FIX: 2025-11-20 - Require owner role for system configuration access
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Owner role required to access system model registry' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const registry = readModelRegistry()

    // Fetch all available models from Ollama
    const ollama = new OllamaClient()
    let ollamaModels: Array<{ name: string; size?: number; modified_at?: string }> = []
    try {
      const tags = await ollama.listModels()
      // Filter out training artifacts and keep only production models
      ollamaModels = tags
        .filter(m => !isTrainingArtifact(m.name))
        .map(m => ({ name: m.name, size: m.size, modified_at: m.modified_at }))
    } catch (err) {
      console.error('[model-registry] Failed to fetch Ollama models:', err)
      // Continue with registry-only models if Ollama is unavailable
    }

    // Build available models list from registry + Ollama
    const registryModels = Object.entries(registry.models || {}).map(([id, config]: [string, any]) => ({
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
    }))

    // Add Ollama models that aren't in the registry
    const registryModelNames = new Set(registryModels.map(m => m.model))
    const ollamaOnlyModels = ollamaModels
      .filter(({ name }) => !registryModelNames.has(name))
      .map(({ name, size, modified_at }) => ({
        id: `ollama.${name}`,
        provider: 'ollama' as const,
        model: name,
        roles: ALL_ROLES, // Default roles for unregistered models
        description: 'Available in Ollama (not in registry)',
        adapters: [],
        baseModel: null,
        metadata: { source: 'ollama-discovery', size, modified_at },
        options: {},
        source: 'ollama' as const
      }))

    const availableModels = [...registryModels, ...ollamaOnlyModels]

    // Extract current role assignments
    const roleAssignments = registry.defaults || {}

    // Extract cognitive mode mappings
    const cognitiveModeMappings = registry.cognitiveModeMappings || {}

    // Extract global settings
    const globalSettings = registry.globalSettings || {}

    await audit({
      category: 'action',
      level: 'info',
      action: 'model_registry_view',
      actor: user.username,
      context: {
        userId: user.id,
        profilePath: systemPaths.etc
      }
    })

    return new Response(
      JSON.stringify({
        success: true,
        availableModels,
        roleAssignments,
        cognitiveModeMappings,
        globalSettings,
        version: registry.version || '1.0.0'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// POST: Update role assignments
const postHandler: APIRoute = async ({ cookies, request }) => {
  try {
    // SECURITY FIX: 2025-11-20 - Require owner role for system configuration changes
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Owner role required to modify system model registry' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { role, modelId, cognitiveMode } = body || {}

    if (!role || !modelId) {
      return new Response(
        JSON.stringify({ success: false, error: 'role and modelId are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const registry = readModelRegistry()

    registry.models = registry.models || {}

    // Auto-register Ollama models that aren't yet in the registry
    if (!registry.models[modelId]) {
      const isOllamaModel = modelId.startsWith('ollama.')
      const inferredName = isOllamaModel ? modelId.replace(/^ollama\./, '') : modelId

      registry.models[modelId] = {
        provider: 'ollama',
        model: inferredName,
        roles: [role],
        adapters: [],
        description: `Imported from Ollama tag ${inferredName}`,
        options: {},
        metadata: { source: 'ollama-discovery' }
      }
    }

    // Ensure role list includes this role
    const entry = registry.models[modelId]
    if (!Array.isArray(entry.roles)) {
      entry.roles = []
    }
    if (!entry.roles.includes(role)) {
      entry.roles.push(role)
    }

    // If cognitiveMode is specified, update the cognitive mode mapping
    // Otherwise, update the default role assignment
    if (cognitiveMode) {
      if (!registry.cognitiveModeMappings) {
        registry.cognitiveModeMappings = {}
      }
      if (!registry.cognitiveModeMappings[cognitiveMode]) {
        registry.cognitiveModeMappings[cognitiveMode] = {}
      }
      registry.cognitiveModeMappings[cognitiveMode][role] = modelId
    } else {
      // Update default role assignment
      if (!registry.defaults) {
        registry.defaults = {}
      }
      registry.defaults[role] = modelId
    }

    await writeModelRegistry(registry)

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
        profilePath: systemPaths.etc
      }
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: `Role ${role} assigned to model ${modelId}`,
        registry: {
          availableModels: Object.keys(registry.models || {}),
          roleAssignments: registry.defaults,
          cognitiveModeMappings: registry.cognitiveModeMappings
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// PUT: Update global settings
const putHandler: APIRoute = async ({ cookies, request }) => {
  try {
    // SECURITY FIX: 2025-11-20 - Require owner role for system configuration changes
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Owner role required to modify global settings' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await request.json()
    const { globalSettings } = body || {}

    if (!globalSettings) {
      return new Response(
        JSON.stringify({ success: false, error: 'globalSettings object is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const registry = readModelRegistry()

    // Update global settings (merge with existing)
    registry.globalSettings = {
      ...(registry.globalSettings || {}),
      ...globalSettings
    }

    await writeModelRegistry(registry)

    await audit({
      category: 'data_change',
      level: 'info',
      action: 'model_global_settings_updated',
      actor: user.username,
      context: {
        userId: user.id,
        settings: globalSettings,
        profilePath: systemPaths.etc
      }
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Global settings updated',
        globalSettings: registry.globalSettings
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// SECURITY FIX: 2025-11-20 - All handlers require owner role for system config access
export const GET = getHandler
export const POST = postHandler
export const PUT = putHandler
