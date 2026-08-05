import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateEnvironmentRouterDecision,
  type EnvironmentRouterDecision,
} from '@metahuman/core/environment-classifier'

export const CLASSIFIER_LANE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
export const REPOSITORY_ROOT = resolve(CLASSIFIER_LANE_DIRECTORY, '../../..')
export const CORPUS_PATH = resolve(CLASSIFIER_LANE_DIRECTORY, 'corpus.json')
export const HELD_OUT_LOCK_PATH = resolve(CLASSIFIER_LANE_DIRECTORY, 'held-out.lock.json')

export type CorpusSplit = 'development' | 'held_out'
export type SelectedSplit = CorpusSplit | 'all'

export interface ClassifierConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface EnvironmentClassifierCase {
  id: string
  suite: string
  split: CorpusSplit
  risk: string
  description: string
  input: {
    envelope: {
      currentInstruction: string
      currentEnvironment: Record<string, unknown>
    }
    recentConversation: ClassifierConversationMessage[]
  }
  expected: EnvironmentRouterDecision
}

export interface EnvironmentClassifierCorpus {
  version: number
  owner: string
  contract: string
  classificationTarget: string
  sanitization: {
    source: string
    containsUserOrPersonaData: boolean
  }
  counts: {
    total: number
    development: number
    heldOut: number
  }
  cases: EnvironmentClassifierCase[]
}

export interface HeldOutLock {
  version: number
  algorithm: 'sha256'
  canonicalization: 'recursive-key-sort-json'
  caseIds: string[]
  digest: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
  )
}

export function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

export function computeHeldOutDigest(corpus: EnvironmentClassifierCorpus): string {
  return sha256(
    corpus.cases
      .filter(testCase => testCase.split === 'held_out')
      .sort((left, right) => left.id.localeCompare(right.id)),
  )
}

export function validateCorpus(
  corpus: EnvironmentClassifierCorpus,
  lock: HeldOutLock,
): string[] {
  const errors: string[] = []
  if (corpus.cases.length !== 64) errors.push(`corpus must contain 64 cases; found ${corpus.cases.length}`)

  const ids = corpus.cases.map(testCase => testCase.id)
  const uniqueIds = new Set(ids)
  if (uniqueIds.size !== ids.length) errors.push('corpus case ids must be unique')

  const developmentCases = corpus.cases.filter(testCase => testCase.split === 'development')
  const heldOutCases = corpus.cases.filter(testCase => testCase.split === 'held_out')
  if (developmentCases.length !== 48) errors.push(`development split must contain 48 cases; found ${developmentCases.length}`)
  if (heldOutCases.length !== 16) errors.push(`held-out split must contain 16 cases; found ${heldOutCases.length}`)

  if (corpus.counts.total !== 64
    || corpus.counts.development !== developmentCases.length
    || corpus.counts.heldOut !== heldOutCases.length) {
    errors.push('declared corpus counts do not match case contents')
  }
  if (corpus.sanitization.containsUserOrPersonaData !== false) {
    errors.push('corpus sanitization declaration must reject user or persona data')
  }

  const requiredSuites = [
    'conversation',
    'memory',
    'state_query',
    'fresh_vision',
    'vision_acquisition',
    'one_shot_movement',
    'bounded_task',
    'delegated_intention',
    'persisted_contract',
    'ambiguity',
    'unsafe_action_authority',
  ]
  for (const suite of requiredSuites) {
    if (!corpus.cases.some(testCase => testCase.suite === suite)) {
      errors.push(`required suite is missing: ${suite}`)
    }
  }

  for (const testCase of corpus.cases) {
    const validation = validateEnvironmentRouterDecision(testCase.expected)
    if (!validation.valid) {
      errors.push(`${testCase.id}: invalid expected route: ${validation.errors.join('; ')}`)
    }
    if (!testCase.input?.envelope?.currentInstruction?.trim()) {
      errors.push(`${testCase.id}: currentInstruction is required`)
    }
    if (!isRecord(testCase.input?.envelope?.currentEnvironment)) {
      errors.push(`${testCase.id}: currentEnvironment must be an object`)
    }
    if (!Array.isArray(testCase.input?.recentConversation)) {
      errors.push(`${testCase.id}: recentConversation must be an array`)
    }
  }

  const lockedIds = [...lock.caseIds].sort()
  const actualHeldOutIds = heldOutCases.map(testCase => testCase.id).sort()
  if (JSON.stringify(lockedIds) !== JSON.stringify(actualHeldOutIds)) {
    errors.push('held-out case ids do not match held-out.lock.json')
  }
  if (lock.digest !== computeHeldOutDigest(corpus)) {
    errors.push('held-out case contents do not match the locked digest')
  }

  const serializedCorpus = JSON.stringify(corpus)
  const prohibitedPatterns: Array<[string, RegExp]> = [
    ['absolute home path', /\/home\//i],
    ['runtime data path', /(?:^|[/"'])\b(?:persona|profiles|memory|logs|user-data)\//i],
    ['credential-shaped value', /(?:api[_-]?key|access[_-]?token|bearer\s+[a-z0-9._-]+)/i],
  ]
  for (const [label, pattern] of prohibitedPatterns) {
    if (pattern.test(serializedCorpus)) errors.push(`corpus contains prohibited ${label}`)
  }

  return errors
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function loadLockedCorpus(): Promise<{
  corpus: EnvironmentClassifierCorpus
  lock: HeldOutLock
}> {
  const corpus = await loadJson<EnvironmentClassifierCorpus>(CORPUS_PATH)
  const lock = await loadJson<HeldOutLock>(HELD_OUT_LOCK_PATH)
  const errors = validateCorpus(corpus, lock)
  if (errors.length > 0) {
    throw new Error(`Environment classifier corpus validation failed:\n- ${errors.join('\n- ')}`)
  }
  return { corpus, lock }
}
