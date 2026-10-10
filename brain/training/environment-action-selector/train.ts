import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  getProfilePaths, listUsers, readEnvironmentTrainingBank, readEnvironmentTrainingReviews,
  validateEnvironmentSelectorOutput,
} from '@metahuman/core'
import { isPlanningDelegation, parseEnvironmentIntentRouting } from '@metahuman/core/nodes'

import {
  ACTION_SELECTOR_DIRECTORY,
  REPOSITORY_ROOT,
  loadPriorEvaluationEvidence,
  sha256,
} from './corpus.js'
import {
  DEVELOPMENT_FOLD_COUNT,
  DEVELOPMENT_MANIFEST_PATH,
  DEVELOPMENT_RECORDS_PATH,
  buildDevelopmentManifest,
  buildDevelopmentRecords,
  validateDevelopmentRecords,
  type ActionSelectorTrainingRecord,
} from './generate-training-data.js'
import { DEVELOPMENT_CASES, EVALUATION_CASES } from './generate-training-data.js'
import type { Specialist } from './development-cases.js'

const CONFIG_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'training-qwen3.5-0.8b.json')
const TRAINER_PATH = resolve(REPOSITORY_ROOT, 'docker/runpod-trainer/train_unsloth.py')
const PYTHON_PATH = resolve(REPOSITORY_ROOT, 'venv/bin/python')
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training')

interface TrainingOptions {
  outputPath: string
  specialist: Specialist
  folds: number[]
  finalFromPath?: string
  selectionReportPath?: string
  dryRun: boolean
  reviewedDataPath?: string
}

interface TrainingConfig {
  owner?: string
  base_model?: string
  require_exact_messages?: boolean
  train_on_responses_only?: boolean
  development_fold_count?: number
  num_train_epochs?: number
  [key: string]: unknown
}

interface DevelopmentSelectionReport {
  owner?: string
  specialist?: Specialist
  split?: string
  checkpointPolicy?: 'best-loss' | 'epoch-1' | 'epoch-2' | 'final-epoch'
  priorHeldOutUsed?: boolean
  aggregate?: {
    total?: number
    exactRouting?: { count?: number; rate?: number }
    unsafeActionAuthorityErrors?: number
    missedPhysicalActions?: number
    wrongPhysicalActions?: number
    unnecessaryCaptures?: number
  }
}

interface FoldProvenance {
  owner?: string
  baseModel?: string
  fold?: number
  validationRecordCount?: number
  developmentDatasetDigest?: string
  priorHeldOutDigest?: string
  priorHeldOutUsed?: boolean
}

function parseOptions(arguments_: string[]): TrainingOptions {
  const options: TrainingOptions = {
    outputPath: '',
    specialist: 'intent',
    folds: [...Array(DEVELOPMENT_FOLD_COUNT).keys()],
    dryRun: false,
  }
  let selectedFold = false
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--specialist' && (value === 'intent' || value === 'task')) {
      options.specialist = value
      index += 1
    } else if (argument === '--dry-run') {
      options.dryRun = true
    } else if (argument === '--output' && value) {
      options.outputPath = resolve(value)
      index += 1
    } else if (argument === '--final-from' && value) {
      options.finalFromPath = resolve(value)
      index += 1
    } else if (argument === '--selection-report' && value) {
      options.selectionReportPath = resolve(value)
      index += 1
    } else if (argument === '--reviewed-data' && value) {
      options.reviewedDataPath = resolve(value)
      index += 1
    } else if (argument === '--fold' && value) {
      const fold = Number.parseInt(value, 10)
      if (!Number.isInteger(fold) || fold < 0 || fold >= DEVELOPMENT_FOLD_COUNT) {
        throw new Error(`--fold must be from 0 through ${DEVELOPMENT_FOLD_COUNT - 1}`)
      }
      options.folds = [fold]
      selectedFold = true
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }
  options.outputPath ||= resolve(OUTPUT_ROOT, `${options.specialist}-${options.reviewedDataPath ? 'reviewed' : 'cv'}-001`)
  if (Boolean(options.finalFromPath) !== Boolean(options.selectionReportPath)) {
    throw new Error('--final-from and --selection-report are required together')
  }
  if (options.finalFromPath && selectedFold) {
    throw new Error('--final-from and --fold cannot be combined')
  }
  if (options.reviewedDataPath && (options.finalFromPath || selectedFold)) {
    throw new Error('--reviewed-data cannot be combined with --final-from or --fold')
  }
  return options
}

interface ReviewedTrainingRecord {
  system: string
  user: string
  output: string
  metadata: {
    recordId: string
    sourceCaseId: string
    specialist: Specialist
    sourceSplit: string
    sourceDigest: string
    reviewedAt: string
    reviewDecision: string
  }
}

async function trainReviewedAdapter(options: TrainingOptions, config: TrainingConfig): Promise<void> {
  const owner = listUsers().find(user => options.reviewedDataPath === resolve(getProfilePaths(user.username).out,
    'environment-action-selector', 'reviewed', `${options.specialist}.jsonl`))
  if (!owner) throw new Error('Reviewed data must be an intent/task export from a registered profile')
  const candidates = new Map(readEnvironmentTrainingBank(owner.username).candidates.map(candidate => [candidate.id, candidate]))
  const reviews = new Map(readEnvironmentTrainingReviews(owner.username).reviews.map(review => [review.candidateId, review]))
  const content = await readFile(options.reviewedDataPath!, 'utf8')
  const records = content.trim().split('\n').filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line) as ReviewedTrainingRecord }
      catch (error) { throw new Error(`Reviewed data line ${index + 1}: ${String(error)}`) }
    })
  if (!records.length) throw new Error('Reviewed training data is empty')
  const { lock } = await loadPriorEvaluationEvidence()
  const seen = new Set<string>()
  for (const [index, record] of records.entries()) {
    const label = `Reviewed data line ${index + 1}`
    const metadata = record.metadata
    if (!record.system?.trim() || !record.user?.trim() || !record.output?.trim()
      || !metadata || !/^[a-f0-9]{32}$/.test(metadata.recordId)
      || !/^[a-f0-9]{64}$/.test(metadata.sourceDigest)
      || !metadata.sourceCaseId?.trim() || !metadata.reviewedAt?.trim()
      || metadata.specialist !== options.specialist || metadata.sourceSplit !== 'development'
      || !['accept', 'correct'].includes(metadata.reviewDecision)) {
      throw new Error(`${label}: incomplete or mismatched approved-review record`)
    }
    if (seen.has(metadata.recordId)) throw new Error(`${label}: duplicate candidate`)
    seen.add(metadata.recordId)
    const candidate = candidates.get(metadata.recordId)
    const review = reviews.get(metadata.recordId)
    if (!candidate || !review || candidate.specialist !== options.specialist
      || candidate.sourceDigest !== metadata.sourceDigest || review.sourceDigest !== metadata.sourceDigest
      || review.decision !== metadata.reviewDecision || review.reviewedAt !== metadata.reviewedAt
      || record.system !== candidate.system || record.user !== candidate.user
      || metadata.sourceCaseId !== candidate.executionId
      || record.output !== (review.decision === 'correct' ? review.correctedOutput : candidate.observedOutput)) {
      throw new Error(`${label}: record does not match its saved candidate and human review`)
    }
    if (lock.caseIds.includes(metadata.sourceCaseId)
      || EVALUATION_CASES.some(source => source.id === metadata.sourceCaseId)) {
      throw new Error(`${label}: frozen evaluation source`)
    }
    if (options.specialist === 'intent') {
      try { parseEnvironmentIntentRouting(record.output) }
      catch (error) { throw new Error(`${label}: invalid intent output: ${String(error)}`) }
    } else {
      const parsed = JSON.parse(record.output)
      if (!isPlanningDelegation(parsed)) {
        const envelope = JSON.parse(record.user)
        const result = validateEnvironmentSelectorOutput(record.output,
          envelope.currentEnvironment?.sessionId, envelope.activeExecutions ?? [], false)
        if (!result.valid) throw new Error(`${label}: invalid task output: ${result.errors.join('; ')}`)
      }
    }
  }
  const runRoot = resolve(options.outputPath, 'reviewed')
  const trainingPath = resolve(runRoot, 'training.jsonl')
  const configPath = resolve(runRoot, 'training-config.json')
  const adapterPath = resolve(runRoot, 'adapter')
  console.log(`Reviewed ${options.specialist} adapter: ${records.length} approved records`)
  console.log(`Frozen evaluation content not loaded; one-shot digest ${lock.digest}`)
  if (options.dryRun) return
  await mkdir(runRoot, { recursive: true })
  await Promise.all([
    writeFile(trainingPath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`),
    writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`),
    writeFile(resolve(runRoot, 'run-provenance.json'), `${JSON.stringify({
      version: 1, owner: 'environment-action-selector', mode: 'reviewed-training',
      specialist: options.specialist, baseModel: config.base_model,
      trainingRecords: records.length, trainingSourceCases: new Set(records.map(record => record.metadata.sourceCaseId)).size,
      reviewedDataDigest: sha256(records), priorHeldOutDigest: lock.digest, priorHeldOutUsed: false,
      sourcePath: options.reviewedDataPath,
    }, null, 2)}\n`),
  ])
  await runTrainer('reviewed adapter', trainingPath, undefined, configPath, adapterPath)
  console.log(`Reviewed action-selector adapter complete under ${runRoot}`)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function runTrainer(
  label: string,
  trainingPath: string,
  validationPath: string | undefined,
  configPath: string,
  adapterPath: string,
): Promise<void> {
  try {
    await access(resolve(adapterPath, 'adapter_config.json'))
    throw new Error(`${label}: adapter already exists at ${adapterPath}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const childArguments = [
    TRAINER_PATH,
    '--data', trainingPath,
    '--config', configPath,
    '--output', adapterPath,
    '--skip-gguf',
  ]
  if (validationPath) {
    childArguments.push('--eval-data', validationPath)
  }
  const child = spawn(PYTHON_PATH, childArguments, {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`${label}: trainer exited with code ${exitCode}`)
}

function selectedEpochCount(policy: DevelopmentSelectionReport['checkpointPolicy']): number {
  if (policy === 'best-loss') return 1
  if (policy === 'epoch-1') return 1
  if (policy === 'epoch-2') return 2
  if (policy === 'final-epoch') return 3
  throw new Error('Selection report has no supported checkpoint policy')
}

async function trainFinalAdapter(
  options: TrainingOptions,
  config: TrainingConfig,
): Promise<void> {
  const sourceRoot = options.finalFromPath!
  const reportPath = options.selectionReportPath!
  if (!sourceRoot.startsWith(`${OUTPUT_ROOT}${sep}`) || !reportPath.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error('Final training evidence must remain inside one action-selector development run')
  }
  const report = await readJson<DevelopmentSelectionReport>(reportPath)
  if (
    report.owner !== 'environment-action-selector'
    || report.specialist !== options.specialist
    || report.split !== 'development-cross-validation'
    || report.priorHeldOutUsed !== false
    || typeof report.aggregate?.exactRouting?.rate !== 'number'
    || !Number.isInteger(report.aggregate?.total)
  ) throw new Error('Final training requires a complete action-selector development report')
  const expectedReportPath = resolve(sourceRoot, report.checkpointPolicy === 'best-loss'
    ? 'development-validation.json'
    : `development-validation-${report.checkpointPolicy}.json`)
  if (reportPath !== expectedReportPath) throw new Error('Selection report path does not match its checkpoint policy')

  const { lock, receipt } = await loadPriorEvaluationEvidence()
  const foldArtifacts = await Promise.all([...Array(DEVELOPMENT_FOLD_COUNT).keys()].map(async fold => {
    const [provenance, validationText] = await Promise.all([
      readJson<FoldProvenance>(resolve(sourceRoot, `fold-${fold}`, 'run-provenance.json')),
      readFile(resolve(sourceRoot, `fold-${fold}`, 'validation.jsonl'), 'utf8'),
    ])
    const records = validationText.trim().split('\n').map(line => JSON.parse(line)) as ActionSelectorTrainingRecord[]
    if (
      provenance.owner !== 'environment-action-selector'
      || provenance.baseModel !== config.base_model
      || provenance.fold !== fold
      || provenance.validationRecordCount !== records.length
      || provenance.priorHeldOutDigest !== lock.digest
      || provenance.priorHeldOutUsed !== false
      || records.some(record => record.metadata.developmentFold !== fold)
    ) throw new Error(`fold ${fold}: archived development provenance is invalid`)
    return { provenance, records }
  }))
  const datasetDigests = new Set(foldArtifacts.map(value => value.provenance.developmentDatasetDigest))
  if (datasetDigests.size !== 1) throw new Error('Archived folds do not share one development dataset')

  const archivedRecords = foldArtifacts.flatMap(value => value.records)
  const archivedById = new Map(archivedRecords.map(record => [record.metadata.recordId, record]))
  if (archivedById.size !== archivedRecords.length || report.aggregate.total !== archivedRecords.length) {
    throw new Error('Archived development records are incomplete or duplicated')
  }
  const sourceIds = new Set(archivedRecords.map(record => record.metadata.sourceCaseId))
  const selectedCases = DEVELOPMENT_CASES.filter(sourceCase => sourceCase.specialist === options.specialist && sourceIds.has(sourceCase.id))
  if (selectedCases.length !== sourceIds.size) throw new Error('Archived development run references unknown source cases')
  const records = await buildDevelopmentRecords(selectedCases)
  const archivedInCanonicalOrder = records.map(record => archivedById.get(record.metadata.recordId))
  if (archivedInCanonicalOrder.some(record => !record)
    || sha256(archivedInCanonicalOrder) !== sha256(records)
    || sha256(records) !== [...datasetDigests][0]) {
    throw new Error('Archived development data drifted from its reviewed source cases or Core prompt')
  }
  const errors = validateDevelopmentRecords(records, selectedCases, lock.caseIds)
  if (errors.length > 0) throw new Error(`Final development records are invalid:\n- ${errors.join('\n- ')}`)

  const epochs = selectedEpochCount(report.checkpointPolicy)
  const finalRoot = resolve(options.outputPath, 'final')
  const trainingPath = resolve(finalRoot, 'training.jsonl')
  const configPath = resolve(finalRoot, 'training-config.json')
  const adapterPath = resolve(finalRoot, 'adapter')
  const finalConfig = {
    ...config,
    num_train_epochs: epochs,
    save_total_limit: epochs,
  }
  console.log(`Final adapter: ${records.length} records / ${selectedCases.length} source cases / ${epochs} epochs`)
  console.log(`Selection evidence: ${reportPath}`)
  console.log(`Retired held-out content not loaded; one-shot digest ${lock.digest}`)
  if (options.dryRun) return
  await mkdir(finalRoot, { recursive: true })
  await Promise.all([
    writeFile(trainingPath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`),
    writeFile(configPath, `${JSON.stringify(finalConfig, null, 2)}\n`),
    writeFile(resolve(finalRoot, 'run-provenance.json'), `${JSON.stringify({
      version: 1,
      owner: 'environment-action-selector',
      mode: 'final-development-training',
      specialist: options.specialist,
      baseModel: config.base_model,
      trainingRecords: records.length,
      trainingSourceCases: selectedCases.length,
      validationRecords: 0,
      epochs,
      archivedDatasetDigest: [...datasetDigests][0],
      priorHeldOutDigest: lock.digest,
      priorHeldOutUsed: false,
      priorOneShotCompletedAt: receipt.completedAt,
      selectionEvidence: {
        path: reportPath.slice(REPOSITORY_ROOT.length + 1),
        digest: sha256(report),
        checkpointPolicy: report.checkpointPolicy,
        exactRouting: report.aggregate.exactRouting,
        unsafeActionAuthorityErrors: report.aggregate.unsafeActionAuthorityErrors,
        missedPhysicalActions: report.aggregate.missedPhysicalActions,
        wrongPhysicalActions: report.aggregate.wrongPhysicalActions,
        unnecessaryCaptures: report.aggregate.unnecessaryCaptures,
      },
    }, null, 2)}\n`),
  ])
  await runTrainer('final adapter', trainingPath, undefined, configPath, adapterPath)
  console.log(`Final action-selector adapter complete under ${finalRoot}`)
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(arguments_)
  if (!options.outputPath.startsWith(`${OUTPUT_ROOT}${sep}`)) {
    throw new Error(`Training output must remain under ${OUTPUT_ROOT}`)
  }
  await Promise.all([access(PYTHON_PATH), access(TRAINER_PATH), access(CONFIG_PATH)])
  const config = { ...await readJson<TrainingConfig>(CONFIG_PATH), specialist: options.specialist,
    max_seq_length: options.specialist === 'task' ? 4096 : 1536,
    generation_max_new_tokens: options.specialist === 'task' ? 768 : 384,
  } as TrainingConfig
  if (
    config.owner !== 'environment-action-selector'
    || config.base_model !== 'unsloth/Qwen3.5-0.8B'
    || config.require_exact_messages !== true
    || config.train_on_responses_only !== true
    || config.development_fold_count !== DEVELOPMENT_FOLD_COUNT
  ) throw new Error('Training config does not match the system-owned Qwen3.5-0.8B action-selector contract')

  if (options.finalFromPath) {
    await trainFinalAdapter(options, config)
    return
  }
  if (options.reviewedDataPath) {
    await trainReviewedAdapter(options, config)
    return
  }

  const expectedRecords = await buildDevelopmentRecords()
  const allRecords = (await readFile(DEVELOPMENT_RECORDS_PATH, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line)) as ActionSelectorTrainingRecord[]
  const { lock: priorLock, receipt: priorReceipt } = await loadPriorEvaluationEvidence()
  const errors = validateDevelopmentRecords(allRecords, undefined, priorLock.caseIds)
  if (errors.length > 0) throw new Error(`Development records are invalid:\n- ${errors.join('\n- ')}`)
  if (sha256(allRecords) !== sha256(expectedRecords)) {
    throw new Error('Development records drifted from the reviewed source cases or Core prompt builder')
  }
  const manifest = await readJson<Record<string, unknown>>(DEVELOPMENT_MANIFEST_PATH)
  const expectedManifest = await buildDevelopmentManifest(allRecords)
  if (sha256(manifest) !== sha256(expectedManifest)) {
    throw new Error('Development manifest drifted; regenerate before training')
  }
  if (
    manifest.priorLockedDigest !== priorLock.digest
    || manifest.priorLockedCasesUsed !== false
    || manifest.priorOneShotCompletedAt !== priorReceipt.completedAt
  ) {
    throw new Error('Retired one-shot evaluation provenance is invalid')
  }

  const checkedInRecords = allRecords.filter(record => record.metadata.specialist === options.specialist)
  console.log(`Validated ${checkedInRecords.length} development-only action-selector records`)
  console.log(`Retired held-out content not loaded; one-shot digest ${priorLock.digest}`)
  console.log(`Folds: ${options.folds.join(', ')}${options.folds.length > 1 ? ' (sequential GPU jobs)' : ''}`)

  const jobs = options.folds.map(fold => async () => {
    const foldRoot = resolve(options.outputPath, `fold-${fold}`)
    const training = checkedInRecords.filter(record => record.metadata.developmentFold !== fold)
    const validation = checkedInRecords.filter(record => record.metadata.developmentFold === fold)
    const trainingSourceIds = new Set(training.map(record => record.metadata.sourceCaseId))
    const validationSourceIds = new Set(validation.map(record => record.metadata.sourceCaseId))
    if ([...validationSourceIds].some(id => trainingSourceIds.has(id))) {
      throw new Error(`fold ${fold}: source-case leakage detected`)
    }
    const trainingPath = resolve(foldRoot, 'training.jsonl')
    const validationPath = resolve(foldRoot, 'validation.jsonl')
    const adapterPath = resolve(foldRoot, 'adapter')
    const provenance = {
      version: 1,
      owner: 'environment-action-selector',
      specialist: options.specialist,
      baseModel: config.base_model,
      fold,
      trainingRecordCount: training.length,
      validationRecordCount: validation.length,
      trainingSourceCaseCount: trainingSourceIds.size,
      validationSourceCaseCount: validationSourceIds.size,
      developmentDatasetDigest: sha256(checkedInRecords),
      priorHeldOutDigest: priorLock.digest,
      priorHeldOutUsed: false,
    }
    console.log(`fold ${fold}: ${training.length} train / ${validation.length} validation records; ${trainingSourceIds.size}/${validationSourceIds.size} source cases`)
    if (options.dryRun) return
    await mkdir(foldRoot, { recursive: true })
    await Promise.all([
      writeFile(trainingPath, `${training.map(record => JSON.stringify(record)).join('\n')}\n`),
      writeFile(validationPath, `${validation.map(record => JSON.stringify(record)).join('\n')}\n`),
      writeFile(resolve(foldRoot, 'training-config.json'), `${JSON.stringify(config, null, 2)}\n`),
      writeFile(resolve(foldRoot, 'run-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`),
    ])
    await runTrainer(`fold ${fold}`, trainingPath, validationPath, resolve(foldRoot, 'training-config.json'), adapterPath)
  })
  for (const job of jobs) await job()
  if (!options.dryRun) console.log(`All requested folds completed under ${options.outputPath}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
