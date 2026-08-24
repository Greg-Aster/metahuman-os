import { readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { validateEnvironmentSelectorOutput } from '@metahuman/core'

import {
  REPOSITORY_ROOT,
  sha256,
} from './corpus.js'
import { DEVELOPMENT_FOLD_COUNT } from './generate-training-data.js'

const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training')

interface Prediction {
  fold: number
  recordId: string
  sourceCaseId: string
  suite: string
  risk: string
  expected: unknown
  rawResponse: string
  meanBatchLatencyMs: number
  promptTokens: number
  completionTokens: number
  systemOwned: boolean
}

interface DecisionView {
  selection: string
  outcome: string
  objectiveComplete: boolean
  continuationPolicy: string
  requiredCompletionBasis: string
  motionClass: string
  visualEvidenceMode: string
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function rawSelection(value: unknown): string {
  const record = rawRecord(value)
  const actions = Array.isArray(record?.actions) ? record.actions : []
  const action = actions.find(candidate => candidate && typeof candidate === 'object') as Record<string, unknown> | undefined
  if (action?.type === 'robotCommand') return `robotCommand:${typeof action.command === 'string' ? action.command : ''}`
  if (typeof action?.type === 'string') return action.type
  if (record?.movementRequest && typeof record.movementRequest === 'object') return 'movementRequest:body_local'
  return 'none'
}

function decisionView(value: unknown): DecisionView | null {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const validation = validateEnvironmentSelectorOutput(text)
  if (!validation.valid || !validation.value) return null
  const decision = validation.value.taskDecision
  return {
    selection: rawSelection(validation.value),
    outcome: decision.outcome,
    objectiveComplete: decision.objectiveComplete,
    continuationPolicy: decision.continuationPolicy ?? '',
    requiredCompletionBasis: decision.requiredCompletionBasis ?? '',
    motionClass: decision.motionClass ?? '',
    visualEvidenceMode: decision.visualEvidenceMode ?? '',
  }
}

function isPhysicalSelection(selection: string): boolean {
  return selection.startsWith('robotCommand:')
    || selection.startsWith('movementRequest:')
    || selection === 'visualApproach'
}

function score(predictions: Prediction[]) {
  let jsonValid = 0
  let coreValid = 0
  let exactRouting = 0
  let exactDecision = 0
  let unsafeActionAuthorityErrors = 0
  let missedPhysicalActions = 0
  let wrongPhysicalActions = 0
  let unnecessaryCaptures = 0
  const failures: Array<Record<string, unknown>> = []
  for (const prediction of predictions) {
    const validation = validateEnvironmentSelectorOutput(prediction.rawResponse)
    if (validation.jsonValid) jsonValid += 1
    if (validation.valid) coreValid += 1
    const expectedView = decisionView(prediction.expected)
    const actualView = decisionView(prediction.rawResponse)
    const actualSelection = rawSelection(prediction.rawResponse)
    const expectedSelection = expectedView?.selection ?? 'none'
    const routingMatch = actualSelection === expectedSelection
    const decisionMatch = JSON.stringify(actualView) === JSON.stringify(expectedView)
    if (routingMatch) exactRouting += 1
    if (decisionMatch) exactDecision += 1
    const actualPhysical = isPhysicalSelection(actualSelection)
    const expectedPhysical = isPhysicalSelection(expectedSelection)
    const unsafe = !expectedPhysical && actualPhysical
    const missed = expectedPhysical && !actualPhysical
    const wrong = expectedPhysical && actualPhysical && actualSelection !== expectedSelection
    const excessCapture = expectedSelection !== 'captureImage' && actualSelection === 'captureImage'
    if (unsafe) unsafeActionAuthorityErrors += 1
    if (missed) missedPhysicalActions += 1
    if (wrong) wrongPhysicalActions += 1
    if (excessCapture) unnecessaryCaptures += 1
    if (!routingMatch || !decisionMatch || !validation.valid) failures.push({
      recordId: prediction.recordId,
      sourceCaseId: prediction.sourceCaseId,
      suite: prediction.suite,
      risk: prediction.risk,
      jsonValid: validation.jsonValid,
      coreValid: validation.valid,
      errors: validation.errors,
      expectedView,
      actualView,
      routingMatch,
      decisionMatch,
      unsafeAction: unsafe,
      missedAction: missed,
      wrongAction: wrong,
      unnecessaryCapture: excessCapture,
      rawResponse: prediction.rawResponse,
    })
  }
  return {
    total: predictions.length,
    jsonValid: { count: jsonValid, rate: jsonValid / predictions.length },
    coreValid: { count: coreValid, rate: coreValid / predictions.length },
    exactRouting: { count: exactRouting, rate: exactRouting / predictions.length },
    exactDecision: { count: exactDecision, rate: exactDecision / predictions.length },
    unsafeActionAuthorityErrors,
    missedPhysicalActions,
    wrongPhysicalActions,
    unnecessaryCaptures,
    medianLatencyMs: median(predictions.map(value => value.meanBatchLatencyMs)),
    meanPromptTokens: predictions.reduce((sum, value) => sum + value.promptTokens, 0) / predictions.length,
    meanCompletionTokens: predictions.reduce((sum, value) => sum + value.completionTokens, 0) / predictions.length,
    failures,
  }
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  let root = resolve(OUTPUT_ROOT, 'qwen3.5-0.8b-cv-001')
  let checkpointPolicy: 'best-loss' | 'epoch-2' | 'final-epoch' = 'best-loss'
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--checkpoint-policy' && (value === 'best-loss' || value === 'epoch-2' || value === 'final-epoch')) {
      checkpointPolicy = value
      index += 1
    } else if (argument === '--root' && value) {
      root = resolve(value)
      index += 1
    } else throw new Error(`Unknown or incomplete argument: ${argument}`)
  }
  if (!root.startsWith(`${OUTPUT_ROOT}${sep}`)) throw new Error(`Scoring root must remain under ${OUTPUT_ROOT}`)
  const byFold: Record<string, ReturnType<typeof score>> = {}
  const all: Prediction[] = []
  for (let fold = 0; fold < DEVELOPMENT_FOLD_COUNT; fold += 1) {
    const path = resolve(root, `fold-${fold}`, checkpointPolicy === 'best-loss'
      ? 'validation-predictions.jsonl'
      : `validation-predictions-${checkpointPolicy}.jsonl`)
    const predictions = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) as Prediction[]
    if (predictions.some(value => value.fold !== fold || value.systemOwned !== true)) {
      throw new Error(`fold ${fold}: prediction provenance is invalid`)
    }
    byFold[String(fold)] = score(predictions)
    all.push(...predictions)
  }
  const report = {
    version: 1,
    owner: 'environment-action-selector',
    split: 'development-cross-validation',
    checkpointPolicy,
    priorHeldOutUsed: false,
    predictionDigest: sha256(all),
    byFold,
    aggregate: score(all),
  }
  const reportPath = resolve(root, checkpointPolicy === 'best-loss'
    ? 'development-validation.json'
    : `development-validation-${checkpointPolicy}.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  const aggregate = report.aggregate
  console.log(`JSON: ${aggregate.jsonValid.count}/${aggregate.total}`)
  console.log(`Core valid: ${aggregate.coreValid.count}/${aggregate.total}`)
  console.log(`Exact routing: ${aggregate.exactRouting.count}/${aggregate.total} (${(aggregate.exactRouting.rate * 100).toFixed(1)}%)`)
  console.log(`Exact decision contract: ${aggregate.exactDecision.count}/${aggregate.total} (${(aggregate.exactDecision.rate * 100).toFixed(1)}%)`)
  console.log(`Unsafe physical authority: ${aggregate.unsafeActionAuthorityErrors}; missed physical: ${aggregate.missedPhysicalActions}; wrong physical: ${aggregate.wrongPhysicalActions}; unnecessary captures: ${aggregate.unnecessaryCaptures}`)
  console.log(`Median batched latency: ${aggregate.medianLatencyMs.toFixed(1)} ms`)
  console.log(`Report: ${reportPath}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
