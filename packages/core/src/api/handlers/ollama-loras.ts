/**
 * Ollama LoRA packaging API.
 *
 * GET lists profile adapters against the selected Ollama base model. PUT builds
 * a supported adapter into a normal Ollama model and selects that model as the
 * backend default.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

let getProfilePaths: any
let discoverOllamaLoraAdapters: any
let createOllamaLoraModel: any
let loadBackendConfig: any
let saveBackendConfig: any

async function ensureFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js')
    getProfilePaths = core.getProfilePaths
    discoverOllamaLoraAdapters = core.discoverOllamaLoraAdapters
    createOllamaLoraModel = core.createOllamaLoraModel
    loadBackendConfig = core.loadBackendConfig
    saveBackendConfig = core.saveBackendConfig
    return !!(getProfilePaths && discoverOllamaLoraAdapters && createOllamaLoraModel
      && loadBackendConfig && saveBackendConfig)
  } catch {
    return false
  }
}

export async function handleGetOllamaLoras(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated || !req.user.username) {
      return { status: 401, error: 'Authentication required' }
    }
    if (!await ensureFunctions()) {
      return { status: 501, error: 'Ollama LoRA functions not available' }
    }
    const config = loadBackendConfig()
    const targetModel = req.query?.model?.trim() || config.ollama.defaultModel
    const profilePaths = getProfilePaths(req.user.username)
    const adapters = await discoverOllamaLoraAdapters(profilePaths.out, targetModel)
    return successResponse({ success: true, available: adapters, targetModel })
  } catch (error) {
    console.error('[ollama-loras] GET failed:', error)
    return { status: 500, error: (error as Error).message }
  }
}

export async function handleCreateOllamaLora(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated || !req.user.username) {
      return { status: 401, error: 'Authentication required' }
    }
    if (req.user.role !== 'owner') {
      return { status: 403, error: 'Owner role required' }
    }
    if (!await ensureFunctions()) {
      return { status: 501, error: 'Ollama LoRA functions not available' }
    }

    const config = loadBackendConfig()
    const adapterName = typeof req.body?.adapterName === 'string' ? req.body.adapterName.trim() : ''
    const baseModel = typeof req.body?.baseModel === 'string'
      ? req.body.baseModel.trim()
      : config.ollama.defaultModel
    if (!adapterName) return { status: 400, error: 'adapterName required' }
    if (!baseModel) return { status: 400, error: 'baseModel required' }

    const profilePaths = getProfilePaths(req.user.username)
    const result = await createOllamaLoraModel({
      profileOutPath: profilePaths.out,
      adapterName,
      baseModel,
      modelName: typeof req.body?.modelName === 'string' ? req.body.modelName : undefined,
      endpoint: config.ollama.endpoint,
      actor: req.user.username,
      parameters: {
        numCtx: config.ollama.contextWindow,
        numPredict: config.ollama.maxTokens,
        temperature: config.ollama.temperature,
        topP: config.ollama.topP,
        topK: config.ollama.topK,
        minP: config.ollama.minP,
        repeatPenalty: config.ollama.repeatPenalty,
        seed: config.ollama.seed,
      },
    })
    saveBackendConfig({ ollama: { defaultModel: result.modelName } })
    return successResponse({ success: true, ...result, needsRestart: false })
  } catch (error) {
    console.error('[ollama-loras] PUT failed:', error)
    return { status: 500, error: (error as Error).message }
  }
}
