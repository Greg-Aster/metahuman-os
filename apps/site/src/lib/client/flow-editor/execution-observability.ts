export type TimelineState = 'running' | 'completed' | 'skipped' | 'failed'

export interface ExecutionTimelineEntry {
  nodeId: string
  state: TimelineState
  timestamp: number
  durationMs?: number
  reason?: string
  error?: string
}

export function safeOutputPreview(value: unknown, limit = 500): string {
  try {
    const rendered = JSON.stringify(value, (key, nested) => {
      if (/(?:authorization|cookie|password|secret|token|api[-_]?key|access[-_]?key)/i.test(key)) {
        return '[redacted]'
      }
      if (typeof nested === 'string' && /^data:(?:image|audio)\//.test(nested)) {
        return `[embedded media omitted: ${nested.length} characters]`
      }
      if (typeof nested === 'string' && /^(?:Bearer|Basic)\s+\S+/i.test(nested)) {
        return '[redacted authorization]'
      }
      if (typeof nested === 'string' && nested.length > 1_000) {
        return `${nested.slice(0, 1_000)}…`
      }
      return nested
    })
    const text = rendered ?? String(value)
    return text.length > limit ? `${text.slice(0, limit)}…` : text
  } catch {
    const text = String(value)
    return text.length > limit ? `${text.slice(0, limit)}…` : text
  }
}

export function updateTimeline(
  entries: ExecutionTimelineEntry[],
  eventType: string,
  data: Record<string, any>,
): ExecutionTimelineEntry[] {
  if (!['node_start', 'node_complete', 'node_skip', 'node_error'].includes(eventType) || !data.nodeId) {
    return entries
  }
  const state: TimelineState = eventType === 'node_start'
    ? 'running'
    : eventType === 'node_complete'
      ? 'completed'
      : eventType === 'node_skip'
        ? 'skipped'
        : 'failed'
  const entry: ExecutionTimelineEntry = {
    nodeId: data.nodeId,
    state,
    timestamp: data.timestamp || Date.now(),
    durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  }
  const existing = entries.findIndex(candidate => candidate.nodeId === data.nodeId)
  return existing === -1
    ? [...entries, entry]
    : entries.map((candidate, index) => index === existing ? { ...candidate, ...entry } : candidate)
}
