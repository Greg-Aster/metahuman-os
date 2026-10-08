import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateEnvironmentSelectorOutput } from '@metahuman/core'
import { getNode, parseEnvironmentIntentRouting, isPlanningDelegation, ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA } from '@metahuman/core/nodes'
import { ACTION_SELECTOR_DIRECTORY, REPOSITORY_ROOT, loadPriorEvaluationEvidence, sha256 } from './corpus.js'
import { cases, observation, TIME, type SpecialistCase } from './development-cases.js'
import './intent-cases.js'
import './task-cases.js'

export const DEVELOPMENT_CASES = cases.filter(item => item.split === 'development')
export const EVALUATION_CASES = cases.filter(item => item.split === 'evaluation')
export const DEVELOPMENT_RECORDS_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'development-training.jsonl')
export const DEVELOPMENT_MANIFEST_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'development-training.manifest.json')
export const EVALUATION_RECORDS_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'specialist-evaluation.jsonl')
export const DEVELOPMENT_FOLD_COUNT = 4
const GRAPH_PATH = resolve(REPOSITORY_ROOT, 'etc/cognitive-graphs/environment-mode.json')
export interface ActionSelectorTrainingRecord {
  system: string
  user: string
  output: string
  jsonSchema: Record<string, unknown>
  metadata: {
    recordId: string; sourceCaseId: string; specialist: 'intent' | 'task'; sourceSplit: 'development' | 'evaluation'
    developmentFold: number; suite: string; risk: string; instructionIndex: number
    contextVariation: string; systemOwned: true
  }
}
export async function loadGraphProperties() {
  const graph = JSON.parse(await readFile(GRAPH_PATH, 'utf8'))
  return Object.fromEntries(['3', 'intent-orchestrator'].map(id => {
    const properties = graph.nodes.find((node: any) => node.id === id)?.data.properties
    if (!properties?.systemPrompt) throw new Error(`Missing active graph prompt: ${id}`)
    return [id, properties]
  }))
}
export async function loadActiveSelectorPrompt(): Promise<string> {
  return (await loadGraphProperties())['3'].systemPrompt.trim()
}
export async function buildDevelopmentRecords(selected: SpecialistCase[] = DEVELOPMENT_CASES): Promise<ActionSelectorTrainingRecord[]> {
  const properties = await loadGraphProperties()
  const records: ActionSelectorTrainingRecord[] = []
  const builder = getNode('environment_context_builder')!
  for (const source of selected) {
    const variations = source.specialist === 'intent' ? ['clean'] : ['clean', 'reordered', 'opaque-identifiers']
    for (const [instructionIndex, instruction] of source.instructions.entries()) for (const variation of variations) {
      const inputs = { observation: observation(), ...structuredClone(source.inputs ?? {}) } as any
      const expected = structuredClone(source.expected)
      if (variation === 'reordered') {
        inputs.observation.capabilities.robotCommands?.reverse()
        inputs.observation.capabilities.actions.reverse()
        inputs.observation.capabilities.robotCommandDescriptions = Object.fromEntries(Object.entries(inputs.observation.capabilities.robotCommandDescriptions ?? {}).reverse())
      }
      if (variation === 'opaque-identifiers') {
        const catalog = inputs.observation.capabilities.robotCommandDescriptions ?? {}
        const names = Object.keys(catalog)
        const remap = Object.fromEntries(names.map((name, index) => [name, `${source.split === 'evaluation' ? 'z' : 'k'}${(index * 7 + instructionIndex * 11 + source.fold * 13) % 97}`]))
        inputs.observation.capabilities.robotCommands = names.map(name => remap[name])
        inputs.observation.capabilities.robotCommandDescriptions = Object.fromEntries(names.map(name => [remap[name], catalog[name]]))
        for (const step of expected.program?.steps ?? []) if (step.action?.type === 'robotCommand') step.action.command = remap[step.action.command]
      }
      let system: string, user: string, jsonSchema: Record<string, unknown>
      if (source.specialist === 'intent') {
        system = properties['intent-orchestrator'].systemPrompt
        user = properties['intent-orchestrator'].userPromptTemplate.replace('{{userMessage}}', instruction)
        jsonSchema = ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA
      } else {
        const result = await builder.execute({ ...inputs, userInstruction: instruction, routingAnalysis: source.routes }, { currentTime: TIME } as never, properties['3'])
        system = result.messages[0].content
        user = result.messages[1].content
        jsonSchema = result.jsonSchema
      }
      records.push({ system, user, jsonSchema, output: JSON.stringify(expected), metadata: {
        recordId: `${source.id}--i${instructionIndex}--${variation}`, sourceCaseId: source.id, specialist: source.specialist,
        sourceSplit: source.split, developmentFold: source.fold, suite: source.suite, risk: source.risk,
        instructionIndex, contextVariation: variation, systemOwned: true,
      } })
    }
  }
  return records
}
export function validateRecordOutput(record: ActionSelectorTrainingRecord): string[] {
  if (record.metadata.specialist === 'intent') {
    try { parseEnvironmentIntentRouting(record.output); return [] } catch (error) { return [String(error)] }
  }
  if (isPlanningDelegation(JSON.parse(record.output))) return []
  const envelope = JSON.parse(record.user)
  return validateEnvironmentSelectorOutput(record.output, envelope.currentEnvironment?.sessionId, envelope.activeExecutions ?? [], false).errors
}
export function validateDevelopmentRecords(records: ActionSelectorTrainingRecord[], selected = DEVELOPMENT_CASES, forbiddenCaseIds: string[] = []): string[] {
  const errors: string[] = []
  const byId = new Map(selected.map(item => [item.id, item]))
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const record of records) {
    const id = record.metadata.recordId
    if (seen.has(id)) errors.push(`${id}: duplicate record`)
    seen.add(id)
    const source = byId.get(record.metadata.sourceCaseId)
    if (!source || forbiddenCaseIds.includes(record.metadata.sourceCaseId)) { errors.push(`${id}: unknown or retired source`); continue }
    if (record.metadata.sourceSplit !== source.split || record.metadata.specialist !== source.specialist || record.metadata.systemOwned !== true) errors.push(`${id}: provenance mismatch`)
    if (record.metadata.developmentFold !== source.fold) errors.push(`${id}: fold mismatch`)
    errors.push(...validateRecordOutput(record).map(error => `${id}: ${error}`))
    counts.set(source.id, (counts.get(source.id) ?? 0) + 1)
  }
  for (const source of selected) {
    const expected = source.instructions.length * (source.specialist === 'intent' ? 1 : 3)
    if (counts.get(source.id) !== expected) errors.push(`${source.id}: expected ${expected} records`)
    if (source.fold < 0 || source.fold >= DEVELOPMENT_FOLD_COUNT) errors.push(`${source.id}: invalid fold`)
  }
  return errors
}
export async function buildDevelopmentManifest(records: ActionSelectorTrainingRecord[]) {
  const { lock, receipt } = await loadPriorEvaluationEvidence()
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES)
  return {
    version: 2, owner: 'environment-action-selector', sourceCaseCount: DEVELOPMENT_CASES.length,
    recordCount: records.length, foldCount: DEVELOPMENT_FOLD_COUNT,
    specialists: Object.fromEntries(['intent', 'task'].map(specialist => [specialist, {
      records: records.filter(item => item.metadata.specialist === specialist).length,
      evaluationRecords: evaluation.filter(item => item.metadata.specialist === specialist).length,
    }])),
    datasetDigest: sha256(records), evaluationDigest: sha256(evaluation),
    developmentSourceDigest: sha256(DEVELOPMENT_CASES), graphPropertiesDigest: sha256(await loadGraphProperties()),
    priorLockedDigest: lock.digest, priorLockedCaseCount: lock.caseIds.length,
    priorOneShotCompletedAt: receipt.completedAt, priorLockedCasesUsed: false, profileDataUsed: false,
  }
}
export async function main(): Promise<void> {
  const { lock } = await loadPriorEvaluationEvidence()
  const records = await buildDevelopmentRecords()
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES)
  const errors = [...validateDevelopmentRecords(records, DEVELOPMENT_CASES, lock.caseIds), ...validateDevelopmentRecords(evaluation, EVALUATION_CASES, lock.caseIds)]
  if (errors.length) throw new Error(errors.join('\n'))
  await mkdir(ACTION_SELECTOR_DIRECTORY, { recursive: true })
  await writeFile(DEVELOPMENT_RECORDS_PATH, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  await writeFile(EVALUATION_RECORDS_PATH, `${evaluation.map(record => JSON.stringify(record)).join('\n')}\n`)
  await writeFile(DEVELOPMENT_MANIFEST_PATH, `${JSON.stringify(await buildDevelopmentManifest(records), null, 2)}\n`)
  console.log(`Wrote ${records.length} development and ${evaluation.length} frozen evaluation records.`)
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exitCode = 1 })
