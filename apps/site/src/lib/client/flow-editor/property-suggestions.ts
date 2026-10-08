import type { PropertySchema } from '@metahuman/core/nodes/types'
import { apiFetch } from '../api-config'

export interface PropertySuggestion {
  value: string
  label: string
}

interface EnvironmentSessionSummary {
  sessionId?: unknown
  environmentId?: unknown
  adapter?: unknown
  status?: unknown
}

export function parseEnvironmentSessionSuggestions(payload: unknown): PropertySuggestion[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const sessions = (payload as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) return []

  return sessions.flatMap((candidate): PropertySuggestion[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const session = candidate as EnvironmentSessionSummary
    if (typeof session.sessionId !== 'string' || !session.sessionId.trim()) return []

    const details = [session.environmentId, session.adapter, session.status]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    return [{
      value: session.sessionId,
      label: details.length ? details.join(' · ') : session.sessionId,
    }]
  })
}

export async function loadPropertySuggestions(
  source: NonNullable<PropertySchema['suggestions']>,
): Promise<PropertySuggestion[]> {
  if (source === 'models') {
    const response = await apiFetch('/api/model-registry?view=node')
    if (!response.ok) throw new Error(`Model registry is unavailable (${response.status})`)
    return parseModelSuggestions(await response.json())
  }
  if (source !== 'environment-sessions') return []

  const response = await apiFetch('/api/environment-bridge/status?view=session-options')
  if (!response.ok) {
    throw new Error(`Environment sessions are unavailable (${response.status})`)
  }
  return parseEnvironmentSessionSuggestions(await response.json())
}

export function parseModelSuggestions(payload: any): PropertySuggestion[] {
  const models = Array.isArray(payload?.nodeModels) ? payload.nodeModels : []
  const loras = Array.isArray(payload?.modelCategories?.lora) ? payload.modelCategories.lora : []
  return [...models.map((model: any) => ({
    value: model.id,
    label: `${model.provider}: ${model.model}${model.adapters?.length ? ` + ${model.description}` : ''}`,
  })), ...loras.filter((lora: any) => lora.valid).map((lora: any) => ({
    value: lora.id, label: `vllm: ${lora.name}${lora.loaded ? '' : ' (requires server reload)'}`,
  }))]
}

export async function registerSelectedModel(modelId: string): Promise<void> {
  if (!modelId) return
  const response = await apiFetch('/api/model-registry', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, registerOnly: true }),
  })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error || 'Unable to register selected model')
  if (result.needsRestart) throw new Error('Adapter enabled. Reload the vLLM server, then select it again.')
}
