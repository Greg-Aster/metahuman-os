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
  if (source !== 'environment-sessions') return []

  const response = await apiFetch('/api/environment-bridge/status?view=session-options')
  if (!response.ok) {
    throw new Error(`Environment sessions are unavailable (${response.status})`)
  }
  return parseEnvironmentSessionSuggestions(await response.json())
}
