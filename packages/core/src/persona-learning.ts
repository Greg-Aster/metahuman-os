import type { PersonaCore } from './identity.js'
import type { PsychoanalyzerConfig, PsychoanalyzerFieldPath } from './psychoanalyzer-config.js'

export type PersonaLearningOperation = 'add' | 'remove' | 'update'

export interface PersonaLearningChange {
  operation: PersonaLearningOperation
  path: PsychoanalyzerFieldPath
  value: unknown
  evidenceIds: string[]
  reason: string
}

export interface PersonaLearningProposal {
  summary: string
  confidence: number
  changes: PersonaLearningChange[]
}

export interface AppliedPersonaLearningChange extends PersonaLearningChange {
  index: number
  previousValue?: unknown
}

export interface PersonaLearningApplyResult {
  persona: PersonaCore
  applied: AppliedPersonaLearningChange[]
  rejected: Array<{ index: number; reason: string }>
}

export interface PersonaLearningApplyOptions {
  appliedAt?: string
}

const TRAITS = new Set([
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism',
])

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function clonePersona(persona: PersonaCore): PersonaCore {
  return structuredClone(persona)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertKnownKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter(key => !allowedSet.has(key))
  if (unknown.length > 0) throw new Error(`${label} has unsupported fields: ${unknown.join(', ')}`)
}

function requireText(value: unknown, label: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`)
  }
  return value.trim()
}

function validateValue(path: PsychoanalyzerFieldPath, operation: PersonaLearningOperation, value: unknown): unknown {
  if (path === 'personality.traits') {
    if (operation !== 'update' || !isRecord(value)) {
      throw new Error('personality.traits changes must be update objects')
    }
    assertKnownKeys(value, ['trait', 'score'], 'personality.traits value')
    const trait = requireText(value.trait, 'trait', 40)
    const score = value.score
    if (!TRAITS.has(trait) || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error('trait updates require a known trait and score between 0 and 1')
    }
    return { trait, score }
  }

  if (path === 'decisionHeuristics') {
    if (operation === 'remove') return requireText(value, 'heuristic removal')
    if (!isRecord(value)) throw new Error('decisionHeuristics additions must be objects')
    assertKnownKeys(value, ['signal', 'response'], 'decisionHeuristics value')
    return {
      signal: requireText(value.signal, 'heuristic signal'),
      response: requireText(value.response, 'heuristic response'),
    }
  }

  if (operation === 'update') {
    throw new Error(`${path} supports only add or remove operations`)
  }
  return requireText(value, `${path} value`)
}

export function validatePersonaLearningProposal(
  value: unknown,
  allowedEvidenceIds: ReadonlySet<string>,
): PersonaLearningProposal {
  if (!isRecord(value)) throw new Error('Persona learning response must be a JSON object')
  assertKnownKeys(value, ['summary', 'confidence', 'changes'], 'Persona learning response')
  const summary = requireText(value.summary, 'summary', 1000)
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1) {
    throw new Error('confidence must be a number between 0 and 1')
  }
  if (!Array.isArray(value.changes) || value.changes.length > 30) {
    throw new Error('changes must be an array with at most 30 items')
  }

  const changes = value.changes.map((raw, index): PersonaLearningChange => {
    if (!isRecord(raw)) throw new Error(`changes[${index}] must be an object`)
    assertKnownKeys(raw, ['operation', 'path', 'value', 'evidenceIds', 'reason'], `changes[${index}]`)
    if (raw.operation !== 'add' && raw.operation !== 'remove' && raw.operation !== 'update') {
      throw new Error(`changes[${index}].operation is invalid`)
    }
    const path = requireText(raw.path, `changes[${index}].path`, 80) as PsychoanalyzerFieldPath
    const allowedPaths = new Set<PsychoanalyzerFieldPath>([
      'personality.traits',
      'personality.communicationStyle',
      'personality.interests',
      'values.core',
      'goals',
      'context.domains',
      'context.currentFocus',
      'context.projects',
      'decisionHeuristics',
      'writingStyle.motifs',
    ])
    if (!allowedPaths.has(path)) throw new Error(`changes[${index}].path is not allowed`)
    if (!Array.isArray(raw.evidenceIds) || raw.evidenceIds.length === 0
      || raw.evidenceIds.some(id => typeof id !== 'string' || !allowedEvidenceIds.has(id))) {
      throw new Error(`changes[${index}].evidenceIds must reference selected memories`)
    }
    return {
      operation: raw.operation,
      path,
      value: validateValue(path, raw.operation, raw.value),
      evidenceIds: Array.from(new Set(raw.evidenceIds as string[])),
      reason: requireText(raw.reason, `changes[${index}].reason`, 1000),
    }
  })

  return { summary, confidence: value.confidence, changes }
}

function collectionsFor(persona: PersonaCore, path: PsychoanalyzerFieldPath): unknown[][] {
  const anyPersona = persona as Record<string, any>
  if (!isRecord(anyPersona.personality)) anyPersona.personality = {}
  if (!isRecord(anyPersona.values)) anyPersona.values = { core: [], boundaries: [] }
  if (!isRecord(anyPersona.goals)) {
    anyPersona.goals = { shortTerm: [], midTerm: [], longTerm: [] }
  }
  if (!isRecord(anyPersona.context)) {
    anyPersona.context = { domains: [], projects: [], currentFocus: [] }
  }
  switch (path) {
    case 'personality.communicationStyle':
      if (!isRecord(anyPersona.personality.communicationStyle)) {
        anyPersona.personality.communicationStyle = { tone: [], verbosity: 'balanced', emphasis: 'clarity' }
      }
      if (!Array.isArray(anyPersona.personality.communicationStyle.tone)) {
        anyPersona.personality.communicationStyle.tone = []
      }
      return [anyPersona.personality.communicationStyle.tone]
    case 'personality.interests':
      if (!Array.isArray(anyPersona.personality.interests)) anyPersona.personality.interests = []
      return [anyPersona.personality.interests]
    case 'values.core':
      if (!Array.isArray(anyPersona.values.core)) anyPersona.values.core = []
      return [anyPersona.values.core]
    case 'goals':
      for (const tier of ['shortTerm', 'midTerm', 'longTerm']) {
        if (!Array.isArray(anyPersona.goals[tier])) anyPersona.goals[tier] = []
      }
      return [anyPersona.goals.shortTerm, anyPersona.goals.midTerm, anyPersona.goals.longTerm]
    case 'context.domains':
      if (!Array.isArray(anyPersona.context.domains)) anyPersona.context.domains = []
      return [anyPersona.context.domains]
    case 'context.currentFocus':
      if (!Array.isArray(anyPersona.context.currentFocus)) anyPersona.context.currentFocus = []
      return [anyPersona.context.currentFocus]
    case 'context.projects':
      if (!Array.isArray(anyPersona.context.projects)) anyPersona.context.projects = []
      return [anyPersona.context.projects]
    case 'decisionHeuristics':
      if (!Array.isArray(anyPersona.decisionHeuristics)) anyPersona.decisionHeuristics = []
      return [anyPersona.decisionHeuristics]
    case 'writingStyle.motifs':
      if (!isRecord(anyPersona.writingStyle)) anyPersona.writingStyle = {}
      if (!Array.isArray(anyPersona.writingStyle.motifs)) anyPersona.writingStyle.motifs = []
      return [anyPersona.writingStyle.motifs]
    default: throw new Error(`${path} is not a collection path`)
  }
}

function comparableText(path: PsychoanalyzerFieldPath, value: unknown): string {
  if (typeof value === 'string') return normalize(value)
  if (!isRecord(value)) return ''
  if (path === 'values.core') return normalize(String(value.value ?? ''))
  if (path === 'goals') return normalize(String(value.goal ?? ''))
  if (path === 'context.projects') return normalize(String(value.name ?? value.project ?? ''))
  if (path === 'decisionHeuristics') return normalize(String(value.signal ?? ''))
  return ''
}

function additionFor(
  path: PsychoanalyzerFieldPath,
  value: unknown,
  change: PersonaLearningChange,
  appliedAt: string,
): unknown {
  if (path === 'values.core') {
    return { value, description: change.reason, priority: 50 }
  }
  if (path === 'goals') {
    return {
      goal: value,
      status: 'proposed',
      sourceType: 'psychoanalyzer',
      proposedAt: appliedAt,
      proposedReason: change.reason,
    }
  }
  return value
}

function recordProvenance(
  persona: PersonaCore,
  change: PersonaLearningChange,
  key: string,
  appliedAt: string,
): void {
  const entries = persona.learningProvenance ??= []
  const existing = entries.find(entry => entry.path === change.path && entry.key === key)
  const next = {
    path: change.path,
    key,
    evidenceIds: change.evidenceIds,
    reason: change.reason,
    updatedAt: appliedAt,
  }
  if (existing) Object.assign(existing, next)
  else entries.push(next)
}

function removeProvenance(persona: PersonaCore, path: PsychoanalyzerFieldPath, key: string): void {
  if (!persona.learningProvenance) return
  persona.learningProvenance = persona.learningProvenance.filter(
    entry => entry.path !== path || entry.key !== key,
  )
}

function removalAllowed(path: PsychoanalyzerFieldPath, config: PsychoanalyzerConfig): boolean {
  if (path === 'goals') return config.reconciliation.removeStaleGoals
  if (path === 'personality.interests') return config.reconciliation.removeStaleInterests
  if (path === 'values.core') return config.reconciliation.removeContradictedValues
  if (path === 'decisionHeuristics') return config.reconciliation.removeUnusedHeuristics
  return true
}

export function applyPersonaLearningProposal(
  persona: PersonaCore,
  proposal: PersonaLearningProposal,
  config: PsychoanalyzerConfig,
  options: PersonaLearningApplyOptions = {},
): PersonaLearningApplyResult {
  const next = clonePersona(persona)
  const applied: AppliedPersonaLearningChange[] = []
  const rejected: Array<{ index: number; reason: string }> = []
  const appliedAt = options.appliedAt ?? new Date().toISOString()

  if (proposal.confidence < config.analysis.confidenceThreshold) {
    return { persona: next, applied, rejected: proposal.changes.map((_, index) => ({ index, reason: 'below confidence threshold' })) }
  }

  proposal.changes.forEach((change, index) => {
    if (!config.updateStrategy.fields[change.path]) {
      rejected.push({ index, reason: 'field disabled by configuration' })
      return
    }

    if (change.path === 'personality.traits') {
      const update = change.value as { trait: string; score: number }
      const traits = (next.personality.traits ??= {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
      }) as Record<string, number>
      const previousValue = traits[update.trait]
      if (previousValue === update.score) {
        rejected.push({ index, reason: 'trait already has the proposed value' })
        return
      }
      traits[update.trait] = update.score
      applied.push({ ...change, index, previousValue })
      recordProvenance(next, change, update.trait, appliedAt)
      return
    }

    const collections = collectionsFor(next, change.path)
    const key = comparableText(change.path, change.value)
    if (!key) {
      rejected.push({ index, reason: 'change value has no comparable identity' })
      return
    }
    const existing = collections
      .map(collection => ({
        collection,
        itemIndex: collection.findIndex(item => comparableText(change.path, item) === key),
      }))
      .find(candidate => candidate.itemIndex >= 0)

    if (change.operation === 'add') {
      if (existing) {
        rejected.push({ index, reason: 'entry already exists' })
        return
      }
      collections[0].push(additionFor(change.path, change.value, change, appliedAt))
      applied.push({ ...change, index })
      recordProvenance(next, change, key, appliedAt)
      return
    }

    if (!removalAllowed(change.path, config)) {
      rejected.push({ index, reason: 'removal disabled by reconciliation configuration' })
      return
    }
    if (!existing) {
      rejected.push({ index, reason: 'entry does not exist' })
      return
    }
    if (config.updateStrategy.preserveUserEdits
      && !next.learningProvenance?.some(entry => entry.path === change.path && entry.key === key)) {
      rejected.push({ index, reason: 'preserveUserEdits protects entries without psychoanalyzer provenance' })
      return
    }
    const [previousValue] = existing.collection.splice(existing.itemIndex, 1)
    applied.push({ ...change, index, previousValue })
    removeProvenance(next, change.path, key)
  })

  return { persona: next, applied, rejected }
}
