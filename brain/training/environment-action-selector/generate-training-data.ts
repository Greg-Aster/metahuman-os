import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateEnvironmentSelectorOutput } from '@metahuman/core'
import { getNode, parseEnvironmentIntentRouting, isPlanningDelegation, ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA } from '@metahuman/core/nodes'
import { ACTION_SELECTOR_DIRECTORY, REPOSITORY_ROOT, loadPriorEvaluationEvidence, sha256 } from './corpus.js'
import { cases, observation, COMMAND_DESCRIPTIONS, TIME, type IntentRequirements, type CaseSplit, type SpecialistCase } from './development-cases.js'
import './intent-cases.js'
import './task-cases.js'
import './intent-expanded-cases.js'
import './task-expanded-cases.js'
import './intent-tool-cases.js'
import './posture-cases.js'
import './goal-cases.js'
import './task-contrast-cases.js'
import './task-binding-cases.js'
import './vision-cases.js'
import './refinement-cases.js'
import './vision-continuation-cases.js'
import './speech-program-cases.js'
import './planner-boundary-cases.js'
import './speech-action-boundary-cases.js'
import './quoted-imperative-cases.js'
import './locomotion-cases.js'
import './intent-memory-cases.js'
import { migrateLocomotionReference, refreshLocomotionFixture } from './locomotion-contract.js'

export const DEVELOPMENT_CASES = cases.filter(item => item.split === 'development')
export const REGRESSION_CASES = cases.filter(item => item.split === 'regression')
export const REGRESSION_RECORDS_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'specialist-regression.jsonl')
export const EVALUATION_CASES = cases.filter(item => item.split === 'evaluation')
export const DEVELOPMENT_RECORDS_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'development-training.jsonl')
export const DEVELOPMENT_MANIFEST_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'development-training.manifest.json')
export const EVALUATION_RECORDS_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'specialist-evaluation.jsonl')
export const DEVELOPMENT_FOLD_COUNT = 4
export interface ActionSelectorTrainingRecord {
  system: string
  user: string
  output: string
  // Original program oracle retained outside model input for larger-planner contract tests.
  plannerReferenceOutput?: string
  jsonSchema: Record<string, unknown>
  metadata: {
    recordId: string; sourceCaseId: string; specialist: 'intent' | 'task'; sourceSplit: CaseSplit
    developmentFold: number; suite: string; risk: string; instructionIndex: number
    contextVariation: string; systemOwned: true; contextRequirements?: IntentRequirements; responseOptional?: true
    inputSource?: 'user' | 'autonomy'
  }
}
// Equivalent catalog wording is data augmentation, not an instruction change.
const CATALOG_PARAPHRASES: Record<string, string> = {
  stand: 'Take the normal upright stance supported by all four legs.',
  sit: 'Settle the body into its standard seated position.',
  wave: 'Raise a front leg, wave it, and put it back down.',
  bow: 'Dip the front end in a bow and return to the starting posture.',
  pushup: 'Perform one push-up by lowering the whole body and lifting it again.',
  nod: 'Give one nod by dipping and lifting the front of the body.',
  turn_left: 'Make a left quarter-turn of approximately ninety degrees.',
  turn_right: 'Make a right quarter-turn of approximately ninety degrees.',
  walk_forward: 'Walk ahead with the standard forward gait.',
  walk_backward: 'Walk in reverse with the standard backward gait.',
}
export async function loadGraphProperties(inputSource: 'user' | 'autonomy' = 'user') {
  const graph = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, 'etc/cognitive-graphs',
    'environment-mode.json'), 'utf8'))
  return Object.fromEntries(['3', 'intent-orchestrator'].map(id => {
    const saved = graph.nodes.find((node: any) => node.id === id)?.data.properties
    const properties = inputSource === 'autonomy' ? { ...saved,
      systemPrompt: saved?.autonomySystemPrompt,
      ...(id === 'intent-orchestrator' ? { userPromptTemplate: saved?.autonomyUserPromptTemplate } : {}),
    } : saved
    if (!properties?.systemPrompt) throw new Error(`Missing active graph prompt: ${id}`)
    return [id, properties]
  }))
}
export async function loadActiveSelectorPrompt(): Promise<string> {
  return (await loadGraphProperties())['3'].systemPrompt.trim()
}
// Typed synthetic annotations only. Runtime interpretation stays with the LLM.
function visualTaskReference(source: SpecialistCase, expected: Record<string, any>): boolean {
  if (source.specialist !== 'task' || (!expected.taskDecision && !expected.program)) return false
  return expected.taskDecision?.requiredCompletionBasis === 'visual_observation'
    || source.taskEvidence?.kind === 'vision_acquisition'
    || (Array.isArray(source.routes.taskContext) && source.routes.taskContext.includes('vision'))
    || source.visualTask === true
    || (expected.program?.steps ?? []).some((step: any) => step.kind === 'vision'
      || step.action?.type === 'captureImage' || step.action?.type === 'visualApproach')
}
export async function buildDevelopmentRecords(selected: SpecialistCase[] = DEVELOPMENT_CASES): Promise<ActionSelectorTrainingRecord[]> {
  const properties = await loadGraphProperties()
  const autonomyProperties = await loadGraphProperties('autonomy')
  const records: ActionSelectorTrainingRecord[] = []
  const builder = getNode('environment_context_builder')!
  for (const source of selected) {
    const graphProperties = source.inputSource === 'autonomy' ? autonomyProperties : properties
    const variations = source.specialist === 'intent'
      ? source.responseOptional && source.split === 'development' ? ['with-response'] : ['clean']
      : ['clean', 'reordered', 'opaque-identifiers']
    for (const [instructionIndex, instruction] of source.instructions.entries()) for (const variation of variations) {
      const inputs = { observation: observation(), ...structuredClone(source.inputs ?? {}) } as any
      const originalExpected = structuredClone(source.targets?.[instructionIndex] ?? source.expected)
      const expected = source.specialist === 'task' ? migrateLocomotionReference(originalExpected).output : originalExpected
      if (source.specialist === 'task') refreshLocomotionFixture(inputs)
      if (source.specialist === 'intent') expected.taskPlanner ??= expected.taskContext?.includes('vision') ? 'vision' : 'specialist'
      if (variation === 'with-response') {
        expected.needsResponse = true
        expected.conversationContext = ['persona.personality']
      }
      const selectedRoutes = structuredClone(source.routes)
      if (variation === 'reordered') {
        inputs.observation.capabilities.robotCommands?.reverse()
        inputs.observation.capabilities.actions.reverse()
        // Vision operations are advertised in recognition state. Removing that
        // selected evidence would change the interface, not just reorder it.
        if (source.split !== 'regression' && Array.isArray(selectedRoutes.taskContext)
          && !inputs.observation.state?.recognition) {
          selectedRoutes.taskContext = selectedRoutes.taskContext.filter(entry => entry !== 'environment')
        }
        const catalog = inputs.observation.capabilities.robotCommandDescriptions ?? {}
        inputs.observation.capabilities.robotCommandDescriptions = Object.fromEntries(Object.entries(catalog).reverse().map(([name, description]) =>
          [name, source.split !== 'regression' && description === COMMAND_DESCRIPTIONS[name] ? CATALOG_PARAPHRASES[name] : description]))
      }
      if (variation === 'opaque-identifiers') {
        const catalog = inputs.observation.capabilities.robotCommandDescriptions ?? {}
        const names = Object.keys(catalog)
        const remap = Object.fromEntries(names.map((name, index) => [name, `${source.split === 'development' ? 'k' : 'z'}${(index * 7 + instructionIndex * 11 + source.fold * 13) % 97}`]))
        inputs.observation.capabilities.robotCommands = names.map(name => remap[name])
        if (inputs.observation.capabilities.locomotion) {
          inputs.observation.capabilities.locomotion.commands = inputs.observation.capabilities.locomotion.commands.map((name: string) => remap[name])
        }
        inputs.observation.capabilities.robotCommandDescriptions = Object.fromEntries(names.map(name => [remap[name], catalog[name]]))
        for (const step of expected.program?.steps ?? []) if (step.action?.type === 'robotCommand') step.action.command = remap[step.action.command]
      }
      let system: string, user: string, jsonSchema: Record<string, unknown>
      if (source.specialist === 'intent') {
        system = graphProperties['intent-orchestrator'].systemPrompt
        user = graphProperties['intent-orchestrator'].userPromptTemplate.replace('{{userMessage}}', instruction)
        jsonSchema = ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA
      } else {
        const instructionInput = source.inputSource === 'autonomy'
          ? { plannerDecision: { ...inputs.plannerDecision, instruction, decidedAt: TIME } }
          : { userInstruction: instruction }
        const result = await builder.execute({ ...inputs, ...instructionInput, routingAnalysis: selectedRoutes }, {
          currentTime: TIME, environmentTaskEvidence: structuredClone(source.taskEvidence),
        } as never, graphProperties['3'])
        system = result.messages[0].content
        user = result.messages[1].content
        jsonSchema = result.jsonSchema
      }
      const delegateVisual = visualTaskReference(source, expected)
      records.push({ system, user, jsonSchema,
        output: JSON.stringify(delegateVisual ? { delegatePlanning: true } : expected),
        ...(delegateVisual ? { plannerReferenceOutput: JSON.stringify(expected) } : {}), metadata: {
        recordId: `${source.id}--i${instructionIndex}--${variation}`, sourceCaseId: source.id, specialist: source.specialist,
        sourceSplit: source.split, developmentFold: source.fold, suite: source.suite, risk: source.risk,
        instructionIndex, contextVariation: variation, systemOwned: true,
        ...(source.contextRequirements ? { contextRequirements: structuredClone(source.contextRequirements) } : {}),
        ...(source.responseOptional ? { responseOptional: true } : {}),
        ...(source.inputSource ? { inputSource: source.inputSource } : {}),
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
    if (record.metadata.sourceSplit !== source.split || record.metadata.specialist !== source.specialist
      || record.metadata.systemOwned !== true || record.metadata.responseOptional !== source.responseOptional
      || record.metadata.inputSource !== source.inputSource) errors.push(`${id}: provenance mismatch`)
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
  const regression = await buildDevelopmentRecords(REGRESSION_CASES)
  return {
    version: 20, owner: 'environment-action-selector', sourceCaseCount: DEVELOPMENT_CASES.length,
    recordCount: records.length, foldCount: DEVELOPMENT_FOLD_COUNT,
    specialists: Object.fromEntries(['intent', 'task'].map(specialist => [specialist, {
      records: records.filter(item => item.metadata.specialist === specialist).length,
      regressionRecords: regression.filter(item => item.metadata.specialist === specialist).length,
      evaluationRecords: evaluation.filter(item => item.metadata.specialist === specialist).length,
    }])),
    datasetDigest: sha256(records), evaluationDigest: sha256(evaluation), regressionDigest: sha256(regression),
    developmentSourceDigest: sha256(DEVELOPMENT_CASES), graphPropertiesDigest: sha256({
      user: await loadGraphProperties(), autonomy: await loadGraphProperties('autonomy'),
    }),
    priorLockedDigest: lock.digest, priorLockedCaseCount: lock.caseIds.length,
    priorOneShotCompletedAt: receipt.completedAt, priorLockedCasesUsed: false, profileDataUsed: false,
  }
}
export async function main(): Promise<void> {
  const { lock } = await loadPriorEvaluationEvidence()
  const records = await buildDevelopmentRecords()
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES)
  const regression = await buildDevelopmentRecords(REGRESSION_CASES)
  const errors = [...validateDevelopmentRecords(regression, REGRESSION_CASES, lock.caseIds), ...validateDevelopmentRecords(records, DEVELOPMENT_CASES, lock.caseIds), ...validateDevelopmentRecords(evaluation, EVALUATION_CASES, lock.caseIds)]
  if (errors.length) throw new Error(errors.join('\n'))
  await mkdir(ACTION_SELECTOR_DIRECTORY, { recursive: true })
  await writeFile(DEVELOPMENT_RECORDS_PATH, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  await writeFile(EVALUATION_RECORDS_PATH, `${evaluation.map(record => JSON.stringify(record)).join('\n')}\n`)
  await writeFile(REGRESSION_RECORDS_PATH, `${regression.map(record => JSON.stringify(record)).join('\n')}\n`)
  await writeFile(DEVELOPMENT_MANIFEST_PATH, `${JSON.stringify(await buildDevelopmentManifest(records), null, 2)}\n`)
  console.log(`Wrote ${records.length} development and ${evaluation.length} frozen evaluation records.`)
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exitCode = 1 })
