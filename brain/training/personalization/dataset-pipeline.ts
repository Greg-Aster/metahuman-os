import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  audit, systemPaths, inspectTrainingDataset, readTrainingDataSettings,
  selectPersonalizationDataset, trainingPersonaContext,
  readTrainingDatasetHistory, trainingSampleContentHash,
  type TrainingDatasetInspection,
} from '@metahuman/core'
import type { CognitiveMode, TrainingDataSettings } from '@metahuman/core/training-schema'

export type PersonalizationProgram = 'organizer' | 'curator'
export interface ProgramRunOptions { actor: string; captureOutput?: boolean; logPrefix: string; signal?: AbortSignal }
export type ProgramRunner = (program: PersonalizationProgram, args: string[], options: ProgramRunOptions) => Promise<number>

interface DatasetPipelineDependencies {
  runProgram?: ProgramRunner
  inspection?: Pick<TrainingDatasetInspection, 'records' | 'sources' | 'cutoff' | 'errors'>
  settings?: TrainingDataSettings
  personaContext?: string
}

export interface PreparePersonalizationDatasetOptions {
  actor: string
  baseModel: string
  captureProgramOutput?: boolean
  datasetPaths: string[]
  logPrefix: string
  maxSamples?: number | null
  modeFilter?: CognitiveMode
  olderSamples?: number
  outputRoot: string
  recentDays?: number
  skipPreprocessing?: boolean
  username: string
  cutoff?: string
  signal?: AbortSignal
}

export interface PreparedPersonalizationDataset {
  datasetBytes: number
  datasetPaths: string[]
  sampleCount: number
  evaluationPaths: string[]
  evaluationCount: number
  manifestPath: string
  datasetId: string
  systemPrompt?: string
}

const tsxPath = path.join(systemPaths.root, 'node_modules', '.bin', 'tsx')
const programPaths: Record<PersonalizationProgram, string> = {
  organizer: path.join(systemPaths.brain, 'agents', 'organizer', 'cli.ts'),
  curator: path.join(systemPaths.brain, 'agents', 'curator', 'cli.ts'),
}

export function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

export function parseCognitiveMode(value: string, name: string): CognitiveMode {
  if (value !== 'dual' && value !== 'emulation' && value !== 'agent' && value !== 'environment') {
    throw new Error(`${name} must be dual, emulation, agent, or environment`)
  }
  return value
}

export async function runPersonalizationProgram(
  program: PersonalizationProgram,
  args: string[],
  options: ProgramRunOptions,
): Promise<number> {
  const programPath = programPaths[program]
  if (!fs.existsSync(programPath)) {
    console.error(`[${options.logPrefix}] Program not found: ${programPath}`)
    return 1
  }
  if (!fs.existsSync(tsxPath)) {
    console.error(`[${options.logPrefix}] tsx executable not found: ${tsxPath}`)
    return 1
  }

  console.log(`[${options.logPrefix}] Running: ${program} ${args.join(' ')}`)

  return new Promise((resolve, reject) => {
    const captureOutput = options.captureOutput === true
    const child = spawn(tsxPath, [programPath, ...args], {
      cwd: systemPaths.root,
      signal: options.signal,
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    })

    let stdout = ''
    let stderr = ''

    if (captureOutput && child.stdout && child.stderr) {
      child.stdout.on('data', data => {
        const text = data.toString()
        stdout += text
        process.stdout.write(`[${program}] ${text}`)
      })
      child.stderr.on('data', data => {
        const text = data.toString()
        stderr += text
        process.stderr.write(`[${program}] ${text}`)
      })
    }

    child.once('error', reject)
    child.once('close', code => {
      const exitCode = code ?? 1
      if (exitCode !== 0) {
        audit({
          level: 'error',
          category: 'action',
          event: `${program}_failed`,
          details: { args, exitCode, stdout, stderr },
          actor: options.actor,
        })
      }
      resolve(exitCode)
    })
  })
}

async function requireSuccessfulProgram(
  program: PersonalizationProgram,
  args: string[],
  options: PreparePersonalizationDatasetOptions,
  runner: ProgramRunner,
): Promise<void> {
  const exitCode = await runner(program, args, {
    actor: options.actor,
    captureOutput: options.captureProgramOutput,
    logPrefix: options.logPrefix,
    signal: options.signal,
  })
  if (exitCode !== 0) {
    throw new Error(`${program} failed with exit code ${exitCode}`)
  }
}

export async function preparePersonalizationDataset(
  options: PreparePersonalizationDatasetOptions,
  dependencies: DatasetPipelineDependencies = {},
): Promise<PreparedPersonalizationDataset> {
  if (!options.username.trim()) throw new Error('username is required')
  options.signal?.throwIfAborted()
  if (!options.baseModel.trim()) throw new Error('baseModel is required')
  if (options.datasetPaths.length === 0) throw new Error('At least one dataset path is required')
  const cutoff = options.cutoff ?? process.env.METAHUMAN_DATASET_CUTOFF ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(cutoff))) throw new Error('Dataset cutoff must be a valid timestamp')
  const manifestPath = path.join(options.outputRoot, 'dataset-manifest.json')
  if (fs.existsSync(manifestPath)) throw new Error('This run already has a frozen dataset; use a new run directory')
  const runProgram = dependencies.runProgram ?? runPersonalizationProgram
  const settings = dependencies.settings ?? readTrainingDataSettings(options.username)
  if (!options.skipPreprocessing) {
    await requireSuccessfulProgram('organizer', ['--username', options.username, '--all', '--limit', '500'], options, runProgram)
    await requireSuccessfulProgram('curator', ['--username', options.username, '--all', '--cutoff', cutoff], options, runProgram)
  }
  const inspection = dependencies.inspection ?? inspectTrainingDataset(options.username, Date.parse(cutoff))
  options.signal?.throwIfAborted()
  if (Date.parse(inspection.cutoff) !== Date.parse(cutoff)) throw new Error('Dataset inspection does not match its source cutoff')
  const systemPrompt = dependencies.personaContext ?? trainingPersonaContext(options.username, settings)
  const selected = selectPersonalizationDataset(inspection, settings, { ...options, personaContext: systemPrompt,
    history: dependencies.inspection ? undefined : readTrainingDatasetHistory(options.username) })
  if (selected.train.length === 0) throw new Error('No eligible training examples for the selected objective and source weights')
  if (selected.evaluation.length === 0) throw new Error('No independent evaluation group is available; collect more reviewed sessions before training')

  // Messages stay unwrapped. The trainer owns exactly one tokenizer template and
  // masks every token except the final assistant continuation.
  const trainingText = selected.train.map(row => JSON.stringify(row)).join('\n') + '\n'
  const evaluationText = selected.evaluation.map(row => JSON.stringify(row)).join('\n') + '\n'
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
  const trainSourceIds = [...new Set(selected.train.flatMap(row => row.metadata.sourceIds))].sort()
  const evaluationSourceIds = [...new Set(selected.evaluation.flatMap(row => row.metadata.sourceIds))].sort()
  if (trainSourceIds.some(id => evaluationSourceIds.includes(id))) throw new Error('Training and evaluation share a source identity')
  const sourceHashes = Object.fromEntries([...selected.train, ...selected.evaluation]
    .flatMap(row => Object.entries(row.metadata.sourceHashes)).sort(([a], [b]) => a.localeCompare(b)))
  const snapshot = {
    version: 2, baseModel: options.baseModel, cutoff: selected.cutoff, settings,
    selection: { maxSamples: options.maxSamples === undefined ? 3000 : options.maxSamples, modeFilter: options.modeFilter ?? null,
      recentDays: options.recentDays ?? 36500, olderSamples: options.olderSamples ?? 0 },
    supervision: 'final-assistant-only',
    systemPrompt: systemPrompt ?? null,
    train: { sha256: sha256(trainingText), count: selected.train.length, sourceIds: trainSourceIds,
      sampleIds: selected.train.map(row => row.id), groups: [...new Set(selected.train.map(row => row.metadata.group))], contentHashes: selected.train.map(trainingSampleContentHash) },
    evaluation: { sha256: sha256(evaluationText), count: selected.evaluation.length, sourceIds: evaluationSourceIds,
      sampleIds: selected.evaluation.map(row => row.id), groups: [...new Set(selected.evaluation.map(row => row.metadata.group))], contentHashes: selected.evaluation.map(trainingSampleContentHash) },
    sourceHashes, excluded: selected.excluded, inspectionErrors: inspection.errors,
  }
  const datasetId = sha256(JSON.stringify(snapshot))
  const evaluationPaths: string[] = []
  const destinations = options.datasetPaths.flatMap(file => [path.resolve(file), path.resolve(file.replace(/\.jsonl$/, '') + '.eval.jsonl')])
  if (new Set(destinations).size !== destinations.length || destinations.some(file => fs.existsSync(file))) {
    throw new Error('Dataset destinations must be distinct, unused paths')
  }
  for (const datasetPath of options.datasetPaths) {
    const evaluationPath = datasetPath.replace(/\.jsonl$/, '') + '.eval.jsonl'
    if (fs.existsSync(datasetPath) || fs.existsSync(evaluationPath)) throw new Error('Dataset output already exists: ' + datasetPath)
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(datasetPath, trainingText, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.writeFileSync(evaluationPath, evaluationText, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    evaluationPaths.push(evaluationPath)
  }
  fs.mkdirSync(options.outputRoot, { recursive: true, mode: 0o700 })
  // The manifest is committed last; an interrupted preparation is never a
  // complete dataset and cannot be submitted to a trainer.
  fs.writeFileSync(manifestPath, JSON.stringify({ ...snapshot, datasetId }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  audit({ category: 'action', level: 'info', event: 'personalization_dataset_prepared', actor: options.actor,
    details: { datasetId, training: selected.train.length, evaluation: selected.evaluation.length, excluded: selected.excluded } })
  return {
    datasetBytes: Buffer.byteLength(trainingText), datasetPaths: [...options.datasetPaths], sampleCount: selected.train.length,
    evaluationPaths, evaluationCount: selected.evaluation.length, manifestPath, datasetId, systemPrompt,
  }
}
