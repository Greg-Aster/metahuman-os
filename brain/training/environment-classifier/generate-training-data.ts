import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  environmentRouterRouteView,
  parseEnvironmentRouterDecision,
  type EnvironmentRouterDecision,
} from '@metahuman/core/environment-classifier'
import {
  CLASSIFIER_LANE_DIRECTORY,
  loadLockedCorpus,
  sha256,
  type ClassifierConversationMessage,
  type EnvironmentClassifierCase,
  type EnvironmentClassifierCorpus,
  type HeldOutLock,
} from './corpus.js'
import {
  COMPACT_CLASSIFIER_INPUT_VERSION,
  loadContextRouterPrompt,
  renderCompactClassifierInput,
  renderContextRouterMessages,
  type ContextRouterPrompt,
} from './prompt.js'
import {
  DEVELOPMENT_FOLD_BY_CASE,
  DEVELOPMENT_SEMANTIC_VARIANTS,
  SEMANTIC_VARIANTS_PER_CASE,
} from './semantic-variants.js'

export const TRAINING_DATA_PATH = resolve(CLASSIFIER_LANE_DIRECTORY, 'development-training.jsonl')
export const TRAINING_MANIFEST_PATH = resolve(CLASSIFIER_LANE_DIRECTORY, 'development-training.manifest.json')
export const DEVELOPMENT_FOLD_COUNT = 4
export const ACTION_CONTEXT_VARIANTS_PER_SEMANTIC_INPUT = 10
export const NON_ACTION_CONTEXT_VARIANTS_PER_SEMANTIC_INPUT = 6

export interface ClassifierTrainingRecord {
  system: string
  user: string
  compactInput: string
  output: string
  metadata: {
    recordId: string
    sourceCaseId: string
    sourceSplit: 'development'
    suite: string
    risk: string
    developmentFold: number
    semanticVariation: string
    contextVariation: string
    variation: string
    stressors: string[]
    systemOwned: true
  }
}

interface TrainingVariation {
  name: string
  stressors: string[]
  apply: (testCase: EnvironmentClassifierCase) => EnvironmentClassifierCase
}

interface TrainingSurface {
  name: string
  testCase: EnvironmentClassifierCase
  stressors: string[]
}

function cloneCase(testCase: EnvironmentClassifierCase): EnvironmentClassifierCase {
  return structuredClone(testCase)
}

function reverseRecordKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).reverse())
}

function appendHistory(
  testCase: EnvironmentClassifierCase,
  messages: ClassifierConversationMessage[],
): EnvironmentClassifierCase {
  const varied = cloneCase(testCase)
  varied.input.recentConversation.push(...messages)
  return varied
}

function addStaleVisual(testCase: EnvironmentClassifierCase): EnvironmentClassifierCase {
  const varied = cloneCase(testCase)
  const environment = varied.input.envelope.currentEnvironment
  const existingFrames = Array.isArray(environment.visualFrames)
    ? environment.visualFrames
    : []
  environment.visualFrames = [
    {
      id: 'stale-frame',
      timestamp: '2029-12-31T08:00:00.000Z',
      source: 'robot-camera',
      correlationId: 'completed-earlier-cycle',
    },
    ...existingFrames,
  ]
  return varied
}

function reverseEnvironmentSection(
  testCase: EnvironmentClassifierCase,
  section: 'state' | 'capabilities',
): EnvironmentClassifierCase {
  const varied = cloneCase(testCase)
  const environment = varied.input.envelope.currentEnvironment
  const value = environment[section]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    environment[section] = reverseRecordKeys(value as Record<string, unknown>)
  }
  return varied
}

function staleHistory(testCase: EnvironmentClassifierCase): ClassifierConversationMessage[] {
  if (testCase.suite === 'ambiguity') {
    return [
      { role: 'user', content: 'Earlier we discussed storage labels.' },
      { role: 'assistant', content: 'That unrelated discussion is complete.' },
    ]
  }
  return [
    { role: 'user', content: 'Earlier, wave once.' },
    { role: 'assistant', content: 'That earlier movement finished successfully.' },
  ]
}

function futureHistory(testCase: EnvironmentClassifierCase): ClassifierConversationMessage[] {
  if (testCase.suite === 'ambiguity') {
    return [
      { role: 'user', content: 'We may discuss an unrelated checklist later.' },
      { role: 'assistant', content: 'No checklist item is active now.' },
    ]
  }
  return [
    { role: 'user', content: 'If I explicitly ask later, stand up then.' },
    { role: 'assistant', content: 'I will wait for a future explicit request.' },
  ]
}

const VARIATIONS: TrainingVariation[] = [
  {
    name: 'canonical',
    stressors: ['gold_route'],
    apply: cloneCase,
  },
  {
    name: 'lowercase_instruction',
    stressors: ['instruction_surface'],
    apply: testCase => {
      const varied = cloneCase(testCase)
      varied.input.envelope.currentInstruction = varied.input.envelope.currentInstruction.toLowerCase()
      return varied
    },
  },
  {
    name: 'whitespace_instruction',
    stressors: ['instruction_surface'],
    apply: testCase => {
      const varied = cloneCase(testCase)
      varied.input.envelope.currentInstruction = `  ${varied.input.envelope.currentInstruction}  `
      return varied
    },
  },
  {
    name: 'state_key_order',
    stressors: ['state_query', 'serialization_order'],
    apply: testCase => reverseEnvironmentSection(testCase, 'state'),
  },
  {
    name: 'environment_key_order',
    stressors: ['state_query', 'serialization_order'],
    apply: testCase => {
      const varied = cloneCase(testCase)
      varied.input.envelope.currentEnvironment = reverseRecordKeys(
        varied.input.envelope.currentEnvironment,
      )
      return varied
    },
  },
  {
    name: 'stale_uncorrelated_visual',
    stressors: ['vision_admission', 'stale_evidence'],
    apply: addStaleVisual,
  },
  {
    name: 'stale_completed_action_history',
    stressors: ['action_authority', 'stale_instruction'],
    apply: testCase => appendHistory(testCase, staleHistory(testCase)),
  },
  {
    name: 'future_action_history',
    stressors: ['action_authority', 'stale_instruction'],
    apply: testCase => appendHistory(testCase, futureHistory(testCase)),
  },
  {
    name: 'capabilities_key_order',
    stressors: ['action_authority', 'context_admission', 'serialization_order'],
    apply: testCase => reverseEnvironmentSection(testCase, 'capabilities'),
  },
  {
    name: 'combined_distractors',
    stressors: ['action_authority', 'vision_admission', 'stale_instruction', 'state_query'],
    apply: testCase => {
      const withState = reverseEnvironmentSection(testCase, 'state')
      const withVisual = addStaleVisual(withState)
      return appendHistory(withVisual, staleHistory(testCase))
    },
  },
]

const NON_ACTION_VARIATION_NAMES = new Set([
  'canonical',
  'state_key_order',
  'stale_uncorrelated_visual',
  'stale_completed_action_history',
  'future_action_history',
  'combined_distractors',
])

export function assignDevelopmentFolds(
  corpus: EnvironmentClassifierCorpus,
): Map<string, number> {
  const folds = new Map<string, number>()
  for (const testCase of corpus.cases.filter(candidate => candidate.split === 'development')) {
    const fold = DEVELOPMENT_FOLD_BY_CASE[testCase.id]
    if (!Number.isInteger(fold) || fold < 0 || fold >= DEVELOPMENT_FOLD_COUNT) {
      throw new Error(`${testCase.id}: missing or invalid development fold`)
    }
    folds.set(testCase.id, fold)
  }
  return folds
}

function semanticInputs(testCase: EnvironmentClassifierCase): Array<{
  name: string
  instruction: string
}> {
  const paraphrases = DEVELOPMENT_SEMANTIC_VARIANTS[testCase.id]
  if (!paraphrases) throw new Error(`${testCase.id}: missing curated semantic variants`)
  return [
    { name: 'canonical', instruction: testCase.input.envelope.currentInstruction },
    ...paraphrases.map((instruction, index) => ({
      name: `paraphrase_${index + 1}`,
      instruction,
    })),
  ]
}

function derivedSurface(
  source: EnvironmentClassifierCase,
  name: string,
  instruction: string,
  mutate: (testCase: EnvironmentClassifierCase) => void,
): TrainingSurface {
  const testCase = cloneCase(source)
  testCase.input.envelope.currentInstruction = instruction
  mutate(testCase)
  return {
    name,
    testCase,
    stressors: ['route_counterfactual', 'semantic_surface'],
  }
}

function controlledRouteSurfaces(source: EnvironmentClassifierCase): TrainingSurface[] {
  const surfaces: TrainingSurface[] = []
  if (source.id === 'persisted-001') {
    surfaces.push(
      derivedSurface(
        source,
        'counterfactual_completed_action',
        'The active wave task has returned a successful movement result.',
        testCase => {
          testCase.input.envelope.currentEnvironment.state = {
            ...(testCase.input.envelope.currentEnvironment.state as Record<string, unknown>),
            lastActionResult: 'success',
          }
          testCase.expected = {
            ...testCase.expected,
            needsVision: false,
            needsAction: false,
            actionType: 'none',
            actionParams: {
              motionClass: 'body_local',
              continuationPolicy: 'none',
              requiredCompletionBasis: 'action_result',
            },
            complexity: 0.15,
          }
        },
      ),
      derivedSurface(
        source,
        'counterfactual_waiting_for_confirmation',
        'The active check is now waiting for explicit confirmation from the user.',
        testCase => {
          testCase.input.envelope.currentEnvironment.persistedTaskContract = {
            continuationPolicy: 'bounded',
            requiredCompletionBasis: 'user_input',
            objective: 'Wait for explicit confirmation.',
          }
          testCase.expected = {
            ...testCase.expected,
            needsVision: false,
            needsAction: false,
            actionType: 'none',
            actionParams: {
              continuationPolicy: 'bounded',
              requiredCompletionBasis: 'user_input',
            },
            complexity: 0.15,
          }
        },
      ),
      derivedSurface(
        source,
        'counterfactual_environment_completion',
        'Determine from the current charging state whether the active check is complete.',
        testCase => {
          testCase.input.envelope.currentEnvironment.state = {
            ...(testCase.input.envelope.currentEnvironment.state as Record<string, unknown>),
            charging: true,
          }
          testCase.input.envelope.currentEnvironment.persistedTaskContract = {
            continuationPolicy: 'bounded',
            requiredCompletionBasis: 'environment_state',
            objective: 'Confirm current charging state.',
          }
          testCase.expected = {
            ...testCase.expected,
            needsVision: false,
            needsAction: false,
            actionType: 'none',
            actionParams: {
              continuationPolicy: 'bounded',
              requiredCompletionBasis: 'environment_state',
            },
            complexity: 0.15,
          }
        },
      ),
    )
  }

  if (source.id === 'movement-001') {
    surfaces.push(derivedSurface(
      source,
      'counterfactual_open_loop_step',
      'Back up by one short step.',
      testCase => {
        testCase.expected = {
          ...testCase.expected,
          actionParams: {
            motionClass: 'open_loop_displacement',
            continuationPolicy: 'none',
            requiredCompletionBasis: 'action_result',
          },
        }
      },
    ))
  }

  if (source.id === 'movement-003') {
    surfaces.push(derivedSurface(
      source,
      'counterfactual_bounded_body_local',
      'Keep waving until you see my raised hand, then stop.',
      testCase => {
        testCase.expected = {
          ...testCase.expected,
          needsVision: true,
          actionParams: {
            motionClass: 'body_local',
            continuationPolicy: 'bounded',
            requiredCompletionBasis: 'visual_observation',
          },
          complexity: 0.3,
        }
      },
    ))
  }

  if (source.suite === 'fresh_vision') {
    surfaces.push(derivedSurface(
      source,
      'counterfactual_missing_visual',
      source.input.envelope.currentInstruction,
      testCase => {
        testCase.input.envelope.currentEnvironment.visualFrames = []
        testCase.input.envelope.currentEnvironment.hasFreshCorrelatedVisual = false
        testCase.expected = {
          ...testCase.expected,
          needsAction: true,
          actionType: 'environment_action',
          actionParams: {
            continuationPolicy: 'bounded',
            requiredCompletionBasis: 'visual_observation',
          },
        }
      },
    ))
  }

  if (source.suite === 'vision_acquisition') {
    surfaces.push(derivedSurface(
      source,
      'counterfactual_fresh_visual',
      source.input.envelope.currentInstruction,
      testCase => {
        testCase.input.envelope.currentEnvironment.visualFrames = [{
          id: `paired-${source.id}`,
          timestamp: '2030-01-01T12:00:00.000Z',
          source: 'robot-camera',
          correlationId: `paired-${source.id}`,
        }]
        testCase.input.envelope.currentEnvironment.hasFreshCorrelatedVisual = true
        testCase.expected = {
          ...testCase.expected,
          needsAction: false,
          actionType: 'none',
          actionParams: {},
        }
      },
    ))
  }
  return surfaces
}

function trainingSurfaces(testCase: EnvironmentClassifierCase): TrainingSurface[] {
  return [
    ...semanticInputs(testCase).map(semantic => {
      const semanticCase = cloneCase(testCase)
      semanticCase.input.envelope.currentInstruction = semantic.instruction
      return {
        name: semantic.name,
        testCase: semanticCase,
        stressors: ['semantic_surface'],
      }
    }),
    ...controlledRouteSurfaces(testCase),
  ]
}

function trainingRecordCountForCase(testCase: EnvironmentClassifierCase): number {
  return trainingSurfaces(testCase).reduce((count, surface) => count + (
    surface.testCase.expected.needsAction
      ? ACTION_CONTEXT_VARIANTS_PER_SEMANTIC_INPUT
      : NON_ACTION_CONTEXT_VARIANTS_PER_SEMANTIC_INPUT
  ), 0)
}

export function expectedTrainingRecordCount(corpus: EnvironmentClassifierCorpus): number {
  return corpus.cases
    .filter(testCase => testCase.split === 'development')
    .reduce((count, testCase) => count + trainingRecordCountForCase(testCase), 0)
}

export function controlledRouteSurfaceCount(corpus: EnvironmentClassifierCorpus): number {
  return corpus.cases
    .filter(testCase => testCase.split === 'development')
    .reduce((count, testCase) => count + controlledRouteSurfaces(testCase).length, 0)
}

function contextVariations(testCase: EnvironmentClassifierCase): TrainingVariation[] {
  return testCase.expected.needsAction
    ? VARIATIONS
    : VARIATIONS.filter(variation => NON_ACTION_VARIATION_NAMES.has(variation.name))
}

function suiteStressors(testCase: EnvironmentClassifierCase): string[] {
  const stressors: string[] = []
  if (testCase.expected.needsAction) stressors.push('positive_action_authority')
  else stressors.push('negative_action_authority')
  if (testCase.expected.needsVision) stressors.push('positive_vision_admission')
  else stressors.push('negative_vision_admission')
  if (testCase.suite === 'ambiguity') stressors.push('ambiguity')
  if (testCase.suite === 'persisted_contract') stressors.push('persisted_contract')
  if (testCase.suite === 'state_query') stressors.push('state_query')
  return stressors
}

export function buildTrainingDataset(
  corpus: EnvironmentClassifierCorpus,
  prompt: ContextRouterPrompt,
): ClassifierTrainingRecord[] {
  const developmentCases = corpus.cases.filter(testCase => testCase.split === 'development')
  const folds = assignDevelopmentFolds(corpus)
  return developmentCases.flatMap(testCase => trainingSurfaces(testCase).flatMap(surface => {
    return contextVariations(surface.testCase).map(variation => {
      const variedCase = variation.apply(surface.testCase)
      const messages = renderContextRouterMessages(variedCase, prompt)
      const variationName = `${surface.name}__${variation.name}`
      return {
        system: messages[0].content,
        user: messages[1].content,
        compactInput: renderCompactClassifierInput(variedCase),
        output: JSON.stringify(surface.testCase.expected),
        metadata: {
          recordId: `${testCase.id}--${variationName}`,
          sourceCaseId: testCase.id,
          sourceSplit: 'development' as const,
          suite: testCase.suite,
          risk: testCase.risk,
          developmentFold: folds.get(testCase.id) ?? -1,
          semanticVariation: surface.name,
          contextVariation: variation.name,
          variation: variationName,
          stressors: [...new Set([
            'semantic_surface',
            ...surface.stressors,
            ...variation.stressors,
            ...suiteStressors(surface.testCase),
          ])].sort(),
          systemOwned: true as const,
        },
      }
    })
  }))
}

export function validateTrainingDataset(
  records: ClassifierTrainingRecord[],
  corpus: EnvironmentClassifierCorpus,
  lock: HeldOutLock,
): string[] {
  const errors: string[] = []
  const developmentIds = new Set(
    corpus.cases.filter(testCase => testCase.split === 'development').map(testCase => testCase.id),
  )
  const heldOutIds = new Set(lock.caseIds)
  const expectedCount = expectedTrainingRecordCount(corpus)
  if (records.length !== expectedCount) {
    errors.push(`training dataset must contain ${expectedCount} records; found ${records.length}`)
  }

  const recordIds = new Set<string>()
  const recordsPerCase = new Map<string, number>()
  for (const record of records) {
    if (recordIds.has(record.metadata.recordId)) errors.push(`duplicate record id: ${record.metadata.recordId}`)
    recordIds.add(record.metadata.recordId)
    recordsPerCase.set(
      record.metadata.sourceCaseId,
      (recordsPerCase.get(record.metadata.sourceCaseId) ?? 0) + 1,
    )
    if (!developmentIds.has(record.metadata.sourceCaseId)) {
      errors.push(`${record.metadata.recordId}: source is not in the development split`)
    }
    if (heldOutIds.has(record.metadata.sourceCaseId) || record.metadata.sourceSplit !== 'development') {
      errors.push(`${record.metadata.recordId}: held-out source exposure`)
    }
    if (!record.system.trim() || !record.user.trim()) {
      errors.push(`${record.metadata.recordId}: exact system and user prompts are required`)
    }
    if (!record.compactInput.trim()) {
      errors.push(`${record.metadata.recordId}: compact specialized-model input is required`)
    }
    if (!Number.isInteger(record.metadata.developmentFold)
      || record.metadata.developmentFold < 0
      || record.metadata.developmentFold >= DEVELOPMENT_FOLD_COUNT) {
      errors.push(`${record.metadata.recordId}: invalid development fold`)
    }
    const parsed = parseEnvironmentRouterDecision(record.output)
    if (!parsed.jsonValid || !parsed.valid || !parsed.value) {
      errors.push(`${record.metadata.recordId}: invalid 14-field output: ${parsed.errors.join('; ')}`)
    } else if (Object.keys(parsed.value).length !== 14) {
      errors.push(`${record.metadata.recordId}: output must contain exactly 14 fields`)
    }
  }

  for (const testCase of corpus.cases.filter(candidate => candidate.split === 'development')) {
    const expectedForCase = trainingRecordCountForCase(testCase)
    if (recordsPerCase.get(testCase.id) !== expectedForCase) {
      errors.push(`${testCase.id}: expected ${expectedForCase} variations; found ${recordsPerCase.get(testCase.id) ?? 0}`)
    }
  }

  const semanticCaseIds = new Set(Object.keys(DEVELOPMENT_SEMANTIC_VARIANTS))
  const foldedCaseIds = new Set(Object.keys(DEVELOPMENT_FOLD_BY_CASE))
  for (const caseId of developmentIds) {
    const variants = DEVELOPMENT_SEMANTIC_VARIANTS[caseId]
    if (!variants || variants.length !== SEMANTIC_VARIANTS_PER_CASE - 1) {
      errors.push(`${caseId}: expected ${SEMANTIC_VARIANTS_PER_CASE - 1} curated paraphrases`)
    }
    semanticCaseIds.delete(caseId)
    foldedCaseIds.delete(caseId)
  }
  for (const unexpectedId of semanticCaseIds) {
    errors.push(`${unexpectedId}: semantic variants may reference development cases only`)
  }
  for (const unexpectedId of foldedCaseIds) {
    errors.push(`${unexpectedId}: development folds may reference development cases only`)
  }

  for (let fold = 0; fold < DEVELOPMENT_FOLD_COUNT; fold += 1) {
    const trainingRoutes = new Set(records
      .filter(record => record.metadata.developmentFold !== fold)
      .map(record => {
        const parsed = parseEnvironmentRouterDecision(record.output)
        return parsed.value ? JSON.stringify(environmentRouterRouteView(parsed.value)) : ''
      }))
    const unsupported = new Set(records
      .filter(record => record.metadata.developmentFold === fold)
      .map(record => {
        const parsed = parseEnvironmentRouterDecision(record.output)
        return parsed.value ? JSON.stringify(environmentRouterRouteView(parsed.value)) : ''
      })
      .filter(route => route && !trainingRoutes.has(route)))
    for (const route of unsupported) {
      errors.push(`development fold ${fold}: validation route stratum has no training support: ${route}`)
    }
  }

  const serialized = JSON.stringify(records)
  if (/\/home\//i.test(serialized)) errors.push('training dataset contains an absolute home path')
  if (/synthetic[A-Z]/.test(serialized)) {
    errors.push('training inputs contain synthetic field names that could leak into classifier output')
  }
  if (/(?:api[_-]?key|access[_-]?token|bearer\s+[a-z0-9._-]+)/i.test(serialized)) {
    errors.push('training dataset contains a credential-shaped value')
  }
  return errors
}

function countValues(values: string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)].sort().map(value => [value, values.filter(candidate => candidate === value).length]),
  )
}

export function buildTrainingManifest(input: {
  records: ClassifierTrainingRecord[]
  corpus: EnvironmentClassifierCorpus
  lock: HeldOutLock
  prompt: ContextRouterPrompt
}) {
  const { records, corpus, lock, prompt } = input
  const developmentCases = corpus.cases.filter(testCase => testCase.split === 'development')
  return {
    version: 3,
    owner: 'environment-classifier',
    systemOwned: true,
    containsUserOrPersonaData: false,
    sourceSplit: 'development',
    heldOutUsed: false,
    sourceCaseCount: developmentCases.length,
    semanticVariantsPerCase: SEMANTIC_VARIANTS_PER_CASE,
    controlledRouteSurfaceCount: controlledRouteSurfaceCount(corpus),
    actionContextVariantsPerSemanticInput: ACTION_CONTEXT_VARIANTS_PER_SEMANTIC_INPUT,
    nonActionContextVariantsPerSemanticInput: NON_ACTION_CONTEXT_VARIANTS_PER_SEMANTIC_INPUT,
    developmentFoldCount: DEVELOPMENT_FOLD_COUNT,
    compactClassifierInputVersion: COMPACT_CLASSIFIER_INPUT_VERSION,
    recordCount: records.length,
    contract: '@metahuman/core/environment-classifier',
    provenance: {
      corpusPath: 'brain/training/environment-classifier/corpus.json',
      corpusDigest: sha256(corpus),
      developmentDigest: sha256(developmentCases),
      heldOutLockPath: 'brain/training/environment-classifier/held-out.lock.json',
      heldOutDigest: lock.digest,
      contextRouterGraphPath: 'etc/cognitive-graphs/environment-mode.json',
      promptDigest: sha256(prompt),
      datasetDigest: sha256(records),
    },
    counts: {
      suites: countValues(records.map(record => record.metadata.suite)),
      risks: countValues(records.map(record => record.metadata.risk)),
      variations: countValues(records.map(record => record.metadata.variation)),
      semanticVariations: countValues(records.map(record => record.metadata.semanticVariation)),
      contextVariations: countValues(records.map(record => record.metadata.contextVariation)),
      developmentFolds: countValues(records.map(record => String(record.metadata.developmentFold))),
      stressors: countValues(records.flatMap(record => record.metadata.stressors)),
      positiveRobotActions: records.filter(record => {
        const output = JSON.parse(record.output) as EnvironmentRouterDecision
        return output.needsAction && output.actionType === 'robot_movement'
      }).length,
      negativeActionAuthority: records.filter(record => {
        const output = JSON.parse(record.output) as EnvironmentRouterDecision
        return !output.needsAction
      }).length,
      negativeVisionAdmission: records.filter(record => {
        const output = JSON.parse(record.output) as EnvironmentRouterDecision
        return !output.needsVision
      }).length,
    },
  }
}

export async function main(): Promise<void> {
  const { corpus, lock } = await loadLockedCorpus()
  const prompt = await loadContextRouterPrompt()
  const records = buildTrainingDataset(corpus, prompt)
  const errors = validateTrainingDataset(records, corpus, lock)
  if (errors.length > 0) {
    throw new Error(`Environment classifier training data validation failed:\n- ${errors.join('\n- ')}`)
  }
  const manifest = buildTrainingManifest({ records, corpus, lock, prompt })
  const jsonl = `${records.map(record => JSON.stringify(record)).join('\n')}\n`

  await mkdir(CLASSIFIER_LANE_DIRECTORY, { recursive: true })
  await writeFile(TRAINING_DATA_PATH, jsonl, 'utf8')
  await writeFile(TRAINING_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${records.length} development-only records to ${TRAINING_DATA_PATH}`)
  console.log(`Dataset digest: ${manifest.provenance.datasetDigest}`)
  console.log(`Held-out digest preserved: ${manifest.provenance.heldOutDigest}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
