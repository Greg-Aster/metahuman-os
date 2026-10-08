/** Transport for an externally managed llama-server. Process ownership stays with its launcher. */
import {
  inspectProviderMessages,
  providerImagePolicyFromOptions,
  ProviderInputError,
  type ProviderMessage,
  type ProviderOptions,
  type ProviderResponse,
  type ProviderProgressCallback,
} from './types.js'

export interface LlamaCppConfig {
  endpoint: string
  model: string
  contextWindow: number
  maxTokens: number
  temperature: number
  topP: number
  enableThinking: boolean
  capabilities: Array<'text' | 'image'>
}

export const DEFAULT_LLAMA_CPP_CONFIG: LlamaCppConfig = {
  endpoint: 'http://127.0.0.1:8080',
  model: '',
  contextWindow: 4096,
  maxTokens: 512,
  temperature: 0.7,
  topP: 0.9,
  enableThinking: false,
  capabilities: ['text'],
}

export function validateLlamaCppConfig(config: LlamaCppConfig): void {
  const url = new URL(config.endpoint)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('llama.cpp endpoint must be an HTTP(S) server URL without credentials, query or fragment')
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('llama.cpp endpoint must be the server root URL (without /v1)')
  if (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 256) {
    throw new Error('llama.cpp model must be a non-empty served model name')
  }
  if (!Number.isInteger(config.contextWindow) || config.contextWindow < 256 || config.contextWindow > 1048576) {
    throw new Error('llama.cpp contextWindow must be an integer between 256 and 1048576')
  }
  if (!Number.isInteger(config.maxTokens) || config.maxTokens < 1 || config.maxTokens >= config.contextWindow) {
    throw new Error('llama.cpp maxTokens must be positive and smaller than contextWindow')
  }
  if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 5
    || !Number.isFinite(config.topP) || config.topP < 0 || config.topP > 1) {
    throw new Error('llama.cpp temperature must be between 0 and 5 and topP between 0 and 1')
  }
  if (typeof config.enableThinking !== 'boolean') throw new Error('llama.cpp enableThinking must be a boolean')
  if (!Array.isArray(config.capabilities) || !config.capabilities.includes('text')
    || config.capabilities.some(value => value !== 'text' && value !== 'image')) {
    throw new Error('llama.cpp capabilities must include text and may include image')
  }
}

async function requestJson(endpoint: string, route: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}${route}`, { ...init, signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`llama.cpp ${route} returned HTTP ${response.status}: ${text.slice(0, 512)}`)
    try { return JSON.parse(text) } catch { throw new Error(`llama.cpp ${route} returned invalid JSON`) }
  } catch (error) {
    init.signal?.throwIfAborted()
    if (signal.aborted) throw new Error(`llama.cpp ${route} timed out after ${timeoutMs}ms`)
    throw new Error(`llama.cpp ${route} failed: ${(error as Error).message}`, { cause: error })
  }
}

export async function getLlamaCppStatus(config: LlamaCppConfig): Promise<{ running: boolean; error?: string }> {
  try {
    validateLlamaCppConfig(config)
    const health = await requestJson(config.endpoint, '/health', {}, 2000)
    if (health?.status !== 'ok') throw new Error('llama.cpp is not ready')
    const models = await requestJson(config.endpoint, '/v1/models', {}, 2000)
    if (!Array.isArray(models?.data) || !models.data.some((model: { id?: string }) => model?.id === config.model)) {
      throw new Error(`llama.cpp is not serving the configured model ${config.model}`)
    }
    return { running: true }
  } catch (error) {
    return { running: false, error: (error as Error).message }
  }
}

export async function getLlamaCppAdapters(config: LlamaCppConfig): Promise<Array<{ id: number; path: string; scale: number }>> {
  return requestJson(config.endpoint, '/lora-adapters', {}, 2000)
}

export async function callLlamaCpp(
  config: LlamaCppConfig,
  messages: ProviderMessage[],
  options: ProviderOptions = {},
  onProgress?: ProviderProgressCallback,
): Promise<ProviderResponse> {
  validateLlamaCppConfig(config)
  options.signal?.throwIfAborted()
  const inspection = inspectProviderMessages(messages, providerImagePolicyFromOptions(options))
  if (inspection.imageCount && !config.capabilities.includes('image')) {
    throw new ProviderInputError(`llama.cpp model ${config.model} is not configured for image input`)
  }
  const maxTokens = options.maxTokens ?? config.maxTokens
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens >= config.contextWindow) {
    throw new ProviderInputError('Requested output tokens must be positive and smaller than the llama.cpp context window')
  }
  onProgress?.({ phase: 'running', message: `Generating with llama.cpp (${config.model})` })
  // Server IDs may change when adapters are reloaded in a different order.
  const loadedAdapters = options.lora?.some(adapter => adapter.path)
    ? await getLlamaCppAdapters(config) : []
  const lora = options.lora?.map(adapter => {
    const id = adapter.path ? loadedAdapters.find(loaded => loaded.path === adapter.path)?.id : adapter.id
    if (id === undefined) throw new Error(`llama.cpp adapter is not loaded: ${adapter.path}`)
    return { id, scale: adapter.scale }
  })
  const response = await requestJson(config.endpoint, '/v1/chat/completions', {
    signal: options.signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      ...(lora !== undefined ? { lora } : {}),
      messages,
      stream: false,
      max_tokens: maxTokens,
      temperature: options.temperature ?? config.temperature,
      top_p: options.topP ?? config.topP,
      ...(options.topK !== undefined ? { top_k: options.topK } : {}),
      ...(options.minP !== undefined ? { min_p: options.minP } : {}),
      ...(options.repeatPenalty !== undefined ? { repeat_penalty: options.repeatPenalty } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      chat_template_kwargs: { enable_thinking: options.enableThinking ?? config.enableThinking },
      ...(options.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'response', schema: options.jsonSchema } } }
        : options.format === 'json' ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, 120000)
  const choice = response?.choices?.[0]
  const message = choice?.message
  if (typeof message?.content !== 'string' || !message.content.trim()) {
    throw new Error(`llama.cpp returned no assistant text (finish reason: ${choice?.finish_reason || 'missing'})`)
  }
  if (response.model && response.model !== config.model) throw new Error('llama.cpp returned a different model than requested')
  const usage = response.usage
  if (usage && ['prompt_tokens', 'completion_tokens', 'total_tokens'].some(key => !Number.isFinite(usage[key]) || usage[key] < 0)) {
    throw new Error('llama.cpp returned invalid token usage')
  }
  onProgress?.({ phase: 'completed', message: 'llama.cpp response received' })
  return {
    content: message.content,
    thinking: typeof message.reasoning_content === 'string' ? message.reasoning_content : undefined,
    model: config.model,
    provider: 'llama-cpp',
    usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined,
  }
}
