import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  buildEnvironmentSelectorEnvelope,
  buildEnvironmentSelectorSystemPrompt,
  validateEnvironmentSelectorOutput,
  type EnvironmentObservation,
} from '@metahuman/core'

import {
  ACTION_SELECTOR_DIRECTORY,
  REPOSITORY_ROOT,
  loadPriorEvaluationEvidence,
  sha256,
} from './corpus.js'
import {
  ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES,
  type EnvironmentActionSelectorDevelopmentCase,
} from './development-cases.js'

export const DEVELOPMENT_RECORDS_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'development-training.jsonl')
export const DEVELOPMENT_MANIFEST_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'development-training.manifest.json')
export const DEVELOPMENT_FOLD_COUNT = 4
export const RECORDS_PER_SOURCE_CASE = 12

const GRAPH_PATH = resolve(REPOSITORY_ROOT, 'etc/cognitive-graphs/environment-mode.json')
const CONTEXT_VARIATIONS = [
  'clean',
  'stale-authority',
  'reordered-capabilities',
] as const

export interface ActionSelectorTrainingRecord {
  system: string
  user: string
  output: string
  metadata: {
    recordId: string
    sourceCaseId: string
    sourceSplit: 'development'
    developmentFold: number
    suite: string
    risk: string
    instructionIndex: number
    contextVariation: typeof CONTEXT_VARIATIONS[number]
    systemOwned: true
  }
}

interface EnvironmentGraph {
  nodes?: Array<{
    id?: string
    data?: { properties?: { systemPrompt?: string } }
  }>
}

export async function loadActiveSelectorPrompt(): Promise<string> {
  const graph = JSON.parse(await readFile(GRAPH_PATH, 'utf8')) as EnvironmentGraph
  const prompt = graph.nodes?.find(node => node.id === '3')?.data?.properties?.systemPrompt?.trim()
  if (!prompt) throw new Error('The active Environment context builder has no selector system prompt')
  return prompt
}

function withVariation(
  sourceCase: EnvironmentActionSelectorDevelopmentCase,
  variation: typeof CONTEXT_VARIATIONS[number],
): {
  observation: EnvironmentObservation
  recentConversation: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const observation = structuredClone(sourceCase.observation)
  const recentConversation = structuredClone(sourceCase.recentConversation ?? [])
  if (variation === 'stale-authority') {
    recentConversation.unshift(
      { role: 'user', content: 'Earlier, perform one wave.' },
      { role: 'assistant', content: 'That earlier request is closed and is not current authority.' },
    )
  } else if (variation === 'reordered-capabilities') {
    observation.capabilities = {
      ...observation.capabilities,
      actions: [...observation.capabilities.actions].reverse(),
      robotCommands: [...(observation.capabilities.robotCommands ?? [])].reverse(),
      motionClasses: [...(observation.capabilities.motionClasses ?? [])].reverse(),
    }
  }
  return { observation, recentConversation }
}

export async function buildDevelopmentRecords(
  cases: EnvironmentActionSelectorDevelopmentCase[] = ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES,
): Promise<ActionSelectorTrainingRecord[]> {
  const activePrompt = await loadActiveSelectorPrompt()
  return cases.flatMap(sourceCase => sourceCase.instructions.flatMap((instruction, instructionIndex) => (
    CONTEXT_VARIATIONS.map(contextVariation => {
      const { observation, recentConversation } = withVariation(sourceCase, contextVariation)
      return {
        system: buildEnvironmentSelectorSystemPrompt({
          systemPrompt: activePrompt,
        }),
        user: buildEnvironmentSelectorEnvelope({
          instruction,
          observation,
          robotStatus: sourceCase.robotStatus,
          recentConversation,
          memories: sourceCase.memories,
        }),
        output: JSON.stringify(sourceCase.expected),
        metadata: {
          recordId: `${sourceCase.id}--i${instructionIndex}--${contextVariation}`,
          sourceCaseId: sourceCase.id,
          sourceSplit: 'development' as const,
          developmentFold: sourceCase.fold,
          suite: sourceCase.suite,
          risk: sourceCase.risk,
          instructionIndex,
          contextVariation,
          systemOwned: true as const,
        },
      }
    })
  )))
}

export function validateDevelopmentRecords(
  records: ActionSelectorTrainingRecord[],
  cases: EnvironmentActionSelectorDevelopmentCase[] = ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES,
  forbiddenCaseIds: string[] = [],
): string[] {
  const errors: string[] = []
  const byId = new Map(cases.map(sourceCase => [sourceCase.id, sourceCase]))
  const forbidden = new Set(forbiddenCaseIds)
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const record of records) {
    if (seen.has(record.metadata.recordId)) errors.push(`${record.metadata.recordId}: duplicate record id`)
    seen.add(record.metadata.recordId)
    const sourceCase = byId.get(record.metadata.sourceCaseId)
    if (!sourceCase) {
      errors.push(`${record.metadata.recordId}: unknown source case`)
      continue
    }
    if (forbidden.has(sourceCase.id)) errors.push(`${sourceCase.id}: prior locked case entered the new training lane`)
    if (record.metadata.sourceSplit !== 'development' || record.metadata.systemOwned !== true) {
      errors.push(`${record.metadata.recordId}: record is not system-owned development data`)
    }
    if (record.metadata.developmentFold !== sourceCase.fold) errors.push(`${record.metadata.recordId}: fold drift`)
    const outputValidation = validateEnvironmentSelectorOutput(record.output, sourceCase.observation.sessionId)
    if (!outputValidation.valid) {
      errors.push(`${record.metadata.recordId}: ${outputValidation.errors.join('; ')}`)
    }
    if (record.output !== JSON.stringify(sourceCase.expected)) errors.push(`${record.metadata.recordId}: output drift`)
    counts.set(sourceCase.id, (counts.get(sourceCase.id) ?? 0) + 1)
  }
  for (const sourceCase of cases) {
    if (sourceCase.instructions.length !== 4) errors.push(`${sourceCase.id}: exactly four reviewed instructions are required`)
    if (!Number.isInteger(sourceCase.fold) || sourceCase.fold < 0 || sourceCase.fold >= DEVELOPMENT_FOLD_COUNT) {
      errors.push(`${sourceCase.id}: invalid fold`)
    }
    if (counts.get(sourceCase.id) !== RECORDS_PER_SOURCE_CASE) {
      errors.push(`${sourceCase.id}: expected ${RECORDS_PER_SOURCE_CASE} records, found ${counts.get(sourceCase.id) ?? 0}`)
    }
  }
  return errors
}

export async function buildDevelopmentManifest(records: ActionSelectorTrainingRecord[]) {
  const { lock, receipt } = await loadPriorEvaluationEvidence()
  return {
    version: 1,
    owner: 'environment-action-selector',
    contract: '@metahuman/core Environment model output',
    sourceCaseCount: ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES.length,
    recordCount: records.length,
    recordsPerSourceCase: RECORDS_PER_SOURCE_CASE,
    foldCount: DEVELOPMENT_FOLD_COUNT,
    foldRecords: Object.fromEntries([...Array(DEVELOPMENT_FOLD_COUNT).keys()].map(fold => [
      fold,
      records.filter(record => record.metadata.developmentFold === fold).length,
    ])),
    datasetDigest: sha256(records),
    developmentSourceDigest: sha256(ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES),
    activePromptDigest: sha256(await loadActiveSelectorPrompt()),
    priorLockedDigest: lock.digest,
    priorLockedCaseCount: lock.caseIds.length,
    priorOneShotCompletedAt: receipt.completedAt,
    priorLockedCasesUsed: false,
    profileDataUsed: false,
  }
}

export async function main(): Promise<void> {
  const { lock } = await loadPriorEvaluationEvidence()
  const records = await buildDevelopmentRecords()
  const errors = validateDevelopmentRecords(records, ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES, lock.caseIds)
  if (errors.length > 0) throw new Error(`Development dataset is invalid:\n- ${errors.join('\n- ')}`)
  const manifest = await buildDevelopmentManifest(records)
  await mkdir(ACTION_SELECTOR_DIRECTORY, { recursive: true })
  await writeFile(DEVELOPMENT_RECORDS_PATH, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  await writeFile(DEVELOPMENT_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${records.length} records from ${ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES.length} system-owned cases`)
  console.log(`Retired locked cases excluded: ${manifest.priorLockedCaseCount}; receipt ${manifest.priorOneShotCompletedAt}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
