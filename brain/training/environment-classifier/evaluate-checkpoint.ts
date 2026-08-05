import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPOSITORY_ROOT, loadLockedCorpus } from './corpus.js'

const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-classifier/training')
const CONFIG_PATH = resolve(
  REPOSITORY_ROOT,
  'brain/training/environment-classifier/training-qwen3.5-0.8b.json',
)
const EVALUATOR_PATH = resolve(
  REPOSITORY_ROOT,
  'brain/training/environment-classifier/evaluate_qwen_checkpoint.py',
)
const PYTHON_PATH = resolve(REPOSITORY_ROOT, 'venv/bin/python')

interface Options {
  root: string
  fold: number
  checkpoint: string
}

function parseOptions(arguments_: string[]): Options {
  let root: string | undefined
  let fold: number | undefined
  let checkpoint: string | undefined
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--root' && value) {
      root = resolve(value)
      index += 1
    } else if (argument === '--fold' && value) {
      fold = Number.parseInt(value, 10)
      index += 1
    } else if (argument === '--checkpoint' && value) {
      checkpoint = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }
  if (!root || !Number.isInteger(fold) || fold === undefined || fold < 0 || fold > 3 || !checkpoint) {
    throw new Error('Usage: --root out/environment-classifier/training/<run> --fold 0 --checkpoint checkpoint-163')
  }
  if (!root.startsWith(`${OUTPUT_ROOT}${sep}`)) {
    throw new Error(`Evaluation root must remain under ${OUTPUT_ROOT}`)
  }
  if (!/^checkpoint-\d+$/.test(checkpoint)) {
    throw new Error('--checkpoint must be one retained checkpoint directory name')
  }
  return { root, fold, checkpoint }
}

async function run(arguments_: string[]): Promise<number> {
  const child = spawn(PYTHON_PATH, arguments_, {
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
  const foldPath = resolve(options.root, `fold-${options.fold}`)
  const validationPath = resolve(foldPath, 'validation.jsonl')
  const adapterPath = resolve(foldPath, 'adapter', options.checkpoint)
  const predictionPath = resolve(foldPath, `${options.checkpoint}-validation-predictions.jsonl`)
  await Promise.all([
    access(PYTHON_PATH),
    access(EVALUATOR_PATH),
    access(CONFIG_PATH),
    access(validationPath),
    access(resolve(adapterPath, 'adapter_config.json')),
  ])

  const { lock } = await loadLockedCorpus()
  const heldOutIds = new Set(lock.caseIds)
  const records = (await readFile(validationPath, 'utf8')).trim().split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line)) as Array<{ metadata?: Record<string, unknown> }>
  if (records.some(record => heldOutIds.has(String(record.metadata?.sourceCaseId)))) {
    throw new Error('Checkpoint evaluation refused held-out source exposure')
  }
  if (records.some(record => record.metadata?.sourceSplit !== 'development'
    || record.metadata?.systemOwned !== true
    || record.metadata?.developmentFold !== options.fold)) {
    throw new Error('Checkpoint evaluation requires one system-owned development fold')
  }

  console.log(`Evaluating ${basename(adapterPath)} on ${records.length} development records`)
  const exitCode = await run([
    EVALUATOR_PATH,
    '--data', validationPath,
    '--adapter', adapterPath,
    '--config', CONFIG_PATH,
    '--output', predictionPath,
    '--fold', String(options.fold),
  ])
  if (exitCode !== 0) throw new Error(`Checkpoint evaluator exited with code ${exitCode}`)
  console.log(`Predictions: ${predictionPath}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
