import { audit } from './audit.js'
import { getUserContext } from './context.js'
import {
  buildEnvironmentClassifierMessages,
  environmentRouterRouteView,
  parseEnvironmentRouterDecision,
  type EnvironmentClassifierInput,
} from './environment-classifier.js'
import { loadModelRegistry, type ModelDefinition } from './model-resolver.js'
import { callLLM, type RouterResponse } from './model-router.js'
import { ollama } from './ollama.js'
import { vllm } from './vllm.js'

export const ENVIRONMENT_ROUTER_MODEL_ROLE = 'environmentRouter' as const

// Development folds used this synthetic registry prefix. They remain on disk
// as training evidence, but are no longer valid production model selections.
const RETIRED_ENVIRONMENT_FOLD_PREFIX = 'environment-classifier.'

export interface EnvironmentClassifierRuntimeStatus {
  enabled: boolean
  configured: boolean
  selectedModelId: string | null
  selectedModel?: EnvironmentRouterSelection
  running: boolean
  loaded: boolean
  loadedModels: string[]
  error?: string
}

export interface EnvironmentRouterSelection {
  id: string
  name: string
  provider: string
  model: string
}

function selectedConfiguration(username: string): {
  enabled: boolean
  modelId: string | null
  definition?: ModelDefinition
} {
  const registry = loadModelRegistry(true, username)
  const enabled = registry.globalSettings?.environmentClassifierEnabled !== false
  const modelId = registry.cognitiveModeMappings?.environment?.[ENVIRONMENT_ROUTER_MODEL_ROLE]
    ?? registry.defaults?.[ENVIRONMENT_ROUTER_MODEL_ROLE]
    ?? null

  if (!enabled || typeof modelId !== 'string') return { enabled, modelId: null }
  if (modelId.startsWith(RETIRED_ENVIRONMENT_FOLD_PREFIX)) return { enabled, modelId }

  const definition = registry.models?.[modelId]
  if (!definition || !definition.roles?.includes(ENVIRONMENT_ROUTER_MODEL_ROLE)) {
    return { enabled, modelId }
  }

  return { enabled, modelId, definition }
}

function selectionView(
  modelId: string,
  definition: ModelDefinition,
): EnvironmentRouterSelection {
  return {
    id: modelId,
    name: definition.description || definition.model,
    provider: definition.provider,
    model: definition.model,
  }
}

let runtimeQueue: Promise<void> = Promise.resolve()

function withRuntimeLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = runtimeQueue.then(operation, operation)
  runtimeQueue = result.then(() => undefined, () => undefined)
  return result
}

export async function warmEnvironmentClassifierRuntime(username: string): Promise<EnvironmentRouterSelection> {
  return withRuntimeLock(async () => {
    const selected = selectedConfiguration(username)
    if (!selected.enabled) throw new Error('Environment Classifier is disabled for this profile')
    if (!selected.modelId || !selected.definition) {
      throw new Error('No valid production Environment Router is selected for this profile')
    }

    await callLLM({
      role: ENVIRONMENT_ROUTER_MODEL_ROLE,
      cognitiveMode: 'environment',
      userId: username,
      messages: [{ role: 'user', content: 'warmup' }],
      options: { maxTokens: 1, temperature: 0, enableThinking: false },
    })

    return selectionView(selected.modelId, selected.definition)
  })
}

export async function getEnvironmentClassifierRuntimeStatus(
  username: string,
): Promise<EnvironmentClassifierRuntimeStatus> {
  try {
    const selected = selectedConfiguration(username)
    const selectedModel = selected.modelId && selected.definition
      ? selectionView(selected.modelId, selected.definition)
      : undefined
    let running = false
    let loaded = false
    let loadedModels: string[] = []

    if (selected.definition?.provider === 'ollama') {
      running = await ollama.isRunning()
      loaded = running && await ollama.isModelLoaded(selected.definition.model)
      loadedModels = loaded ? [selected.definition.model] : []
    } else if (selected.definition?.provider === 'vllm') {
      running = await vllm.isRunning()
      loadedModels = running ? (await vllm.listModels()).map(model => model.id) : []
      loaded = loadedModels.includes(selected.definition.model)
    }

    return {
      enabled: selected.enabled,
      configured: Boolean(selected.definition),
      selectedModelId: selected.modelId,
      selectedModel,
      running,
      loaded,
      loadedModels,
      ...(!selected.definition && selected.modelId?.startsWith(RETIRED_ENVIRONMENT_FOLD_PREFIX)
        ? { error: 'The selected development fold has been retired from production. Select an installed model.' }
        : {}),
    }
  } catch (error) {
    return {
      enabled: false,
      configured: false,
      selectedModelId: null,
      running: false,
      loaded: false,
      loadedModels: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Return a strict classifier response when the profile has one enabled. A null
 * response deliberately hands authority back to the existing main-model route.
 */
export async function callEnvironmentClassifierRuntime(
  input: EnvironmentClassifierInput,
  username = getUserContext()?.username,
): Promise<RouterResponse | null> {
  if (!username) return null
  const startedAt = Date.now()

  try {
    return await withRuntimeLock(async () => {
      const selected = selectedConfiguration(username)
      if (!selected.enabled || !selected.modelId || !selected.definition) return null
      const messages = buildEnvironmentClassifierMessages(input)

      const response = await callLLM({
        role: ENVIRONMENT_ROUTER_MODEL_ROLE,
        cognitiveMode: 'environment',
        userId: username,
        messages,
        options: {
          temperature: 0,
          seed: 0,
          maxTokens: 512,
          topP: 1,
          enableThinking: false,
          format: 'json',
        },
      })
      const parsed = parseEnvironmentRouterDecision(response.content)
      if (!parsed.valid || !parsed.value) {
        throw new Error(`Classifier output failed the Core contract: ${parsed.errors.join('; ')}`)
      }

      const tokens = 'usage' in response && response.usage
        ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          }
        : 'tokens' in response
          ? response.tokens
          : undefined

      const latencyMs = Date.now() - startedAt
      audit({
        level: 'info',
        category: 'decision',
        event: 'environment_classifier_decision',
        actor: 'environment-classifier',
        details: {
          username,
          modelId: selected.modelId,
          route: environmentRouterRouteView(parsed.value),
          latencyMs,
        },
      })

      return {
        content: JSON.stringify(parsed.value),
        model: response.model || selected.definition.model,
        modelId: selected.modelId,
        role: ENVIRONMENT_ROUTER_MODEL_ROLE,
        provider: response.provider,
        tokens,
        latencyMs,
        thinking: null,
      }
    })
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'environment_classifier_fallback',
      actor: 'environment-classifier',
      details: {
        username,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
        fallback: 'main-environment-orchestrator',
      },
    })
    console.warn('[environment-classifier] Falling back to the main Environment orchestrator:', error)
    return null
  }
}
