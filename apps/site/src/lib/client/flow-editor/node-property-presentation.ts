import type {
  NodePresentation,
  NodeSlot,
  PropertySchema,
} from '@metahuman/core/nodes/types'

export type NodePropertyEntry = [key: string, schema: PropertySchema]

export interface CanvasPropertyGroups {
  primary: NodePropertyEntry[]
  settings: NodePropertyEntry[]
  advanced: NodePropertyEntry[]
}

export interface NodeStatusRow {
  label: string
  value: string
  title?: string
  tone?: 'neutral' | 'success' | 'warning'
}

export interface NodeSlotGroup {
  label: string
  slots: NodeSlot[]
}

const PROMPT_FIELD_PATTERN = /(prompt|template|instruction|guidance|contract)/i

export function isPromptLikeProperty(key: string, schema: PropertySchema): boolean {
  if (schema.type === 'text_multiline') return true
  return PROMPT_FIELD_PATTERN.test(`${key} ${schema.label ?? ''}`)
}

export function groupCanvasProperties(
  propertySchemas: Record<string, PropertySchema> | undefined,
): CanvasPropertyGroups {
  const groups: CanvasPropertyGroups = {
    primary: [],
    settings: [],
    advanced: [],
  }

  for (const entry of Object.entries(propertySchemas ?? {}) as NodePropertyEntry[]) {
    const [key, schema] = entry
    if (schema.canvas === 'primary') {
      groups.primary.push(entry)
      continue
    }
    if (schema.advanced) {
      groups.advanced.push(entry)
      continue
    }
    if (schema.canvas !== 'expanded' && isPromptLikeProperty(key, schema)) {
      groups.primary.push(entry)
      continue
    }
    groups.settings.push(entry)
  }

  return groups
}

export function formatPropertySummary(
  value: unknown,
  schema: PropertySchema,
  maxLength = 96,
): string {
  if (value === undefined || value === null || value === '') {
    return schema.emptyLabel || 'Not set'
  }
  if (typeof value === 'boolean') return value ? 'On' : 'Off'

  if (schema.type === 'select' && typeof value === 'string') {
    const option = schema.options?.find((candidate) => (
      typeof candidate === 'string' ? candidate === value : candidate.value === value
    ))
    if (option && typeof option !== 'string') return option.label
  }

  let rendered: string
  if (Array.isArray(value)) {
    if (value.length === 0) return schema.emptyLabel || 'None selected'

    const optionLabels = new Map(
      (schema.options || []).map((option) => (
        typeof option === 'string'
          ? [option, option]
          : [option.value, option.label]
      )),
    )
    const labels = value.map((item) => optionLabels.get(String(item)) || String(item))
    const optionCount = schema.options?.length ?? 0

    if (schema.type === 'multiselect' && optionCount > 0 && value.length === optionCount) {
      rendered = `All ${optionCount}`
    } else if (labels.length <= 3) {
      rendered = labels.join(', ')
    } else if (schema.type === 'multiselect' && optionCount > 0) {
      rendered = `${labels.length} of ${optionCount}: ${labels.slice(0, 2).join(', ')}…`
    } else {
      rendered = `${labels.length} items`
    }
  } else if (typeof value === 'object') {
    try {
      rendered = JSON.stringify(value)
    } catch {
      rendered = String(value)
    }
  } else {
    rendered = String(value)
  }

  rendered = rendered.replace(/\s+/g, ' ').trim()
  return rendered.length > maxLength
    ? `${rendered.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : rendered
}

export function groupNodeSlots(slots: NodeSlot[]): NodeSlotGroup[] {
  const groups = new Map<string, NodeSlot[]>()
  for (const slot of slots) {
    const label = slot.group || 'Other'
    const group = groups.get(label) || []
    group.push(slot)
    groups.set(label, group)
  }
  return [...groups].map(([label, groupedSlots]) => ({ label, slots: groupedSlots }))
}

export function getConnectedOutputConfigurationWarnings(
  outputs: NodeSlot[],
  properties: Record<string, unknown>,
  propertySchemas: Record<string, PropertySchema> | undefined,
  connectedOutputHandles: Iterable<string>,
): string[] {
  const connected = new Set(connectedOutputHandles)
  const warnings: string[] = []

  for (const output of outputs) {
    const condition = output.enabledBy
    if (!condition || !connected.has(output.name)) continue

    const configured = properties[condition.property]
      ?? propertySchemas?.[condition.property]?.default
    if (Array.isArray(configured) && configured.includes(condition.includes)) continue

    const propertySchema = propertySchemas?.[condition.property]
    const propertyLabel = propertySchema?.label || condition.property
    const requiredLabel = propertySchema?.options
      ?.map((option) => typeof option === 'string' ? { value: option, label: option } : option)
      .find((option) => option.value === condition.includes)
      ?.label || condition.includes
    warnings.push(
      condition.warning
      || `${output.label || output.name} is connected, but ${propertyLabel} excludes ${requiredLabel}.`,
    )
  }

  return warnings
}

function formatRelativeTime(value: unknown, now: number): { value: string; title?: string } {
  if (typeof value !== 'string') return { value: String(value ?? '') }
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return { value }

  const exact = new Date(timestamp).toLocaleString()
  const elapsedMs = Math.max(0, now - timestamp)
  if (elapsedMs < 1_000) return { value: 'just now', title: exact }
  const elapsedSeconds = Math.floor(elapsedMs / 1_000)
  if (elapsedSeconds < 60) return { value: `${elapsedSeconds}s ago`, title: exact }
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return { value: `${elapsedMinutes}m ago`, title: exact }
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return { value: `${elapsedHours}h ago`, title: exact }
  return { value: `${Math.floor(elapsedHours / 24)}d ago`, title: exact }
}

export function getNodeStatusRows(
  presentation: NodePresentation | undefined,
  output: unknown,
  now = Date.now(),
): NodeStatusRow[] {
  if (!presentation?.statusFields || !output || typeof output !== 'object' || Array.isArray(output)) {
    return []
  }

  const record = output as Record<string, unknown>
  const rows: NodeStatusRow[] = []
  for (const field of presentation.statusFields) {
    const rawValue = record[field.output]
    if (field.hideWhenEmpty && (rawValue === undefined || rawValue === null || rawValue === '')) continue

    if (field.format === 'availability') {
      const available = Boolean(rawValue)
      rows.push({
        label: field.label,
        value: available ? 'Available' : 'Not available',
        tone: available ? 'success' : 'warning',
      })
      continue
    }

    if (field.format === 'relative-time') {
      const formatted = formatRelativeTime(rawValue, now)
      rows.push({ label: field.label, ...formatted })
      continue
    }

    rows.push({ label: field.label, value: String(rawValue ?? '—') })
  }
  return rows
}

export function isPromptInputHandle(handleId: string | null): boolean {
  return /^(messages?|prompt|systemPrompt|userPrompt|instruction)$/i.test(handleId ?? '')
}
