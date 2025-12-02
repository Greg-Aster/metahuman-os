import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { systemPaths, getAuthenticatedUser, storageClient } from '@metahuman/core'
import { OllamaClient } from '@metahuman/core/ollama'
import { listAdapterDatasets, getActiveAdapter } from '@metahuman/core'

function resolveModelsPath(username: string): string {
  // Use storage router to resolve user-specific config path
  const result = storageClient.resolvePath({
    username,
    category: 'config',
    subcategory: 'etc',
    relativePath: 'models.json',
  })
  if (result.success && result.path) {
    return result.path
  }
  // Fallback to system path (should not happen for authenticated users)
  return path.join(systemPaths.etc, 'models.json')
}

function readModelRegistry(username: string) {
  try {
    const p = resolveModelsPath(username)
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return { globalSettings: {}, defaults: {}, models: {} }
  }
}

function writeModelRegistry(username: string, registry: any) {
  const p = resolveModelsPath(username)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(registry, null, 2))
}

const getHandler: APIRoute = async ({ cookies }) => {
  try {
    // SECURITY FIX: 2025-11-20 - Require owner role for system configuration access
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Owner role required to access system model configuration' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const registry = readModelRegistry(user.username)
    const globalSettings = registry.globalSettings || {}
    const ollama = new OllamaClient()
    let baseModels: string[] = []
    try {
      const tags = await ollama.listModels()
      baseModels = tags.map(m => m.name)
    } catch {}
    const loras = listAdapterDatasets().map(d => ({ date: d.date, status: d.status, evalScore: d.evalScore }))
    const dualAvailable = fs.existsSync(path.join(systemPaths.out, 'adapters', 'history-merged', 'adapter-merged.gguf'))
    const active = getActiveAdapter()
    return new Response(
      JSON.stringify({ success: true, agent: globalSettings, baseModels, loras, active, dualAvailable }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

const postHandler: APIRoute = async ({ cookies, request }) => {
  try {
    // SECURITY FIX: 2025-11-20 - Require owner role for system configuration changes
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Owner role required to modify system model configuration' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json()
    const { baseModel } = body || {}
    if (!baseModel) {
      return new Response(
        JSON.stringify({ success: false, error: 'baseModel is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const registry = readModelRegistry(user.username)
    // Update fallback model in defaults
    const fallbackId = registry.defaults?.fallback || 'default.fallback'
    if (registry.models?.[fallbackId]) {
      registry.models[fallbackId].model = baseModel
    }
    writeModelRegistry(user.username, registry)
    return new Response(
      JSON.stringify({ success: true, agent: registry.globalSettings || {} }),
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
// SECURITY FIX: 2025-11-20 - Both GET and POST require owner role for system config access
export const GET = getHandler
export const POST = postHandler
