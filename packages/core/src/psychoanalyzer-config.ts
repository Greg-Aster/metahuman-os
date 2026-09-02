import fs from 'node:fs'
import path from 'node:path'

import { systemPaths } from './path-builder.js'
import { getProfilePaths } from './paths.js'
import { safeWriteJSON } from './safe-file.js'
import { storageClient } from './storage-client.js'

export const PSYCHOANALYZER_FIELD_PATHS = [
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
] as const

export type PsychoanalyzerFieldPath = typeof PSYCHOANALYZER_FIELD_PATHS[number]

export interface PsychoanalyzerConfig {
  version: string
  enabled: boolean
  memorySelection: {
    strategy: 'priority_recent'
    daysBack: number
    maxMemories: number
    minMemories: number
    excludeTypes: string[]
    priorityTags: string[]
    userInputOnly: boolean
  }
  analysis: {
    model: 'psychotherapist'
    temperature: number
    maxTokens: number
    confidenceThreshold: number
  }
  updateStrategy: {
    preserveUserEdits: boolean
    fields: Record<PsychoanalyzerFieldPath, boolean>
  }
  reconciliation: {
    removeStaleGoals: boolean
    removeStaleInterests: boolean
    removeContradictedValues: boolean
    removeUnusedHeuristics: boolean
  }
  insights: {
    enabled: boolean
    maxEntries: number
  }
}

type UnknownRecord = Record<string, unknown>

const CURRENT_CONFIG_VERSION = '2.0.0'
const LEGACY_CONFIG_VERSION = '1.0.0'

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as UnknownRecord
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function asNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}`)
  }
  return value
}

function asInteger(value: unknown, label: string, min: number, max: number): number {
  const number = asNumber(value, label, min, max)
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`)
  return number
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

export function validatePsychoanalyzerConfig(value: unknown): PsychoanalyzerConfig {
  const root = asRecord(value, 'psychoanalyzer config')
  const configuredVersion = root.version === undefined
    ? LEGACY_CONFIG_VERSION
    : root.version
  if (configuredVersion !== LEGACY_CONFIG_VERSION && configuredVersion !== CURRENT_CONFIG_VERSION) {
    throw new Error(`Unsupported psychoanalyzer config version: ${String(configuredVersion)}`)
  }
  const isLegacy = configuredVersion === LEGACY_CONFIG_VERSION
  const memorySelection = asRecord(root.memorySelection, 'memorySelection')
  const analysis = asRecord(root.analysis, 'analysis')
  const updateStrategy = asRecord(root.updateStrategy, 'updateStrategy')
  const fields = asRecord(updateStrategy.fields, 'updateStrategy.fields')
  const reconciliation = asRecord(root.reconciliation, 'reconciliation')
  const insights = isLegacy && root.insights === undefined
    ? { enabled: true, maxEntries: 100 }
    : asRecord(root.insights, 'insights')

  const configuredStrategy = memorySelection.strategy
  const supportedStrategies = isLegacy
    ? new Set(['recent', 'weighted_random', 'priority_recent'])
    : new Set(['priority_recent'])
  if (!supportedStrategies.has(String(configuredStrategy))) {
    throw new Error(
      isLegacy
        ? 'legacy memorySelection.strategy must be recent, weighted_random, or priority_recent'
        : 'memorySelection.strategy must be priority_recent',
    )
  }
  const strategy = 'priority_recent' as const
  if (analysis.model !== 'psychotherapist') {
    throw new Error('analysis.model must be psychotherapist')
  }

  const parsedFields = Object.fromEntries(
    PSYCHOANALYZER_FIELD_PATHS.map(field => [
      field,
      fields[field] === undefined && isLegacy && field === 'personality.traits'
        ? false
        : fields[field] === undefined && isLegacy && field === 'context.domains'
          ? asBoolean(fields['context.currentFocus'], 'updateStrategy.fields.context.currentFocus')
          : asBoolean(fields[field], `updateStrategy.fields.${field}`),
    ]),
  ) as Record<PsychoanalyzerFieldPath, boolean>

  const maxMemories = asInteger(memorySelection.maxMemories, 'memorySelection.maxMemories', 1, 200)
  const minMemories = asInteger(memorySelection.minMemories, 'memorySelection.minMemories', 1, 200)
  if (minMemories > maxMemories) {
    throw new Error('memorySelection.minMemories cannot exceed maxMemories')
  }

  return {
    version: CURRENT_CONFIG_VERSION,
    enabled: asBoolean(root.enabled, 'enabled'),
    memorySelection: {
      strategy,
      daysBack: asInteger(memorySelection.daysBack, 'memorySelection.daysBack', 1, 3650),
      maxMemories,
      minMemories,
      excludeTypes: asStringArray(memorySelection.excludeTypes, 'memorySelection.excludeTypes'),
      priorityTags: asStringArray(memorySelection.priorityTags, 'memorySelection.priorityTags'),
      userInputOnly: memorySelection.userInputOnly === undefined
        ? true
        : asBoolean(memorySelection.userInputOnly, 'memorySelection.userInputOnly'),
    },
    analysis: {
      model: 'psychotherapist',
      temperature: asNumber(analysis.temperature, 'analysis.temperature', 0, 2),
      maxTokens: analysis.maxTokens === undefined
        ? 2200
        : asInteger(analysis.maxTokens, 'analysis.maxTokens', 256, 8192),
      confidenceThreshold: asNumber(
        analysis.confidenceThreshold,
        'analysis.confidenceThreshold',
        0,
        1,
      ),
    },
    updateStrategy: {
      preserveUserEdits: asBoolean(updateStrategy.preserveUserEdits, 'updateStrategy.preserveUserEdits'),
      fields: parsedFields,
    },
    reconciliation: {
      removeStaleGoals: asBoolean(reconciliation.removeStaleGoals, 'reconciliation.removeStaleGoals'),
      removeStaleInterests: asBoolean(reconciliation.removeStaleInterests, 'reconciliation.removeStaleInterests'),
      removeContradictedValues: asBoolean(
        reconciliation.removeContradictedValues,
        'reconciliation.removeContradictedValues',
      ),
      removeUnusedHeuristics: asBoolean(
        reconciliation.removeUnusedHeuristics,
        'reconciliation.removeUnusedHeuristics',
      ),
    },
    insights: {
      enabled: asBoolean(insights.enabled, 'insights.enabled'),
      maxEntries: asInteger(insights.maxEntries, 'insights.maxEntries', 1, 1000),
    },
  }
}

export function loadPsychoanalyzerConfig(username?: string): PsychoanalyzerConfig {
  const profilePath = username
    ? path.join(getProfilePaths(username).etc, 'psychoanalyzer.json')
    : (() => {
        const profileResult = storageClient.resolvePath({
          category: 'config',
          subcategory: 'etc',
          relativePath: 'psychoanalyzer.json',
        })
        return profileResult.success ? profileResult.path : undefined
      })()
  const configPath = profilePath && fs.existsSync(profilePath)
    ? profilePath
    : path.join(systemPaths.etc, 'psychoanalyzer.json')

  if (!fs.existsSync(configPath)) {
    throw new Error(`Psychoanalyzer configuration not found: ${configPath}`)
  }

  return validatePsychoanalyzerConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')))
}

export function loadSystemPsychoanalyzerConfig(): PsychoanalyzerConfig {
  const configPath = path.join(systemPaths.etc, 'psychoanalyzer.json')
  return validatePsychoanalyzerConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')))
}

export function savePsychoanalyzerConfig(username: string, config: PsychoanalyzerConfig): void {
  const validated = validatePsychoanalyzerConfig(config)
  safeWriteJSON(path.join(getProfilePaths(username).etc, 'psychoanalyzer.json'), validated)
}

export function mergePsychoanalyzerConfig(
  current: PsychoanalyzerConfig,
  patch: unknown,
): PsychoanalyzerConfig {
  const input = asRecord(patch, 'configuration patch')
  const allowed = new Set(['enabled', 'memorySelection', 'analysis', 'updateStrategy', 'reconciliation', 'insights'])
  const unsupported = Object.keys(input).filter(key => !allowed.has(key))
  if (unsupported.length > 0) {
    throw new Error(`Unsupported psychoanalyzer configuration fields: ${unsupported.join(', ')}`)
  }

  const allowedNested: Partial<Record<keyof PsychoanalyzerConfig, string[]>> = {
    memorySelection: ['strategy', 'daysBack', 'maxMemories', 'minMemories', 'excludeTypes', 'priorityTags', 'userInputOnly'],
    analysis: ['model', 'temperature', 'maxTokens', 'confidenceThreshold'],
    updateStrategy: ['preserveUserEdits', 'fields'],
    reconciliation: ['removeStaleGoals', 'removeStaleInterests', 'removeContradictedValues', 'removeUnusedHeuristics'],
    insights: ['enabled', 'maxEntries'],
  }
  for (const [key, nestedKeys] of Object.entries(allowedNested)) {
    if (input[key] === undefined) continue
    const nested = asRecord(input[key], key)
    const unknown = Object.keys(nested).filter(nestedKey => !nestedKeys.includes(nestedKey))
    if (unknown.length > 0) throw new Error(`Unsupported ${key} fields: ${unknown.join(', ')}`)
  }

  const mergeObject = (key: keyof PsychoanalyzerConfig): UnknownRecord => {
    if (input[key] === undefined) return current[key] as UnknownRecord
    return { ...(current[key] as UnknownRecord), ...asRecord(input[key], String(key)) }
  }

  const updateStrategy = mergeObject('updateStrategy')
  if (input.updateStrategy !== undefined) {
    const updatePatch = asRecord(input.updateStrategy, 'updateStrategy')
    if (updatePatch.fields !== undefined) {
      const fieldsPatch = asRecord(updatePatch.fields, 'updateStrategy.fields')
      const unsupportedFields = Object.keys(fieldsPatch).filter(
        field => !PSYCHOANALYZER_FIELD_PATHS.includes(field as PsychoanalyzerFieldPath),
      )
      if (unsupportedFields.length > 0) {
        throw new Error(`Unsupported updateStrategy.fields paths: ${unsupportedFields.join(', ')}`)
      }
      updateStrategy.fields = {
        ...current.updateStrategy.fields,
        ...fieldsPatch,
      }
    }
  }

  return validatePsychoanalyzerConfig({
    ...current,
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    memorySelection: mergeObject('memorySelection'),
    analysis: mergeObject('analysis'),
    updateStrategy,
    reconciliation: mergeObject('reconciliation'),
    insights: mergeObject('insights'),
  })
}
