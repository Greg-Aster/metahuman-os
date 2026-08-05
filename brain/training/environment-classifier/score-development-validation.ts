import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  parseEnvironmentRouterDecision,
  type EnvironmentRouterDecision,
} from '@metahuman/core/environment-classifier'
import {
  scoreClassifierResponse,
  summarize,
  type BenchmarkCaseResult,
  type BenchmarkSummary,
} from './benchmark.js'
import {
  REPOSITORY_ROOT,
  loadLockedCorpus,
  sha256,
  type EnvironmentClassifierCase,
} from './corpus.js'
import { DEVELOPMENT_FOLD_COUNT } from './generate-training-data.js'

interface ValidationPrediction {
  model: string
  fold: number
  recordId: string
  sourceCaseId: string
  suite: string
  risk: string
  expected: EnvironmentRouterDecision
  rawResponse: string
  meanBatchLatencyMs: number
  systemOwned: true
}

interface FoldReport {
  fold: number
  summary: BenchmarkSummary
  fullOutputExact: number
  sourceCasesExact: number
  sourceCaseCount: number
}

interface Options {
  root: string
  folds: number[]
  predictions?: string
  reportSuffix?: string
}

function parseOptions(arguments_: string[]): Options {
  let rootValue: string | undefined
  let predictions: string | undefined
  let folds = [...Array(DEVELOPMENT_FOLD_COUNT).keys()]
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--root' && value) {
      rootValue = value
      index += 1
    } else if (argument === '--fold' && value) {
      const fold = Number.parseInt(value, 10)
      if (!Number.isInteger(fold) || fold < 0 || fold >= DEVELOPMENT_FOLD_COUNT) {
        throw new Error(`--fold must be from 0 through ${DEVELOPMENT_FOLD_COUNT - 1}`)
      }
      folds = [fold]
      index += 1
    } else if (argument === '--predictions' && value) {
      predictions = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }
  if (!rootValue) {
    throw new Error('Usage: --root out/environment-classifier/training/<cross-validation-run> [--fold 0]')
  }
  const root = resolve(rootValue)
  const outputRoot = resolve(REPOSITORY_ROOT, 'out/environment-classifier/training')
  if (!root.startsWith(`${outputRoot}/`)) throw new Error(`Validation root must be under ${outputRoot}`)
  if (predictions && folds.length !== 1) {
    throw new Error('--predictions requires one explicit --fold')
  }
  const predictionPath = predictions ? resolve(predictions) : undefined
  if (predictionPath && !predictionPath.startsWith(`${root}/fold-${folds[0]}/`)) {
    throw new Error('Prediction file must remain inside the selected development fold')
  }
  return {
    root,
    folds,
    predictions: predictionPath,
    reportSuffix: predictionPath
      ? basename(predictionPath).replace(/-validation-predictions\.jsonl$/, '')
      : undefined,
  }
}

async function loadJsonl<T>(path: string): Promise<T[]> {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as T)
}

function asCase(prediction: ValidationPrediction): EnvironmentClassifierCase {
  return {
    id: prediction.recordId,
    suite: prediction.suite as EnvironmentClassifierCase['suite'],
    split: 'development',
    risk: prediction.risk as EnvironmentClassifierCase['risk'],
    description: `Development fold ${prediction.fold}: ${prediction.sourceCaseId}`,
    input: {
      envelope: {
        currentInstruction: '',
        currentEnvironment: {},
      },
      recentConversation: [],
    },
    expected: prediction.expected,
  }
}

function fullOutputExact(prediction: ValidationPrediction): boolean {
  const parsed = parseEnvironmentRouterDecision(prediction.rawResponse)
  return Boolean(parsed.valid && parsed.value
    && sha256(parsed.value) === sha256(prediction.expected))
}

function markdown(input: {
  root: string
  model: string
  folds: FoldReport[]
  aggregate: BenchmarkSummary
  aggregateFullOutputExact: number
  sourceCasesExact: number
  sourceCaseCount: number
  mismatchCounts: Record<string, number>
}): string {
  const lines = [
    '# Environment Classifier Development Validation',
    '',
    `Model: \`${input.model}\``,
    `Run: \`${input.root}\``,
    '',
    '| Fold | Records | JSON | Core valid | Exact route | Full output exact | Unsafe action | Excess vision | Missed action | Source cases exact |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...input.folds.map(fold => [
      `| ${fold.fold}`,
      fold.summary.caseCount,
      `${fold.summary.jsonValid.count}/${fold.summary.caseCount}`,
      `${fold.summary.contractValid.count}/${fold.summary.caseCount}`,
      `${fold.summary.exactRoute.count}/${fold.summary.caseCount}`,
      fold.fullOutputExact,
      fold.summary.unsafeActionErrors,
      fold.summary.unnecessaryVisionAdmissions,
      fold.summary.missedActions,
      `${fold.sourceCasesExact}/${fold.sourceCaseCount} |`,
    ].join(' | ')),
    '',
    `Aggregate exact route: ${input.aggregate.exactRoute.count}/${input.aggregate.caseCount}`,
    `Aggregate full output exact: ${input.aggregateFullOutputExact}/${input.aggregate.caseCount}`,
    `Source cases exact across every variation: ${input.sourceCasesExact}/${input.sourceCaseCount}`,
    `Unsafe action errors: ${input.aggregate.unsafeActionErrors}`,
    `Unnecessary vision admissions: ${input.aggregate.unnecessaryVisionAdmissions}`,
    `Missed actions: ${input.aggregate.missedActions}`,
    '',
    '## Route mismatches',
    '',
    ...Object.entries(input.mismatchCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([field, count]) => `- ${field}: ${count}`),
    '',
    'This report uses only development source cases. The locked held-out set is not read as model input or used for checkpoint selection.',
    '',
  ]
  return lines.join('\n')
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const { root, folds, predictions: selectedPredictions, reportSuffix } = parseOptions(arguments_)
  const { lock } = await loadLockedCorpus()
  const heldOutIds = new Set(lock.caseIds)
  const foldReports: FoldReport[] = []
  const allPredictions: ValidationPrediction[] = []
  const allResults: BenchmarkCaseResult[] = []

  for (const fold of folds) {
    const predictions = await loadJsonl<ValidationPrediction>(
      selectedPredictions ?? resolve(root, `fold-${fold}/validation-predictions.jsonl`),
    )
    if (predictions.some(prediction => heldOutIds.has(prediction.sourceCaseId))) {
      throw new Error(`fold ${fold}: held-out source exposure`)
    }
    if (predictions.some(prediction => prediction.fold !== fold || prediction.systemOwned !== true)) {
      throw new Error(`fold ${fold}: invalid prediction provenance`)
    }
    const model = predictions[0]?.model ?? 'unknown'
    const results = predictions.map(prediction => scoreClassifierResponse({
      provider: 'offline',
      model,
      testCase: asCase(prediction),
      rawResponse: prediction.rawResponse,
      wallLatencyMs: prediction.meanBatchLatencyMs,
    }))
    const sourceCaseIds = [...new Set(predictions.map(prediction => prediction.sourceCaseId))]
    const sourceCasesExact = sourceCaseIds.filter(sourceCaseId => predictions
      .filter(prediction => prediction.sourceCaseId === sourceCaseId)
      .every(fullOutputExact)).length
    foldReports.push({
      fold,
      summary: summarize(model, results),
      fullOutputExact: predictions.filter(fullOutputExact).length,
      sourceCasesExact,
      sourceCaseCount: sourceCaseIds.length,
    })
    allPredictions.push(...predictions)
    allResults.push(...results)
  }

  const model = allPredictions[0]?.model ?? 'unknown'
  const aggregate = summarize(model, allResults)
  const sourceCaseIds = [...new Set(allPredictions.map(prediction => prediction.sourceCaseId))]
  const sourceCasesExact = sourceCaseIds.filter(sourceCaseId => allPredictions
    .filter(prediction => prediction.sourceCaseId === sourceCaseId)
    .every(fullOutputExact)).length
  const mismatchCounts: Record<string, number> = {}
  for (const result of allResults) {
    for (const field of result.mismatchedRouteFields) {
      mismatchCounts[field] = (mismatchCounts[field] ?? 0) + 1
    }
  }
  const report = {
    version: 1,
    owner: 'environment-classifier',
    split: folds.length === DEVELOPMENT_FOLD_COUNT
      ? 'development-cross-validation'
      : `development-fold-${folds[0]}`,
    heldOutUsed: false,
    heldOutDigest: lock.digest,
    model,
    folds: foldReports,
    aggregate,
    aggregateFullOutputExact: allPredictions.filter(fullOutputExact).length,
    sourceCasesExact,
    sourceCaseCount: sourceCaseIds.length,
    mismatchCounts,
  }
  await mkdir(root, { recursive: true })
  const reportStem = reportSuffix
    ? `development-validation-${reportSuffix}`
    : 'development-validation-report'
  await writeFile(resolve(root, `${reportStem}.json`), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(root, `${reportStem}.md`), markdown({
    root,
    model,
    folds: foldReports,
    aggregate,
    aggregateFullOutputExact: report.aggregateFullOutputExact,
    sourceCasesExact,
    sourceCaseCount: sourceCaseIds.length,
    mismatchCounts,
  }))
  console.log(`Development report: ${resolve(root, `${reportStem}.md`)}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
