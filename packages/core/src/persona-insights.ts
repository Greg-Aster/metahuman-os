import { storageClient } from './storage-client.js'

export const PERSONA_INSIGHTS_VERSION = '2.0.0'
const MAX_PERSONA_INSIGHTS_BYTES = 2 * 1024 * 1024

export interface PersonaInsightEntry {
  timestamp: string
  type: 'addition' | 'removal' | 'update'
  category: string
  section: string
  items: string[]
  memoriesAnalyzed: number
  confidence: number
  reasoning: string
  archiveCompared?: string
  sessionId: string
}

export interface PersonaInsights {
  version: typeof PERSONA_INSIGHTS_VERSION
  lastUpdated: string | null
  entries: PersonaInsightEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function parseEntry(value: unknown, index: number): PersonaInsightEntry {
  if (!isRecord(value)) throw new Error(`Persona insights entries[${index}] must be an object`)
  if (value.type !== 'addition' && value.type !== 'removal' && value.type !== 'update') {
    throw new Error(`Persona insights entries[${index}].type is invalid`)
  }
  if (!Array.isArray(value.items) || value.items.some(item => typeof item !== 'string')) {
    throw new Error(`Persona insights entries[${index}].items must be an array of strings`)
  }
  if (!Number.isInteger(value.memoriesAnalyzed) || (value.memoriesAnalyzed as number) < 0) {
    throw new Error(`Persona insights entries[${index}].memoriesAnalyzed must be a non-negative integer`)
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1) {
    throw new Error(`Persona insights entries[${index}].confidence must be between 0 and 1`)
  }
  return {
    timestamp: requireString(value.timestamp, `Persona insights entries[${index}].timestamp`),
    type: value.type,
    category: requireString(value.category, `Persona insights entries[${index}].category`),
    section: requireString(value.section, `Persona insights entries[${index}].section`),
    items: value.items as string[],
    memoriesAnalyzed: value.memoriesAnalyzed as number,
    confidence: value.confidence,
    reasoning: requireString(value.reasoning, `Persona insights entries[${index}].reasoning`),
    ...(value.archiveCompared === undefined
      ? {}
      : { archiveCompared: requireString(value.archiveCompared, `Persona insights entries[${index}].archiveCompared`) }),
    sessionId: requireString(value.sessionId, `Persona insights entries[${index}].sessionId`),
  }
}

function migrateLegacyInsights(value: Record<string, unknown>): PersonaInsights | null {
  if (value.version !== '1.0.0' || !Array.isArray(value.insights)) return null
  const entries = value.insights.map((raw, index): PersonaInsightEntry => {
    if (!isRecord(raw)) throw new Error(`Legacy persona insights[${index}] must be an object`)
    const id = requireString(raw.id, `Legacy persona insights[${index}].id`)
    const timestamp = requireString(raw.createdAt, `Legacy persona insights[${index}].createdAt`)
    const confidence = raw.confidence
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`Legacy persona insights[${index}].confidence must be between 0 and 1`)
    }
    return {
      timestamp,
      type: 'update',
      category: 'legacy',
      section: requireString(raw.type, `Legacy persona insights[${index}].type`),
      items: [requireString(raw.content, `Legacy persona insights[${index}].content`)],
      memoriesAnalyzed: 0,
      confidence,
      reasoning: requireString(raw.source, `Legacy persona insights[${index}].source`),
      sessionId: `legacy:${id}`,
    }
  })
  return {
    version: PERSONA_INSIGHTS_VERSION,
    lastUpdated: typeof value.lastUpdated === 'string' ? value.lastUpdated : null,
    entries,
  }
}

export function validatePersonaInsights(value: unknown): PersonaInsights {
  if (!isRecord(value)) throw new Error('Persona insights must be an object')
  const migrated = migrateLegacyInsights(value)
  if (migrated) return migrated
  if (value.version !== PERSONA_INSIGHTS_VERSION) {
    throw new Error(`Persona insights must use version ${PERSONA_INSIGHTS_VERSION}`)
  }
  if (!Array.isArray(value.entries)) throw new Error('Persona insights entries must be an array')
  if (value.entries.length > 1000) throw new Error('Persona insights cannot contain more than 1000 entries')
  if (value.lastUpdated !== null && typeof value.lastUpdated !== 'string') {
    throw new Error('Persona insights lastUpdated must be a string or null')
  }
  return {
    version: PERSONA_INSIGHTS_VERSION,
    lastUpdated: value.lastUpdated as string | null,
    entries: value.entries.map(parseEntry),
  }
}

function insightsRequest(username: string) {
  return {
    username,
    category: 'config' as const,
    subcategory: 'persona',
    relativePath: 'insights.json',
  }
}

export async function writePersonaInsights(username: string, value: PersonaInsights): Promise<void> {
  const validated = validatePersonaInsights(value)
  const serialized = JSON.stringify(validated, null, 2)
  if (Buffer.byteLength(serialized) > MAX_PERSONA_INSIGHTS_BYTES) {
    throw new Error(`Persona insights exceeds ${MAX_PERSONA_INSIGHTS_BYTES} bytes`)
  }
  const write = await storageClient.write({
    ...insightsRequest(username),
    data: serialized,
    encoding: 'utf8',
  })
  if (!write.success) throw new Error(write.error || 'Cannot persist persona insights')
}

export async function readPersonaInsights(username: string): Promise<PersonaInsights> {
  const read = await storageClient.read({ ...insightsRequest(username), encoding: 'utf8' })
  if (!read.success) {
    if (read.error?.startsWith('File not found:')) {
      return { version: PERSONA_INSIGHTS_VERSION, lastUpdated: null, entries: [] }
    }
    throw new Error(read.error || 'Cannot read persona insights')
  }
  const serialized = typeof read.data === 'string' ? read.data : read.data?.toString('utf8')
  if (!serialized) throw new Error('Persona insights is empty')
  if (Buffer.byteLength(serialized) > MAX_PERSONA_INSIGHTS_BYTES) {
    throw new Error(`Persona insights exceeds ${MAX_PERSONA_INSIGHTS_BYTES} bytes`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  } catch (error) {
    throw new Error(`Cannot parse persona insights: ${(error as Error).message}`)
  }
  const validated = validatePersonaInsights(raw)
  if (isRecord(raw) && Array.isArray(raw.insights)) await writePersonaInsights(username, validated)
  return validated
}

export async function appendPersonaInsights(
  username: string,
  entries: PersonaInsightEntry[],
  maxEntries: number,
  updatedAt: string,
): Promise<void> {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) {
    throw new Error('Persona insights maximum entry count must be an integer between 1 and 1000')
  }
  const current = await readPersonaInsights(username)
  const sessionIds = new Set(entries.map(entry => entry.sessionId))
  await writePersonaInsights(username, {
    version: PERSONA_INSIGHTS_VERSION,
    lastUpdated: updatedAt,
    entries: [
      ...entries,
      ...current.entries.filter(entry => !sessionIds.has(entry.sessionId)),
    ].slice(0, maxEntries),
  })
}
