import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getProfilePaths } from './path-builder.js'
import { getStorageStatus } from './storage-client.js'
import { loadPersonaCore } from './identity.js'
import { buildPersonaSummary } from './persona-summary.js'
import { episodicSourceHash, scanEpisodicMemoryRecords, type EpisodicEvent } from './memory.js'
import { CURATOR_POLICY_VERSION, isTrainingCuratedMemory, type CuratedMemory } from './nodes/curator/contracts.js'
import { scanCuratedMemories, sourceCurationStatus } from './nodes/curator/curated-store.js'
import { parseTrainingDataSettings, validatePersonalizationSample, type PersonalizationSample, type TrainingDataSettings, type CognitiveMode } from './training-schema.js'

export interface TrainingDatasetStats {
  totalMemories: number
  episodicMemories: number
  therapySessions: number
  chatConversations: number
  recentMemories: number
  oldestMemory: string | null
  newestMemory: string | null
  cognitiveModeCounts: Record<CognitiveMode, number>
  organizedMemories: number
  pendingOrganization: number
  curatedMemories: number
  pendingCuration: number
  curatedRecords: number
  validCuratedRecords: number
  invalidCuratedRecords: number
  trainableSamples: number
  estimatedTrainingSamples: number
  latestCuratedAt: string | null
  invalidSourceRecords: number
  obsoleteCuratedRecords: number
  rejectedCuratedRecords: number
  unknownModeRecords: number
}

export interface TrainingDatasetInspection {
  stats: TrainingDatasetStats
  trainableCuratedAt: string[]
  records: CuratedMemory[]
  sources: EpisodicEvent[]
  errors: string[]
  cutoff: string
}

/** The same encrypted source and review owners serve preview and training. */
export function inspectTrainingDataset(username: string, now = Date.now()): TrainingDatasetInspection {
  if (!Number.isFinite(now)) throw new Error('Training inspection requires a valid cutoff')
  const storage = getStorageStatus(username)
  if (!storage.available) throw new Error(storage.error || 'Training profile storage is unavailable')
  const stats: TrainingDatasetStats = {
    totalMemories: 0, episodicMemories: 0, therapySessions: 0, chatConversations: 0,
    recentMemories: 0, oldestMemory: null, newestMemory: null,
    cognitiveModeCounts: { dual: 0, agent: 0, emulation: 0, environment: 0 },
    organizedMemories: 0, pendingOrganization: 0, curatedMemories: 0, pendingCuration: 0,
    curatedRecords: 0, validCuratedRecords: 0, invalidCuratedRecords: 0,
    trainableSamples: 0, estimatedTrainingSamples: 0, latestCuratedAt: null,
    invalidSourceRecords: 0, obsoleteCuratedRecords: 0, rejectedCuratedRecords: 0, unknownModeRecords: 0,
  }
  const errors: string[] = []
  const sources: EpisodicEvent[] = []
  const currentSources = new Map<string, { recordId: string; filename: string }>()
  for (const outcome of scanEpisodicMemoryRecords(username)) {
    if (outcome.status === 'failed') {
      stats.invalidSourceRecords++
      errors.push(outcome.relativePath + ': ' + outcome.error)
      continue
    }
    const source = outcome.record.event
    const timestamp = Date.parse(source.timestamp)
    if (timestamp > now) continue
    sources.push(source)
    stats.episodicMemories++
    if (source.type === 'therapy_session') stats.therapySessions++
    if (source.type === 'conversation' && source.metadata?.role !== 'assistant') stats.chatConversations++
    if (source.metadata?.processed === true) stats.organizedMemories++
    if (sourceCurationStatus(username, source).current) {
      stats.curatedMemories++
      currentSources.set(source.id, { recordId: source.metadata!.curatorRecordId as string, filename: source.metadata!.curatorRecordFile as string })
    }
    const mode = source.metadata?.cognitiveMode
    if (mode === 'dual' || mode === 'agent' || mode === 'emulation' || mode === 'environment') stats.cognitiveModeCounts[mode]++
    else stats.unknownModeRecords++
    if (!stats.oldestMemory || timestamp < Date.parse(stats.oldestMemory)) stats.oldestMemory = source.timestamp
    if (!stats.newestMemory || timestamp > Date.parse(stats.newestMemory)) stats.newestMemory = source.timestamp
    if (timestamp > now - 30 * 86400000) stats.recentMemories++
  }
  stats.totalMemories = stats.episodicMemories
  stats.pendingOrganization = stats.episodicMemories - stats.organizedMemories
  stats.pendingCuration = stats.episodicMemories - stats.curatedMemories
  const sourceHashes = new Map(sources.map(source => [source.id, episodicSourceHash(source)]))
  const records: CuratedMemory[] = []
  const trainableCuratedAt: string[] = []
  for (const outcome of scanCuratedMemories(username)) {
    stats.curatedRecords++
    if (outcome.status === 'failed') {
      stats.invalidCuratedRecords++
      errors.push(outcome.filename + ': ' + outcome.error)
      continue
    }
    stats.validCuratedRecords++
    const record = outcome.memory
    if (!stats.latestCuratedAt || Date.parse(record.curatedAt) > Date.parse(stats.latestCuratedAt)) stats.latestCuratedAt = record.curatedAt
    if (record.provenance?.policyVersion !== CURATOR_POLICY_VERSION
        || record.sourceMemoryIds.some(id => currentSources.get(id)?.recordId !== record.id || currentSources.get(id)?.filename !== outcome.filename || sourceHashes.get(id) !== record.provenance!.sourceHashes[id])) {
      stats.obsoleteCuratedRecords++
      continue
    }
    records.push(record)
    if (isTrainingCuratedMemory(record)) {
      stats.trainableSamples++
      trainableCuratedAt.push(record.curatedAt)
    } else stats.rejectedCuratedRecords++
  }
  stats.estimatedTrainingSamples = stats.trainableSamples
  return { stats, trainableCuratedAt, records, sources, errors, cutoff: new Date(now).toISOString() }
}

export interface PersonalizationDatasetOptions {
  history?: TrainingDatasetHistory
  maxSamples?: number | null
  modeFilter?: CognitiveMode
  recentDays?: number
  olderSamples?: number
  personaContext?: string
}

export function trainingPersonaContext(username: string, settings: TrainingDataSettings): string | undefined {
  if (!settings.includePersona) return undefined
  const summary = buildPersonaSummary(loadPersonaCore(username))
  return (settings.objective === 'human-continuation'
    ? 'Write the next reply in the first-person voice of this persona.\n\n'
    : 'Respond in the configured persona, preserving its role and identity.\n\n') + summary
}
export interface SelectedPersonalizationDataset {
  train: PersonalizationSample[]
  evaluation: PersonalizationSample[]
  excluded: Record<string, number>
  cutoff: string
  settings: TrainingDataSettings
  sourceIds: string[]
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
export function trainingSampleContentHash(row: PersonalizationSample): string {
  return digest(JSON.stringify(row.messages.filter(message => message.role !== 'system')))
}

export interface TrainingDatasetHistory {
  assignments: Record<string, 'train' | 'evaluation' | 'conflict'>
  completedSampleIds: string[]
}

/** Immutable run manifests prevent previously exposed data moving into a later holdout. */
export function readTrainingDatasetHistory(username: string): TrainingDatasetHistory {
  const history: TrainingDatasetHistory = { assignments: {}, completedSampleIds: [] }
  const root = path.join(getProfilePaths(username).out, 'adapters')
  if (!fs.existsSync(root)) return history
  for (const date of fs.readdirSync(root, { withFileTypes: true })) {
    if (!date.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(date.name)) continue
    for (const run of fs.readdirSync(path.join(root, date.name), { withFileTypes: true })) {
      if (!run.isDirectory()) continue
      const directory = path.join(root, date.name, run.name)
      const file = path.join(directory, 'dataset-manifest.json')
      if (!fs.existsSync(file)) continue
      if (fs.realpathSync(file) !== path.join(fs.realpathSync(root), date.name, run.name, 'dataset-manifest.json')) throw new Error('Dataset history contains a redirected manifest')
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
      const { datasetId, ...snapshot } = manifest
      if (manifest.version !== 2 || digest(JSON.stringify(snapshot)) !== datasetId) throw new Error('Dataset history contains an invalid manifest: ' + run.name)
      const receipt = path.join(directory, 'run.json')
      const completed = fs.existsSync(receipt) && ['candidate', 'rejected'].includes(JSON.parse(fs.readFileSync(receipt, 'utf8')).status)
      for (const split of ['train', 'evaluation'] as const) {
        const record = manifest[split]
        if (!Array.isArray(record?.sourceIds)) throw new Error('Dataset history is missing source identities')
        const keys = [
          ...record.sourceIds.map((id: string) => 'source:' + id),
          ...(record.groups ?? []).map((id: string) => 'group:' + id),
          ...(record.contentHashes ?? []).map((id: string) => 'content:' + id),
        ]
        for (const key of keys) {
          const previous = history.assignments[key]
          history.assignments[key] = previous && previous !== split ? 'conflict' : split
        }
        if (completed && split === 'train') history.completedSampleIds.push(...(record.sampleIds ?? []))
      }
    }
  }
  history.completedSampleIds = [...new Set(history.completedSampleIds)]
  return history
}
function orderRows(rows: PersonalizationSample[], seed: string): PersonalizationSample[] {
  return [...rows].sort((a, b) => digest(seed + a.id).localeCompare(digest(seed + b.id)) || a.id.localeCompare(b.id))
}
function sample(
  record: CuratedMemory, sourceIds: string[], hashes: Record<string, string>,
  prompt: string, response: string, group: string, settings: TrainingDataSettings,
  curatedRecordIds = [record.id],
): PersonalizationSample {
  return {
    id: digest(JSON.stringify([settings.objective, sourceIds, hashes])).slice(0, 32),
    messages: [{ role: 'user', content: prompt }, { role: 'assistant', content: response }],
    metadata: {
      sourceIds, sourceHashes: hashes, curatedRecordIds, group, timestamp: record.originalTimestamp,
      sourceType: record.memoryType, mode: record.cognitiveMode, objective: settings.objective,
      targetAuthor: settings.objective === 'human-continuation' ? 'human' : 'assistant',
      synthetic: record.provenance!.kind === 'synthetic-exchange',
    },
  }
}

/** Allocate the user's relative type weights deterministically, including zero. */
function weightedSelection(rows: PersonalizationSample[], settings: TrainingDataSettings, maximum: number): PersonalizationSample[] {
  const groups = new Map<string, PersonalizationSample[]>()
  for (const row of orderRows(rows, settings.seed)) {
    const type = row.metadata.sourceType
    const group = groups.get(type) ?? []
    group.push(row)
    groups.set(type, group)
  }
  const taken = new Map<string, number>()
  const positions = new Map<string, number>()
  const selected: PersonalizationSample[] = []
  const effectiveMaximum = Math.min(maximum, rows.length)
  const syntheticMaximum = Math.floor(effectiveMaximum * settings.maxSyntheticPercent / 100)
  let syntheticTaken = 0
  while (selected.length < effectiveMaximum) {
    const available = [...groups.keys()].filter(type => {
      const group = groups.get(type)!
      let position = positions.get(type) ?? 0
      while (position < group.length && group[position]!.metadata.synthetic && syntheticTaken >= syntheticMaximum) position++
      positions.set(type, position)
      return position < group.length
    })
    if (available.length === 0) break
    available.sort((a, b) => ((taken.get(a) ?? 0) + 1) / settings.memoryTypes.percentages[a]!
      - ((taken.get(b) ?? 0) + 1) / settings.memoryTypes.percentages[b]! || a.localeCompare(b))
    const type = available[0]!
    const position = positions.get(type) ?? 0
    const row = groups.get(type)![position]!
    selected.push(row)
    if (row.metadata.synthetic) syntheticTaken++
    positions.set(type, position + 1)
    taken.set(type, (taken.get(type) ?? 0) + 1)
  }
  return orderRows(selected, settings.seed)
}

/**
 * One dataset policy for previews and trainers. Human targets use the actual
 * next human turn after an assistant message. Modes never reverse a pair.
 * Selection and group splits depend only on frozen inputs and declared settings.
 */
export function selectPersonalizationDataset(
  inspection: Pick<TrainingDatasetInspection, 'records' | 'sources' | 'cutoff'>,
  rawSettings: TrainingDataSettings,
  options: PersonalizationDatasetOptions = {},
): SelectedPersonalizationDataset {
  const settings = parseTrainingDataSettings(rawSettings)
  const maximum = options.maxSamples === null ? Number.MAX_SAFE_INTEGER : options.maxSamples ?? 3000
  const days = options.recentDays ?? 36500
  const older = options.olderSamples ?? 0
  if (options.maxSamples !== null && (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_000_000)) throw new Error('maxSamples must be null or an integer from 1 to 1000000')
  if (!Number.isSafeInteger(days) || days < 1 || days > 36500) throw new Error('recentDays must be an integer from 1 to 36500')
  if (!Number.isSafeInteger(older) || older < 0 || older > 1_000_000) throw new Error('olderSamples must be an integer from 0 to 1000000')
  if (settings.includePersona && !options.personaContext?.trim()) throw new Error('Persona context is enabled but unavailable')
  const excluded: Record<string, number> = {}
  const exclude = (reason: string, count = 1) => { excluded[reason] = (excluded[reason] ?? 0) + count }
  const eligible = inspection.records.filter(record => {
    if (record.provenance?.policyVersion !== CURATOR_POLICY_VERSION) { exclude('obsolete-review'); return false }
    if (!isTrainingCuratedMemory(record)) { exclude('rejected'); return false }
    if (record.cognitiveModeSource !== 'metadata') { exclude('unknown-mode'); return false }
    if (options.modeFilter && record.cognitiveMode !== options.modeFilter) { exclude('mode-filter'); return false }
    return true
  }).filter(isTrainingCuratedMemory)
  const candidates: PersonalizationSample[] = []
  if (settings.objective === 'assistant-continuation') {
    for (const record of eligible) candidates.push(sample(
      record, record.sourceMemoryIds, record.provenance!.sourceHashes,
      record.userMessage, record.assistantResponse,
      record.provenance!.sessionId ? 'session:' + record.provenance!.sessionId : 'source:' + record.sourceMemoryIds[0],
      settings,
    ))
  } else {
    const bySource = new Map(eligible.flatMap(record => record.sourceMemoryIds.map(id => [id, record] as const)))
    const sessions = new Map<string, EpisodicEvent[]>()
    for (const source of inspection.sources) {
      const sessionId = source.metadata?.sessionId
      const role = source.metadata?.role
      if (source.type !== 'conversation' || typeof sessionId !== 'string' || !sessionId
          || (role !== 'user' && role !== 'assistant')) continue
      const session = sessions.get(sessionId) ?? []
      session.push(source)
      sessions.set(sessionId, session)
    }
    const usedRecords = new Set<string>()
    for (const [sessionId, sources] of sessions) {
      sources.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
      for (let index = 1; index < sources.length; index++) {
        const human = sources[index]!
        const preceding = sources[index - 1]!
        const record = bySource.get(human.id)
        const previous = bySource.get(preceding.id)
        if (human.metadata?.role !== 'user' || preceding.metadata?.role !== 'assistant'
            || !record || !previous || record.id === previous.id
            || record.provenance?.kind !== 'recorded-exchange' || previous.provenance?.kind !== 'recorded-exchange'
            || record.cognitiveMode !== previous.cognitiveMode || Date.parse(preceding.timestamp) >= Date.parse(human.timestamp)) continue
        candidates.push(sample(record, [preceding.id, human.id], {
          [preceding.id]: episodicSourceHash(preceding), [human.id]: episodicSourceHash(human),
        }, previous.assistantResponse, record.userMessage, 'session:' + sessionId, settings, [previous.id, record.id]))
        usedRecords.add(record.id)
      }
    }
    exclude('no-verified-human-continuation', eligible.length - usedRecords.size)
  }
  const cutoff = Date.parse(inspection.cutoff)
  const recentCutoff = cutoff - days * 86400000
  const allowed = candidates.filter(row => {
    if (!(settings.memoryTypes.percentages[row.metadata.sourceType] > 0)) { exclude('type-disabled-or-unknown'); return false }
    if (Date.parse(row.metadata.timestamp) > cutoff) { exclude('after-cutoff'); return false }
    return true
  })
  const recent = allowed.filter(row => Date.parse(row.metadata.timestamp) >= recentCutoff)
  const historical = orderRows(allowed.filter(row => Date.parse(row.metadata.timestamp) < recentCutoff), settings.seed).slice(0, older)
  exclude('outside-rolling-window', allowed.length - recent.length - historical.length)
  const partitions: Record<'train' | 'evaluation', PersonalizationSample[]> = { train: [], evaluation: [] }
  const groupHistory = new Map<string, Set<'train' | 'evaluation' | 'conflict'>>()
  for (const row of [...recent, ...historical]) {
    const keys = ['group:' + row.metadata.group, 'content:' + trainingSampleContentHash(row), ...row.metadata.sourceIds.map(id => 'source:' + id)]
    const previous = groupHistory.get(row.metadata.group) ?? new Set<'train' | 'evaluation' | 'conflict'>()
    for (const key of keys) { const split = options.history?.assignments[key]; if (split) previous.add(split) }
    groupHistory.set(row.metadata.group, previous)
  }
  for (const row of [...recent, ...historical]) {
    const bucket = parseInt(digest(settings.seed + '\0' + row.metadata.group).slice(0, 8), 16) % 100
    const previous = groupHistory.get(row.metadata.group)!
    if (previous.has('conflict') || previous.size > 1) { exclude('historical-split-conflict'); continue }
    const split = previous.has('evaluation') ? 'evaluation' : previous.has('train') ? 'train' : bucket < settings.evaluationPercent ? 'evaluation' : 'train'
    partitions[split].push(row)
  }
  // Evaluation wins exact-content collisions, including copies in other sessions.
  const seen = new Set<string>()
  for (const split of ['evaluation', 'train'] as const) {
    const deduped = orderRows(partitions[split], settings.seed).filter(row => {
      const hash = digest(JSON.stringify(row.messages))
      if (seen.has(hash)) { exclude('duplicate'); return false }
      seen.add(hash)
      return true
    })
    const recorded = deduped.filter(row => !row.metadata.synthetic)
    const synthetic = deduped.filter(row => row.metadata.synthetic)
    const syntheticLimit = Math.floor(recorded.length * settings.maxSyntheticPercent / (100 - settings.maxSyntheticPercent))
    exclude('synthetic-cap', Math.max(0, synthetic.length - syntheticLimit))
    const budget = split === 'train' ? maximum : Math.ceil(maximum * settings.evaluationPercent / (100 - settings.evaluationPercent))
    partitions[split] = weightedSelection([...recorded, ...synthetic.slice(0, syntheticLimit)], settings, budget)
    exclude('sample-budget', recorded.length + Math.min(synthetic.length, syntheticLimit) - partitions[split].length)
    for (const row of partitions[split]) {
      if (settings.includePersona) row.messages.unshift({ role: 'system', content: options.personaContext! })
      validatePersonalizationSample(row)
    }
  }
  return { ...partitions, settings, cutoff: inspection.cutoff, excluded,
    sourceIds: [...new Set([...partitions.train, ...partitions.evaluation].flatMap(row => row.metadata.sourceIds))].sort() }
}
