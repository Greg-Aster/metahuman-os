import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vllm } from '@metahuman/core/vllm'
import { main as runBenchmark } from './benchmark.js'
import {
  REPOSITORY_ROOT,
  loadLockedCorpus,
  sha256,
} from './corpus.js'
import {
  TRAINING_DATA_PATH,
  type ClassifierTrainingRecord,
} from './generate-training-data.js'
import { buildFinalArtifactVLLMConfig } from './final-artifact.js'

const TRAINING_OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-classifier/training')

interface Options {
  root: string
  dryRun: boolean
}

interface FinalProvenance {
  owner?: string
  baseModel?: string
  datasetDigest?: string
  heldOutDigest?: string
  heldOutUsed?: boolean
  mode?: string
  trainingRecords?: number
  trainingSourceCases?: number
  selectionEvidence?: {
    path?: string
    digest?: string
    checkpointPolicy?: string
  }
}

interface AdapterConfig {
  base_model_name_or_path?: string
  r?: number
}

interface EvaluationReceipt {
  version: 1
  owner: 'environment-classifier'
  status: 'started' | 'completed' | 'failed'
  model: string
  heldOutDigest: string
  heldOutCaseCount: number
  startedAt: string
  completedAt?: string
  benchmarkJson?: string
  benchmarkMarkdown?: string
  error?: string
}

function parseOptions(arguments_: string[]): Options {
  let rootValue: string | undefined
  let dryRun = false
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--dry-run') {
      dryRun = true
    } else if (argument === '--root' && value) {
      rootValue = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }
  if (!rootValue) {
    throw new Error('Usage: --root out/environment-classifier/training/<final-run> [--dry-run]')
  }
  const root = resolve(rootValue)
  if (!root.startsWith(`${TRAINING_OUTPUT_ROOT}${sep}`)) {
    throw new Error(`Final evaluation root must remain under ${TRAINING_OUTPUT_ROOT}`)
  }
  return { root, dryRun }
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function relativePath(path: string): string {
  return path.slice(REPOSITORY_ROOT.length + 1)
}

async function writeReceipt(path: string, receipt: EvaluationReceipt): Promise<void> {
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(arguments_)
  const finalPath = resolve(options.root, 'final')
  const adapterPath = resolve(finalPath, 'adapter')
  const provenancePath = resolve(finalPath, 'run-provenance.json')
  const receiptPath = resolve(finalPath, 'locked-evaluation-receipt.json')
  const evaluationPath = resolve(finalPath, 'locked-evaluation')
  const { corpus, lock } = await loadLockedCorpus()
  const trainingRecords = (await readFile(TRAINING_DATA_PATH, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as ClassifierTrainingRecord)
  const developmentSourceCases = new Set(corpus.cases
    .filter(testCase => testCase.split === 'development')
    .map(testCase => testCase.id))
  const trainingSourceCases = new Set(trainingRecords.map(record => record.metadata.sourceCaseId))
  if (trainingSourceCases.size !== developmentSourceCases.size
    || [...trainingSourceCases].some(caseId => !developmentSourceCases.has(caseId))) {
    throw new Error('Current training dataset does not contain exactly the development source cases')
  }

  if (await fileExists(receiptPath)) {
    const receipt = await loadJson<EvaluationReceipt>(receiptPath)
    throw new Error(`Locked evaluation was already ${receipt.status} at ${receipt.startedAt}; this command cannot rerun it`)
  }

  const provenance = await loadJson<FinalProvenance>(provenancePath)
  const selectionPath = provenance.selectionEvidence?.path
    ? resolve(REPOSITORY_ROOT, provenance.selectionEvidence.path)
    : undefined
  if (!selectionPath
    || !selectionPath.startsWith(`${TRAINING_OUTPUT_ROOT}${sep}`)
    || provenance.owner !== 'environment-classifier'
    || provenance.baseModel !== 'unsloth/Qwen3.5-0.8B'
    || provenance.mode !== 'final-development-training'
    || provenance.heldOutUsed !== false
    || provenance.heldOutDigest !== lock.digest
    || provenance.datasetDigest !== sha256(trainingRecords)
    || provenance.trainingRecords !== trainingRecords.length
    || provenance.trainingSourceCases !== trainingSourceCases.size
    || provenance.selectionEvidence?.checkpointPolicy !== 'final-epoch') {
    throw new Error('Final artifact provenance is incomplete or does not match the locked development decision')
  }

  const selectionReport = await loadJson<unknown>(selectionPath)
  if (sha256(selectionReport) !== provenance.selectionEvidence.digest) {
    throw new Error('Selected development cross-validation report has drifted since final training')
  }

  const adapterConfig = await loadJson<AdapterConfig>(resolve(adapterPath, 'adapter_config.json'))
  if (adapterConfig.base_model_name_or_path !== provenance.baseModel || adapterConfig.r !== 16) {
    throw new Error('Final adapter does not match the selected Qwen3.5-0.8B rank-16 training recipe')
  }
  for (const required of [
    'adapter_model.safetensors',
    'tokenizer.json',
    'chat_template.jinja',
  ]) {
    await access(resolve(adapterPath, required))
  }

  const runId = options.root.slice(TRAINING_OUTPUT_ROOT.length + 1)
  const model = `environment-classifier-${runId}-final`.replace(/[^a-zA-Z0-9._-]+/g, '-')
  console.log(`Validated final adapter ${model}`)
  console.log(`Held-out digest reserved for one evaluation: ${lock.digest}`)
  if (options.dryRun) return

  if (await vllm.isRunning()) {
    throw new Error('A vLLM server is already running; stop it before the isolated final evaluation')
  }

  let serverStarted = false
  let receipt: EvaluationReceipt | undefined
  try {
    vllm.setEndpoint('http://localhost:8000')
    const result = await vllm.startServer(buildFinalArtifactVLLMConfig({
      baseModel: provenance.baseModel,
      adapterPath,
      model,
    }))
    if (!result.success) throw new Error(result.error || 'vLLM failed to start the final adapter')
    serverStarted = true

    const loadedModels = await vllm.listModels()
    if (!loadedModels.some(loaded => loaded.id === model)) {
      throw new Error(`vLLM started without the final adapter alias ${model}`)
    }

    await mkdir(evaluationPath, { recursive: true })
    receipt = {
      version: 1,
      owner: 'environment-classifier',
      status: 'started',
      model,
      heldOutDigest: lock.digest,
      heldOutCaseCount: lock.caseIds.length,
      startedAt: new Date().toISOString(),
    }
    await writeReceipt(receiptPath, receipt)

    await runBenchmark([
      '--provider', 'vllm',
      '--models', model,
      '--split', 'held_out',
      '--message-format', 'compact',
      '--endpoint', 'http://localhost:8000',
      '--output-dir', evaluationPath,
    ])

    const reports = (await readdir(evaluationPath))
      .filter(name => /^benchmark-.*\.json$/.test(name))
      .sort()
    const benchmarkJson = reports.at(-1)
    if (!benchmarkJson) throw new Error('Benchmark completed without a machine-readable report')
    const benchmarkMarkdown = benchmarkJson.replace(/\.json$/, '.md')
    await access(resolve(evaluationPath, benchmarkMarkdown))

    receipt = {
      ...receipt,
      status: 'completed',
      completedAt: new Date().toISOString(),
      benchmarkJson: relativePath(resolve(evaluationPath, benchmarkJson)),
      benchmarkMarkdown: relativePath(resolve(evaluationPath, benchmarkMarkdown)),
    }
    await writeReceipt(receiptPath, receipt)
    console.log(`Locked evaluation receipt: ${receiptPath}`)
  } catch (error) {
    if (receipt) {
      await writeReceipt(receiptPath, {
        ...receipt,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    if (serverStarted) await vllm.stopServer()
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
