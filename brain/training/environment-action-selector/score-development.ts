import { readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { validateEnvironmentSelectorOutput } from '@metahuman/core'
import { parseEnvironmentIntentRouting, isPlanningDelegation } from '@metahuman/core/nodes'
import { REPOSITORY_ROOT, sha256 } from './corpus.js'
import { DEVELOPMENT_FOLD_COUNT, type ActionSelectorTrainingRecord } from './generate-training-data.js'
import { ROUTE_FIELDS, type Specialist, type IntentRequirements } from './development-cases.js'

const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training')
export interface Prediction {
  fold: number; recordId: string; sourceCaseId: string; suite: string; risk: string; specialist: Specialist
  provider?: string; device?: string; batchSize?: number
  sourceSplit: string; user: string; expected: Record<string, any>; rawResponse: string
  meanBatchLatencyMs: number; promptTokens: number; completionTokens: number; systemOwned: boolean
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}
function parsed(text: string): Record<string, any> | null {
  try { const value = JSON.parse(text); return value && !Array.isArray(value) && typeof value === 'object' ? value : null } catch { return null }
}
function view(value: Record<string, any> | null, specialist: Specialist) {
  if (!value) return null
  if (specialist === 'intent') return Object.fromEntries(ROUTE_FIELDS.map(key => [key,
    Array.isArray(value[key]) ? [...new Set(value[key])].sort() : value[key]]))
  const task = value.taskDecision
  return {
    delegatePlanning: isPlanningDelegation(value),
    program: value.program ?? null,
    task: task ? { outcome: task.outcome, continuationPolicy: task.continuationPolicy,
      requiredCompletionBasis: task.requiredCompletionBasis, motionClass: task.motionClass ?? '',
      actionPurpose: task.actionPurpose ?? '', visualEvidenceMode: task.visualEvidenceMode ?? '' } : null,
    executionDisposition: value.executionDisposition ?? '', targetExecutionId: value.targetExecutionId ?? '',
  }
}
function hasPhysical(value: Record<string, any> | null) {
  return Boolean(Array.isArray(value?.program?.steps) && value.program.steps.some((step: any) => step?.kind === 'generatedMotion' || step?.kind === 'behavior'
    || ['robotCommand', 'move', 'stop', 'visualApproach'].includes(step?.action?.type)))
}
export interface SemanticReview {
  recordId: string
  predictionDigest: string
  semantic: 'pass' | 'fail'
  grounding: 'pass' | 'fail'
  reason: string
}

/** Match the complete frozen input set before computing any aggregate. */
export function validatePredictionCoverage(predictions: Prediction[], records: ActionSelectorTrainingRecord[]) {
  if (!records.length) throw new Error('Expected records are empty')
  const expected = new Map(records.map(record => [record.metadata.recordId, record]))
  if (expected.size !== records.length) throw new Error('Expected records contain duplicate IDs')
  const seen = new Set<string>(), duplicates: string[] = [], unexpected: string[] = []
  for (const prediction of predictions) {
    if (seen.has(prediction.recordId)) duplicates.push(prediction.recordId)
    seen.add(prediction.recordId)
    if (!expected.has(prediction.recordId)) unexpected.push(prediction.recordId)
  }
  const missing = [...expected.keys()].filter(id => !seen.has(id))
  if (missing.length || duplicates.length || unexpected.length)
    throw new Error(`Incomplete prediction coverage: ${JSON.stringify({ missing, duplicates, unexpected })}`)
  for (const prediction of predictions) {
    const record = expected.get(prediction.recordId)!
    const metadata = record.metadata
    if (['specialist', 'sourceCaseId', 'sourceSplit', 'suite', 'risk', 'systemOwned'].some(key =>
      prediction[key as keyof Prediction] !== metadata[key as keyof typeof metadata])
      || (metadata.sourceSplit === 'development' && prediction.fold !== metadata.developmentFold)
      || prediction.user !== record.user || sha256(prediction.expected) !== sha256(JSON.parse(record.output)))
      throw new Error(`${prediction.recordId}: prediction provenance or reference output differs from frozen records`)
  }
  return { expected: records.length, received: predictions.length, missing, duplicates, unexpected, recordsDigest: sha256(records) }
}

/** Evaluation annotations only; no runtime routing or parser behavior changes. */
export function assessIntentContext(expected: Record<string, any>, actual: Record<string, any> | null,
  requirements: IntentRequirements = {}, responseOptional = false) {
  const missing: string[] = [], unnecessary: string[] = []
  for (const consumer of ['taskContext', 'conversationContext'] as const) {
    const rule = requirements[consumer] ?? { required: expected[consumer] ?? [], optional: [], anyOf: [] }
    const got = new Set<string>(Array.isArray(actual?.[consumer]) ? actual[consumer] : [])
    const allowed = new Set([...rule.required, ...rule.optional, ...(rule.anyOf ?? []).flat()])
    for (const entry of rule.required) if (!got.has(entry)) missing.push(`${consumer}.${entry}`)
    for (const alternatives of rule.anyOf ?? []) if (!alternatives.some(entry => got.has(entry)))
      missing.push(`${consumer}.anyOf(${alternatives.join('|')})`)
    for (const entry of got) if (!allowed.has(entry)) unnecessary.push(`${consumer}.${entry}`)
  }
  return { missing, unnecessary, matches: missing.length === 0 && unnecessary.length === 0
    && actual?.needsAction === expected.needsAction
    && actual?.needsToolUse === expected.needsToolUse
    && actual?.taskPlanner === expected.taskPlanner
    && (actual?.needsResponse === expected.needsResponse || responseOptional && typeof actual?.needsResponse === 'boolean') }
}

function selectsMemory(value: Record<string, any> | null) {
  return ['taskContext', 'conversationContext'].some(key => Array.isArray(value?.[key]) && value[key].includes('memory'))
}
function memoryScope(value: Record<string, any> | null) {
  // Match the existing memory owner: empty type sets and time ranges are broad,
  // order defaults to relevance, and timestamps denote instants, not spellings.
  const types = Array.isArray(value?.memoryTypes) ? value.memoryTypes : []
  return {
    memoryTypes: [...new Set(types.filter((type: unknown): type is string => typeof type === 'string')
      .map((type: string) => type.trim().toLowerCase()).filter(Boolean))].sort(),
    memoryOrder: value?.memoryOrder ?? 'relevance',
    memoryTimeRange: {
      from: value?.memoryTimeRange?.from === undefined ? null : Date.parse(value.memoryTimeRange.from),
      before: value?.memoryTimeRange?.before === undefined ? null : Date.parse(value.memoryTimeRange.before),
    },
    memorySleepCycle: value?.memorySleepCycle ?? null,
  }
}
function assessMemorySelection(expected: Record<string, any>, actual: Record<string, any> | null,
  review: SemanticReview | undefined) {
  const applicable = selectsMemory(expected) || selectsMemory(actual)
  if (!applicable) return undefined
  const expectedScope = memoryScope(expected), actualScope = memoryScope(actual)
  const differences = (Object.keys(expectedScope) as Array<keyof typeof expectedScope>)
    .filter(field => sha256(expectedScope[field]) !== sha256(actualScope[field]))
  const usesQuery = selectsMemory(actual) && actualScope.memoryOrder !== 'newest'
  // Missing and empty query strings both use the original instruction. Frozen
  // rows preserve rendered model input, so do not guess how to strip its template
  // to fabricate the original query bytes. A review can assess the full request.
  const actualQuery = typeof actual?.memoryQuery === 'string' && actual.memoryQuery ? actual.memoryQuery : undefined
  const expectedQuery = typeof expected.memoryQuery === 'string' && expected.memoryQuery ? expected.memoryQuery : undefined
  const reviewed = !review ? 'pending' : review.semantic === 'pass' && review.grounding === 'pass' ? 'pass' : 'fail'
  return {
    expectedScope, actualScope, differences, matches: differences.length === 0,
    usesQuery, querySource: usesQuery ? actualQuery === undefined ? 'current-instruction' : 'explicit' : 'unused',
    queries: {
      expected: expectedQuery === undefined ? { source: 'current-instruction' } : { source: 'explicit', value: expectedQuery },
      actual: actualQuery === undefined ? { source: 'current-instruction' } : { source: 'explicit', value: actualQuery },
    },
    // Equality is a reference-agreement statistic, not an oracle for meaning.
    queryReferenceMatch: usesQuery && actualQuery === expectedQuery,
    reviewed, ...(review ? { reviewReason: review.reason } : {}),
  }
}

export function score(predictions: Prediction[], reviews: SemanticReview[] = [], records?: ActionSelectorTrainingRecord[]) {
  if (!predictions.length) throw new Error('No predictions to score')
  if (records) validatePredictionCoverage(predictions, records)
  const recordsById = new Map(records?.map(record => [record.metadata.recordId, record]) ?? [])
  const reviewById = new Map(reviews.map(review => [review.recordId, review]))
  if (reviewById.size !== reviews.length) throw new Error('Duplicate semantic reviews')
  for (const review of reviews) {
    const prediction = predictions.find(value => value.recordId === review.recordId)
    if (!prediction || review.predictionDigest !== sha256(prediction)
      || !['pass', 'fail'].includes(review.semantic) || !['pass', 'fail'].includes(review.grounding)
      || typeof review.reason !== 'string' || !review.reason.trim()) throw new Error(`Invalid or stale semantic review: ${review.recordId}`)
  }
  const semanticReview = { reviewed: reviews.length, unreviewed: predictions.length - reviews.length,
    semanticPass: reviews.filter(review => review.semantic === 'pass').length,
    groundingPass: reviews.filter(review => review.grounding === 'pass').length,
    confirmedCorrect: 0, pending: [] as Record<string, unknown>[] }
  let jsonValid = 0, coreValid = 0, exactRouting = 0, typedDecisionMatch = 0, acceptableRouting = 0
  const contextSelection = { missingRequired: 0, unnecessary: 0, requestsMissingRequired: 0, requestsWithUnnecessary: 0 }
  const memorySelection = { requests: 0, typedScopeMatches: 0, queryReferenceMatches: 0,
    queryReviewedPasses: 0, queryReviewedFailures: 0, queryPendingReview: 0, confirmedSelections: 0 }
  const bySuite: Record<string, { total: number; exact: number; acceptable: number; valid: number }> = {}
  let unsafeActionAuthorityErrors = 0, missedPhysicalActions = 0, wrongPhysicalActions = 0, unnecessaryCaptures = 0, falseCompletions = 0
  const routeErrors: Record<string, { missed: number; extra: number }> = {}
  const failures: Record<string, unknown>[] = []
  for (const prediction of predictions) {
    const actual = parsed(prediction.rawResponse)
    if (actual) jsonValid++
    let errors: string[] = []
    if (prediction.specialist === 'intent') {
      try { parseEnvironmentIntentRouting(prediction.rawResponse) } catch (error) { errors = [String(error)] }
    } else {
      const envelope = JSON.parse(prediction.user)
      errors = isPlanningDelegation(actual) ? [] : validateEnvironmentSelectorOutput(prediction.rawResponse, envelope.currentEnvironment?.sessionId, envelope.activeExecutions ?? [], false).errors
    }
    const valid = errors.length === 0
    if (valid) coreValid++
    const expectedView = view(prediction.expected, prediction.specialist)
    const actualView = view(actual, prediction.specialist)
    const selectionMatch = prediction.specialist === 'intent' ? sha256(expectedView) === sha256(actualView)
      : isPlanningDelegation(prediction.expected) === isPlanningDelegation(actual)
        && sha256(prediction.expected.program ?? null) === sha256(actual?.program ?? null)
    const routingMatch = valid && selectionMatch
    const decisionMatch = valid && sha256(expectedView) === sha256(actualView)
    if (routingMatch) exactRouting++
    if (decisionMatch) typedDecisionMatch++
    const context = prediction.specialist === 'intent'
      ? assessIntentContext(prediction.expected, actual, recordsById.get(prediction.recordId)?.metadata.contextRequirements,
        recordsById.get(prediction.recordId)?.metadata.responseOptional) : undefined
    const acceptable = valid && (context ? context.matches : decisionMatch)
    if (acceptable) acceptableRouting++
    if (context) {
      contextSelection.missingRequired += context.missing.length
      contextSelection.unnecessary += context.unnecessary.length
      if (context.missing.length) contextSelection.requestsMissingRequired++
      if (context.unnecessary.length) contextSelection.requestsWithUnnecessary++
    }
    const suite = bySuite[prediction.suite] ??= { total: 0, exact: 0, acceptable: 0, valid: 0 }
    suite.total++; if (decisionMatch) suite.exact++; if (acceptable) suite.acceptable++; if (valid) suite.valid++
    const review = reviewById.get(prediction.recordId)
    const memory = prediction.specialist === 'intent' ? assessMemorySelection(prediction.expected, actual, review) : undefined
    const reviewedCorrect = valid && review?.semantic === 'pass' && review.grounding === 'pass'
    const confirmedMemory = Boolean(memory && reviewedCorrect && context?.matches && memory.matches)
    if (memory) {
      memorySelection.requests++
      if (valid && memory.matches) memorySelection.typedScopeMatches++
      if (valid && memory.queryReferenceMatch) memorySelection.queryReferenceMatches++
      if (memory.usesQuery) {
        if (memory.reviewed === 'pass') memorySelection.queryReviewedPasses++
        else if (memory.reviewed === 'fail') memorySelection.queryReviewedFailures++
        else memorySelection.queryPendingReview++
      }
      if (confirmedMemory) memorySelection.confirmedSelections++
    }
    if (reviewedCorrect && (!memory || confirmedMemory)) semanticReview.confirmedCorrect++
    if (!review) semanticReview.pending.push({ recordId: prediction.recordId, predictionDigest: sha256(prediction),
      context: prediction.user, expected: prediction.expected, actual, rawResponse: prediction.rawResponse })
    if (prediction.specialist === 'intent') for (const key of ROUTE_FIELDS) {
      if (key === 'needsResponse' && recordsById.get(prediction.recordId)?.metadata.responseOptional) continue
      const expected = prediction.expected[key], observed = actual?.[key]
      if (key === 'taskContext' || key === 'conversationContext') {
        const wanted = new Set<string>(Array.isArray(expected) ? expected : []), got = new Set<string>(Array.isArray(observed) ? observed : [])
        for (const entry of new Set([...wanted, ...got])) {
          const errors = routeErrors[`${key}.${entry}`] ??= { missed: 0, extra: 0 }
          if (wanted.has(entry) && !got.has(entry)) errors.missed++
          if (!wanted.has(entry) && got.has(entry)) errors.extra++
        }
      } else if (key === 'taskPlanner') {
        for (const planner of ['specialist', 'vision']) {
          const errors = routeErrors[`taskPlanner.${planner}`] ??= { missed: 0, extra: 0 }
          if (expected === planner && observed !== planner) errors.missed++
          if (expected !== planner && observed === planner) errors.extra++
        }
      } else {
        const errors = routeErrors[key] ??= { missed: 0, extra: 0 }
        if (expected && observed !== true) errors.missed++
        if (!expected && observed === true) errors.extra++
      }
    }
    const expectedPhysical = hasPhysical(prediction.expected), actualPhysical = hasPhysical(actual)
    if (!expectedPhysical && actualPhysical) unsafeActionAuthorityErrors++
    if (expectedPhysical && !actualPhysical) missedPhysicalActions++
    if (expectedPhysical && actualPhysical && !selectionMatch) wrongPhysicalActions++
    const captures = (value: any) => Boolean(Array.isArray(value?.program?.steps) && value.program.steps.some((step: any) => step?.action?.type === 'captureImage'))
    if (captures(actual) && !captures(prediction.expected)) unnecessaryCaptures++
    if (actual?.taskDecision?.outcome === 'complete' && prediction.expected.taskDecision?.outcome !== 'complete') falseCompletions++
    if (!decisionMatch || memory && (!memory.matches || memory.reviewed === 'fail' || !context?.matches)) {
      failures.push({ recordId: prediction.recordId, suite: prediction.suite, errors,
        expectedView, actualView, acceptable, context,
        ...(memory ? { memorySelection: { ...memory, renderedRequest: prediction.user } } : {}), rawResponse: prediction.rawResponse })
    }
  }
  const ratio = (count: number) => ({ count, rate: count / predictions.length })
  return { total: predictions.length, semanticReview, jsonValid: ratio(jsonValid), coreValid: ratio(coreValid), exactRouting: ratio(exactRouting), typedDecisionMatch: ratio(typedDecisionMatch),
    acceptableRouting: ratio(acceptableRouting), contextSelection, memorySelection, bySuite, routeErrors, unsafeActionAuthorityErrors, missedPhysicalActions, wrongPhysicalActions, unnecessaryCaptures, falseCompletions,
    medianLatencyMs: percentile(predictions.map(value => value.meanBatchLatencyMs), .5),
    p95LatencyMs: percentile(predictions.map(value => value.meanBatchLatencyMs), .95),
    meanPromptTokens: predictions.reduce((sum, value) => sum + value.promptTokens, 0) / predictions.length,
    meanCompletionTokens: predictions.reduce((sum, value) => sum + value.completionTokens, 0) / predictions.length, failures }
}
export async function main(arguments_: string[] = process.argv.slice(2)) {
  let root = '', predictionsPath = '', outputPath = '', recordsPath = '', reviewsPath = ''
  let checkpointPolicy: 'best-loss' | 'epoch-1' | 'epoch-2' | 'final-epoch' = 'best-loss'
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index], value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--root' && value) root = resolve(value)
    else if (argument === '--predictions' && value) predictionsPath = resolve(value)
    else if (argument === '--records' && value) recordsPath = resolve(value)
    else if (argument === '--reviews' && value) reviewsPath = resolve(value)
    else if (argument === '--output' && value) outputPath = resolve(value)
    else if (argument === '--checkpoint-policy' && ['best-loss', 'epoch-1', 'epoch-2', 'final-epoch'].includes(value!)) checkpointPolicy = value as typeof checkpointPolicy
    else throw new Error(`Unknown or incomplete argument: ${argument}`)
    index++
  }
  if (!root.startsWith(`${OUTPUT_ROOT}${sep}`)) throw new Error(`--root must be under ${OUTPUT_ROOT}`)
  const all: Prediction[] = [], expected: ActionSelectorTrainingRecord[] = [], byFold: Record<string, ReturnType<typeof score>> = {}
  const reviews: SemanticReview[] = reviewsPath ? JSON.parse(await readFile(reviewsPath, 'utf8')) : []
  const readRecords = async (path: string): Promise<ActionSelectorTrainingRecord[]> => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const read = async (path: string): Promise<Prediction[]> => (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  if (predictionsPath) {
    if (!outputPath.startsWith(`${root}${sep}`)) throw new Error('--output must be inside --root')
    if (!recordsPath) throw new Error('--predictions requires --records pointing to the frozen evaluation inputs')
    all.push(...await read(predictionsPath))
    expected.push(...await readRecords(recordsPath))
  } else for (let fold = 0; fold < DEVELOPMENT_FOLD_COUNT; fold++) {
    const predictions = await read(resolve(root, `fold-${fold}`, checkpointPolicy === 'best-loss' ? 'validation-predictions.jsonl' : `validation-predictions-${checkpointPolicy}.jsonl`))
    if (predictions.some(value => value.fold !== fold || value.sourceSplit !== 'development' || value.systemOwned !== true)) throw new Error(`fold ${fold}: invalid provenance`)
    const records = await readRecords(resolve(root, `fold-${fold}`, 'validation.jsonl'))
    const provenance = JSON.parse(await readFile(resolve(root, `fold-${fold}`, 'run-provenance.json'), 'utf8'))
    if (provenance.owner !== 'environment-action-selector' || provenance.fold !== fold
      || provenance.priorHeldOutUsed !== false || provenance.validationRecordCount !== records.length
      || records.some(record => record.metadata.developmentFold !== fold)) throw new Error(`fold ${fold}: invalid frozen record provenance`)
    validatePredictionCoverage(predictions, records)
    expected.push(...records)
    byFold[String(fold)] = score(predictions, reviews.filter(review => predictions.some(value => value.recordId === review.recordId)), records)
    all.push(...predictions)
  }
  if (!all.length || new Set(all.map(value => value.specialist)).size !== 1 || new Set(all.map(value => value.recordId)).size !== all.length) throw new Error('Mixed specialists or duplicated/incomplete predictions')
  const coverage = validatePredictionCoverage(all, expected)
  const report = { version: 5, owner: 'environment-action-selector', specialist: all[0]!.specialist,
    split: predictionsPath ? all[0]!.sourceSplit : 'development-cross-validation', checkpointPolicy,
    priorHeldOutUsed: false, predictionDigest: sha256(all), coverage,
    providers: [...new Set(all.flatMap(value => value.provider ? [value.provider] : []))],
    devices: [...new Set(all.flatMap(value => value.device ? [value.device] : []))],
    batchSizes: [...new Set(all.flatMap(value => value.batchSize ? [value.batchSize] : []))],
    byFold, aggregate: score(all, reviews, expected),
    measurement: 'Reported latency is batch duration divided by batch size, not end-to-end workflow latency. Compare speed only with matching backend, device, precision, batching and decoding settings. typedDecisionMatch compares program steps and typed task fields only; Intent routing metrics retain their six-field meaning. memorySelection separately compares effective type, order, time and sleep scope, including extra restrictions. Query agreement is not semantic correctness; omitted queries use the original instruction, and newest retrieval does not use semantic query ranking. Objectives, completion criteria, reasons, query meaning and factual grounding require a recorded semantic review. Memory confirmation also requires valid structure and applicable context routing. Unreviewed predictions are not confirmed correct.' }
  outputPath ||= resolve(root, checkpointPolicy === 'best-loss' ? 'development-validation.json' : `development-validation-${checkpointPolicy}.json`)
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  const { failures: _failures, semanticReview: { pending: _pending, ...semanticReview }, ...summary } = report.aggregate
  console.log(JSON.stringify({ specialist: report.specialist, ...summary, semanticReview, coverage, report: outputPath }, null, 2))
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exitCode = 1 })
