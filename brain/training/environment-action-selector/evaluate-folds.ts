import { spawn } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import {
  ACTION_SELECTOR_DIRECTORY,
  REPOSITORY_ROOT,
} from './corpus.js'
import { DEVELOPMENT_FOLD_COUNT } from './generate-training-data.js'

const CONFIG_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'training-qwen3.5-0.8b.json')
const EVALUATOR_PATH = resolve(ACTION_SELECTOR_DIRECTORY, 'evaluate_qwen_checkpoint.py')
const PYTHON_PATH = resolve(REPOSITORY_ROOT, 'venv/bin/python')
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training')

interface Options {
  root: string
  folds: number[]
  dryRun: boolean
  checkpointPolicy: 'best-loss' | 'epoch-2' | 'final-epoch'
}

function parseOptions(arguments_: string[]): Options {
  const options: Options = {
    root: resolve(OUTPUT_ROOT, 'qwen3.5-0.8b-cv-001'),
    folds: [...Array(DEVELOPMENT_FOLD_COUNT).keys()],
    dryRun: false,
    checkpointPolicy: 'best-loss',
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--checkpoint-policy' && (value === 'best-loss' || value === 'epoch-2' || value === 'final-epoch')) {
      options.checkpointPolicy = value
      index += 1
    }
    else if (argument === '--root' && value) {
      options.root = resolve(value)
      index += 1
    } else if (argument === '--fold' && value) {
      const fold = Number.parseInt(value, 10)
      if (!Number.isInteger(fold) || fold < 0 || fold >= DEVELOPMENT_FOLD_COUNT) throw new Error('invalid --fold')
      options.folds = [fold]
      index += 1
    } else throw new Error(`Unknown or incomplete argument: ${argument}`)
  }
  if (!options.root.startsWith(`${OUTPUT_ROOT}${sep}`)) throw new Error(`Evaluation root must remain under ${OUTPUT_ROOT}`)
  return options
}

async function selectAdapter(foldRoot: string, checkpointPolicy: Options['checkpointPolicy']): Promise<string> {
  const adapterRoot = resolve(foldRoot, 'adapter')
  if (checkpointPolicy === 'best-loss') return adapterRoot
  const checkpoints = (await readdir(adapterRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^checkpoint-\d+$/.test(entry.name))
    .map(entry => ({ name: entry.name, step: Number.parseInt(entry.name.slice('checkpoint-'.length), 10) }))
    .sort((left, right) => left.step - right.step)
  if (checkpoints.length < 3) throw new Error(`Expected three retained checkpoints under ${adapterRoot}`)
  const selected = checkpointPolicy === 'epoch-2' ? checkpoints[1] : checkpoints.at(-1)
  return resolve(adapterRoot, selected!.name)
}

async function runFold(root: string, fold: number, checkpointPolicy: Options['checkpointPolicy']): Promise<void> {
  const foldRoot = resolve(root, `fold-${fold}`)
  const provenance = JSON.parse(await readFile(resolve(foldRoot, 'run-provenance.json'), 'utf8'))
  if (
    provenance.owner !== 'environment-action-selector'
    || provenance.fold !== fold
    || provenance.priorHeldOutUsed !== false
  ) {
    throw new Error(`fold ${fold}: invalid development-only provenance`)
  }
  const adapter = await selectAdapter(foldRoot, checkpointPolicy)
  const validation = resolve(foldRoot, 'validation.jsonl')
  const output = resolve(foldRoot, checkpointPolicy === 'best-loss'
    ? 'validation-predictions.jsonl'
    : `validation-predictions-${checkpointPolicy}.jsonl`)
  await Promise.all([access(resolve(adapter, 'adapter_config.json')), access(validation)])
  const child = spawn(PYTHON_PATH, [
    EVALUATOR_PATH,
    '--data', validation,
    '--adapter', adapter,
    '--config', CONFIG_PATH,
    '--output', output,
    '--fold', String(fold),
  ], { cwd: REPOSITORY_ROOT, env: process.env, stdio: 'inherit' })
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`fold ${fold}: evaluator exited with code ${exitCode}`)
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(arguments_)
  await Promise.all([access(PYTHON_PATH), access(EVALUATOR_PATH), access(CONFIG_PATH)])
  console.log(`Evaluation folds: ${options.folds.join(', ')}${options.folds.length > 1 ? ' (parallel)' : ''}; checkpoint policy: ${options.checkpointPolicy}`)
  if (options.dryRun) return
  await Promise.all(options.folds.map(fold => runFold(options.root, fold, options.checkpointPolicy)))
  console.log('Development-fold evaluation complete')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
