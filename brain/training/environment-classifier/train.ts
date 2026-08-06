import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENVIRONMENT_CLASSIFIER_SYSTEM_PROMPT } from '@metahuman/core/environment-classifier'
import {
  CLASSIFIER_LANE_DIRECTORY,
  REPOSITORY_ROOT,
  loadLockedCorpus,
  sha256,
} from './corpus.js'
import {
  DEVELOPMENT_FOLD_COUNT,
  buildTrainingDataset,
  buildTrainingManifest,
  validateTrainingDataset,
  TRAINING_DATA_PATH,
  TRAINING_MANIFEST_PATH,
  type ClassifierTrainingRecord,
} from './generate-training-data.js'
import { loadContextRouterPrompt } from './prompt.js'

const DEFAULT_CONFIG_PATH = resolve(CLASSIFIER_LANE_DIRECTORY, 'training-qwen3.5-0.8b.json')
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-classifier/training')
const TRAINER_PATH = resolve(REPOSITORY_ROOT, 'docker/runpod-trainer/train_unsloth.py')
const PYTHON_PATH = resolve(REPOSITORY_ROOT, 'venv/bin/python')

interface TrainingOptions {
  configPath: string
  outputPath: string
  folds: number[]
  final: boolean
  selectionReportPath?: string
  dryRun: boolean
}

interface TrainingConfig {
  owner?: string
  base_model?: string
  system_prompt?: string
  require_exact_messages?: boolean
  train_on_responses_only?: boolean
  development_fold_count?: number
  [key: string]: unknown
}

interface DevelopmentSelectionReport {
  split?: string
  heldOutUsed?: boolean
  heldOutDigest?: string
  checkpointPolicy?: string
  aggregate?: {
    exactRoute?: {
      count?: number
      rate?: number
    }
    unsafeActionErrors?: number
    unnecessaryVisionAdmissions?: number
  }
}

function parseOptions(arguments_: string[]): TrainingOptions {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const options: TrainingOptions = {
    configPath: DEFAULT_CONFIG_PATH,
    outputPath: resolve(OUTPUT_ROOT, `qwen3.5-0.8b-${stamp}`),
    folds: [...Array(DEVELOPMENT_FOLD_COUNT).keys()],
    final: false,
    dryRun: false,
  }
  let selectedFold = false

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--dry-run') {
      options.dryRun = true
    } else if (argument === '--final') {
      options.final = true
    } else if (argument === '--selection-report' && value) {
      options.selectionReportPath = resolve(value)
      index += 1
    } else if (argument === '--config' && value) {
      options.configPath = resolve(value)
      index += 1
    } else if (argument === '--output' && value) {
      options.outputPath = resolve(value)
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
  if (options.final && selectedFold) throw new Error('--final and --fold cannot be combined')
  if (options.final !== Boolean(options.selectionReportPath)) {
    throw new Error('--final requires --selection-report, and --selection-report is final-training evidence only')
  }
  return options
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function runTrainer(
  options: TrainingOptions,
  dataPath: string,
  validationPath: string | undefined,
  outputPath: string,
): Promise<number> {
  const trainerArguments = [
    TRAINER_PATH,
    '--data', dataPath,
    '--config', options.configPath,
    '--output', outputPath,
    '--skip-gguf',
  ]
  if (validationPath) {
    trainerArguments.push('--eval-data', validationPath, '--skip-validation-generation')
  }
  const child = spawn(PYTHON_PATH, trainerArguments, {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  return await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(arguments_)
  const normalizedOutputRoot = `${OUTPUT_ROOT}${sep}`
  if (!options.outputPath.startsWith(normalizedOutputRoot)) {
    throw new Error(`Training output must remain under the system-owned lane: ${OUTPUT_ROOT}`)
  }

  await access(PYTHON_PATH)
  await access(TRAINER_PATH)
  const config = await loadJson<TrainingConfig>(options.configPath)
  if (config.owner !== 'environment-classifier'
    || config.base_model !== 'unsloth/Qwen3.5-0.8B'
    || config.system_prompt !== ENVIRONMENT_CLASSIFIER_SYSTEM_PROMPT
    || config.require_exact_messages !== true
    || config.train_on_responses_only !== true
    || config.development_fold_count !== DEVELOPMENT_FOLD_COUNT) {
    throw new Error('0.8B training config must preserve the system owner, exact trainable base, compact prompt, response-only exact-message mode, and four folds')
  }

  const { corpus, lock } = await loadLockedCorpus()
  const prompt = await loadContextRouterPrompt()
  const expectedRecords = buildTrainingDataset(corpus, prompt)
  const recordsText = await readFile(TRAINING_DATA_PATH, 'utf8')
  const records = recordsText.trim().split('\n').map(line => JSON.parse(line)) as ClassifierTrainingRecord[]
  const errors = validateTrainingDataset(records, corpus, lock)
  if (errors.length > 0) throw new Error(`Training dataset is invalid:\n- ${errors.join('\n- ')}`)
  if (sha256(records) !== sha256(expectedRecords)) {
    throw new Error('Training dataset has drifted from the current development cases or active prompt')
  }

  const manifest = await loadJson<ReturnType<typeof buildTrainingManifest>>(TRAINING_MANIFEST_PATH)
  const expectedManifest = buildTrainingManifest({ records, corpus, lock, prompt })
  if (sha256(manifest) !== sha256(expectedManifest)) {
    throw new Error('Training manifest has drifted; regenerate before training')
  }

  const provenance = {
    version: 1,
    owner: 'environment-classifier',
    baseModel: config.base_model,
    configPath: 'brain/training/environment-classifier/training-qwen3.5-0.8b.json',
    configDigest: sha256(config),
    datasetPath: 'brain/training/environment-classifier/development-training.jsonl',
    datasetDigest: manifest.provenance.datasetDigest,
    promptDigest: manifest.provenance.promptDigest,
    heldOutDigest: manifest.provenance.heldOutDigest,
    heldOutUsed: false,
  }

  let selectionEvidence: {
    path: string
    digest: string
    checkpointPolicy: string
    exactRouteCount: number
    exactRouteRate: number
    unsafeActionErrors: number
    unnecessaryVisionAdmissions: number
  } | undefined
  if (options.selectionReportPath) {
    const normalizedSelectionRoot = `${OUTPUT_ROOT}${sep}`
    if (!options.selectionReportPath.startsWith(normalizedSelectionRoot)) {
      throw new Error(`Selection report must remain under ${OUTPUT_ROOT}`)
    }
    const report = await loadJson<DevelopmentSelectionReport>(options.selectionReportPath)
    const exactRoute = report.aggregate?.exactRoute
    if (report.split !== 'development-cross-validation'
      || report.heldOutUsed !== false
      || report.heldOutDigest !== lock.digest
      || report.checkpointPolicy !== 'final-epoch'
      || !Number.isInteger(exactRoute?.count)
      || typeof exactRoute?.rate !== 'number'
      || !Number.isInteger(report.aggregate?.unsafeActionErrors)
      || !Number.isInteger(report.aggregate?.unnecessaryVisionAdmissions)) {
      throw new Error('Final training requires a complete final-epoch development cross-validation report with the current held-out digest')
    }
    selectionEvidence = {
      path: options.selectionReportPath.slice(REPOSITORY_ROOT.length + 1),
      digest: sha256(report),
      checkpointPolicy: report.checkpointPolicy,
      exactRouteCount: exactRoute.count,
      exactRouteRate: exactRoute.rate,
      unsafeActionErrors: report.aggregate.unsafeActionErrors,
      unnecessaryVisionAdmissions: report.aggregate.unnecessaryVisionAdmissions,
    }
  }

  const foldSummaries = options.folds.map(fold => {
    const training = records.filter(record => record.metadata.developmentFold !== fold)
    const validation = records.filter(record => record.metadata.developmentFold === fold)
    const trainingCases = new Set(training.map(record => record.metadata.sourceCaseId))
    const validationCases = new Set(validation.map(record => record.metadata.sourceCaseId))
    if ([...validationCases].some(caseId => trainingCases.has(caseId))) {
      throw new Error(`fold ${fold}: source-case leakage between training and validation`)
    }
    return {
      fold,
      training,
      validation,
      trainingSourceCases: trainingCases.size,
      validationSourceCases: validationCases.size,
    }
  })

  console.log(`Validated ${records.length} system-owned development records for Qwen3.5-0.8B`)
  console.log(`Output: ${options.outputPath}`)
  console.log(`Held-out digest excluded from training: ${lock.digest}`)
  if (options.final) {
    console.log(`Final adapter: ${records.length} training records / 0 validation records; ${new Set(records.map(record => record.metadata.sourceCaseId)).size} development source cases`)
    console.log(`Selection report: ${selectionEvidence?.path}`)
  } else {
    for (const fold of foldSummaries) {
      console.log(`Fold ${fold.fold}: ${fold.training.length} training records / ${fold.validation.length} validation records; ${fold.trainingSourceCases}/${fold.validationSourceCases} source cases`)
    }
  }
  if (options.dryRun) return

  await mkdir(options.outputPath, { recursive: true })
  const compactRecord = (record: ClassifierTrainingRecord) => ({
    system: config.system_prompt,
    user: record.compactInput,
    output: record.output,
    metadata: record.metadata,
  })
  if (options.final) {
    const finalPath = resolve(options.outputPath, 'final')
    const trainingPath = resolve(finalPath, 'training.jsonl')
    const adapterPath = resolve(finalPath, 'adapter')
    const sourceCaseCount = new Set(records.map(record => record.metadata.sourceCaseId)).size
    await mkdir(finalPath, { recursive: true })
    await writeFile(
      trainingPath,
      `${records.map(record => JSON.stringify(compactRecord(record))).join('\n')}\n`,
      'utf8',
    )
    await writeFile(
      resolve(finalPath, 'run-provenance.json'),
      `${JSON.stringify({
        ...provenance,
        mode: 'final-development-training',
        trainingRecords: records.length,
        validationRecords: 0,
        trainingSourceCases: sourceCaseCount,
        validationSourceCases: 0,
        selectionEvidence,
      }, null, 2)}\n`,
      'utf8',
    )
    const exitCode = await runTrainer(options, trainingPath, undefined, adapterPath)
    if (exitCode !== 0) throw new Error(`Unsloth final trainer exited with code ${exitCode}`)
    console.log('Final adapter: training complete; evaluate the locked split once through the provider-neutral harness')
    return
  }

  for (const fold of foldSummaries) {
    const foldPath = resolve(options.outputPath, `fold-${fold.fold}`)
    const trainingPath = resolve(foldPath, 'training.jsonl')
    const validationPath = resolve(foldPath, 'validation.jsonl')
    const adapterPath = resolve(foldPath, 'adapter')
    await mkdir(foldPath, { recursive: true })
    await writeFile(
      trainingPath,
      `${fold.training.map(record => JSON.stringify(compactRecord(record))).join('\n')}\n`,
      'utf8',
    )
    await writeFile(
      validationPath,
      `${fold.validation.map(record => JSON.stringify(compactRecord(record))).join('\n')}\n`,
      'utf8',
    )
    await writeFile(
      resolve(foldPath, 'run-provenance.json'),
      `${JSON.stringify({
        ...provenance,
        fold: fold.fold,
        trainingRecords: fold.training.length,
        validationRecords: fold.validation.length,
        trainingSourceCases: fold.trainingSourceCases,
        validationSourceCases: fold.validationSourceCases,
      }, null, 2)}\n`,
      'utf8',
    )
    const exitCode = await runTrainer(options, trainingPath, validationPath, adapterPath)
    if (exitCode !== 0) throw new Error(`Unsloth trainer fold ${fold.fold} exited with code ${exitCode}`)
    console.log(`Fold ${fold.fold}: training complete; generate route predictions with the fresh-process checkpoint evaluator`)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
