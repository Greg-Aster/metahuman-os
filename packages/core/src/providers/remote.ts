/**
 * Direct remote inference transports.
 *
 * RunPod delegates to the canonical cloud provider implementation. The other
 * transports cover user-supplied Anthropic, OpenRouter, and OpenAI credentials.
 */

import { RunPodServerlessProvider } from './runpod.js'
import type { ProviderMessage, ProviderOptions, ProviderResponse } from './types.js'

export type RemoteProviderName = 'runpod' | 'claude' | 'openrouter' | 'openai'

export interface RemoteProviderCredentials {
  provider: RemoteProviderName
  apiKey: string
  endpoint?: string
  model?: string
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function requireTextMessages(messages: ProviderMessage[], provider: string): Array<{
  role: ProviderMessage['role']
  content: string
}> {
  return messages.map(message => {
    if (typeof message.content !== 'string') {
      throw new Error(`${provider} does not support image content through this adapter`)
    }
    return { role: message.role, content: message.content }
  })
}

function usageFromOpenAI(value: unknown): ProviderResponse['usage'] | undefined {
  const usage = asRecord(value)
  if (!usage) return undefined
  const promptTokens = numberValue(usage.prompt_tokens)
  const completionTokens = numberValue(usage.completion_tokens)
  return {
    promptTokens,
    completionTokens,
    totalTokens: numberValue(usage.total_tokens) || promptTokens + completionTokens,
  }
}

async function requestJson(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs = 120_000,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`${provider} request failed (${response.status}): ${body || response.statusText}`)
    }
    try {
      return JSON.parse(body) as unknown
    } catch {
      throw new Error(`${provider} returned invalid JSON`)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${provider} request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function callClaude(
  messages: ProviderMessage[],
  credentials: RemoteProviderCredentials,
  options: ProviderOptions,
): Promise<ProviderResponse> {
  const textMessages = requireTextMessages(messages, 'Anthropic')
  const system = textMessages.find(message => message.role === 'system')?.content
  const conversation = textMessages.filter(message => message.role !== 'system')
  const model = options.model || credentials.model || 'claude-3-5-sonnet-20241022'
  const data = asRecord(await requestJson('Anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': credentials.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 4096,
      messages: conversation,
      ...(system ? { system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    }),
  }))
  const firstContent = asRecord(asArray(data?.content)[0])
  const content = stringValue(firstContent?.text)
  if (!content) throw new Error('Anthropic response did not contain text')
  const usage = asRecord(data?.usage)
  const promptTokens = numberValue(usage?.input_tokens)
  const completionTokens = numberValue(usage?.output_tokens)
  return {
    content,
    model: stringValue(data?.model) || model,
    provider: 'claude',
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
  }
}

async function callOpenAICompatible(
  provider: 'openai' | 'openrouter',
  messages: ProviderMessage[],
  credentials: RemoteProviderCredentials,
  options: ProviderOptions,
): Promise<ProviderResponse> {
  const isOpenRouter = provider === 'openrouter'
  const model = options.model || credentials.model || (isOpenRouter
    ? 'anthropic/claude-3.5-sonnet'
    : 'gpt-4o')
  const data = asRecord(await requestJson(
    isOpenRouter ? 'OpenRouter' : 'OpenAI',
    isOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : credentials.endpoint || 'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${credentials.apiKey}`,
        ...(isOpenRouter ? {
          'HTTP-Referer': 'https://metahuman.dev',
          'X-Title': 'MetaHuman OS',
        } : {}),
      },
      body: JSON.stringify({
        model,
        messages: requireTextMessages(messages, isOpenRouter ? 'OpenRouter' : 'OpenAI'),
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        top_p: options.topP ?? 0.9,
      }),
    },
  ))
  const choice = asRecord(asArray(data?.choices)[0])
  const message = asRecord(choice?.message)
  const content = stringValue(message?.content)
  if (!content) throw new Error(`${isOpenRouter ? 'OpenRouter' : 'OpenAI'} response did not contain text`)
  return {
    content,
    model: stringValue(data?.model) || model,
    provider,
    usage: usageFromOpenAI(data?.usage),
  }
}

export async function callRemoteProvider(
  credentials: RemoteProviderCredentials,
  messages: ProviderMessage[],
  options: ProviderOptions = {},
): Promise<ProviderResponse> {
  if (!credentials.apiKey?.trim()) throw new TypeError(`${credentials.provider} API key is required`)

  switch (credentials.provider) {
    case 'runpod': {
      if (!credentials.endpoint?.trim()) throw new TypeError('RunPod endpoint ID is required')
      return new RunPodServerlessProvider({
        apiKey: credentials.apiKey,
        endpointId: credentials.endpoint,
      }).generate(messages, options)
    }
    case 'claude':
      return callClaude(messages, credentials, options)
    case 'openrouter':
    case 'openai':
      return callOpenAICompatible(credentials.provider, messages, credentials, options)
  }
}

export async function testRemoteProvider(credentials: RemoteProviderCredentials): Promise<{
  success: boolean
  error?: string
  latencyMs: number
}> {
  const startedAt = Date.now()
  try {
    await callRemoteProvider(credentials, [{ role: 'user', content: 'Hi' }], { maxTokens: 10 })
    return { success: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    }
  }
}
