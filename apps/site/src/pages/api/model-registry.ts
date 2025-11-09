import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { paths, audit } from '@metahuman/core'
import { OllamaClient } from '@metahuman/core/ollama'
import { getUserContext } from '@metahuman/core/context'
import { withUserContext } from '../../middleware/userContext'
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
    const p = path.join(paths.etc, 'models.json')
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return { globalSettings: {}, defaults: {}, models: {}, cognitiveModeMappings: {}, roleHierarchy: {} }
  }
}

function writeModelRegistry(registry: any) {
  const p = path.join(paths.etc, 'models.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(registry, null, 2))
  // Invalidate cache to force reload
  invalidateModelCache()
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
const getHandler: APIRoute = async () => {
  try {
    const ctx = getUserContext()
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required to view model registry.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const registry = readModelRegistry()

    // Fetch all available models from Ollama
    const ollama = new OllamaClient()
    let ollamaModels: string[] = []
    try {
      const tags = await ollama.listModels()
      // Filter out training artifacts and keep only production models
      ollamaModels = tags
        .map(m => m.name)
        .filter(name => !isTrainingArtifact(name))
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
      .filter(name => !registryModelNames.has(name))
      .map(name => ({
        id: `ollama.${name}`,
        provider: 'ollama' as const,
        model: name,
        roles: ALL_ROLES, // Default roles for unregistered models
        description: 'Available in Ollama (not in registry)',
        adapters: [],
        baseModel: null,
        metadata: { source: 'ollama-discovery' },
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
      actor: ctx.username,
      context: {
        userId: ctx.userId,
        profilePath: paths.etc
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
const postHandler: APIRoute = async ({ request }) => {
  try {
    const ctx = getUserContext()
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required to update model registry.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
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

    // Verify the modelId exists
    if (!registry.models?.[modelId]) {
      return new Response(
        JSON.stringify({ success: false, error: `Model ${modelId} not found in registry` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
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

    writeModelRegistry(registry)

    await audit({
      category: 'data_change',
      level: 'info',
      action: 'model_role_updated',
      actor: ctx.username,
      context: {
        userId: ctx.userId,
        role,
        modelId,
        cognitiveMode: cognitiveMode || 'default',
        profilePath: paths.etc
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
const putHandler: APIRoute = async ({ request }) => {
  try {
    const ctx = getUserContext()
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required to update global settings.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
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

    writeModelRegistry(registry)

    await audit({
      category: 'data_change',
      level: 'info',
      action: 'model_global_settings_updated',
      actor: ctx.username,
      context: {
        userId: ctx.userId,
        settings: globalSettings,
        profilePath: paths.etc
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

export const GET = withUserContext(getHandler)
export const POST = withUserContext(postHandler)
export const PUT = withUserContext(putHandler)
