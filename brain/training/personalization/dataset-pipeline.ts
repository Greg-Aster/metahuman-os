import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { audit, systemPaths } from '@metahuman/core'
import { applySchemaBatch } from '@metahuman/core/schema-manager'
import type {
  CognitiveMode,
  FormattedSample,
  SchemaAppliedSample,
} from '@metahuman/core/schema-manager'

export type PersonalizationProgram =
  | 'organizer'
  | 'curator'
  | 'curated-aggregator'
  | 'mode-formatter'
  | 'training-exporter'

export interface ProgramRunOptions {
  actor: string
  captureOutput?: boolean
  logPrefix: string
}

export type ProgramRunner = (
  program: PersonalizationProgram,
  args: string[],
  options: ProgramRunOptions,
) => Promise<number>

interface DatasetPipelineDependencies {
  applySchema?: (
    samples: FormattedSample[],
    baseModel: string,
  ) => SchemaAppliedSample[]
  runProgram?: ProgramRunner
}

export interface PreparePersonalizationDatasetOptions {
  actor: string
  baseModel: string
  captureProgramOutput?: boolean
  datasetPaths: string[]
  format: 'input-output' | 'instruction'
  logPrefix: string
  maxSamples?: number
  modeFilter?: CognitiveMode
  olderSamples?: number
  outputRoot: string
  recentDays?: number
  skipPreprocessing?: boolean
  skipValidation?: boolean
  username: string
}

export interface PreparedPersonalizationDataset {
  datasetBytes: number
  datasetPaths: string[]
  sampleCount: number
}

const personalizationRoot = path.dirname(fileURLToPath(import.meta.url))
const tsxPath = path.join(systemPaths.root, 'node_modules', '.bin', 'tsx')

const programPaths: Record<PersonalizationProgram, string> = {
  organizer: path.join(systemPaths.brain, 'agents', 'organizer', 'cli.ts'),
  curator: path.join(systemPaths.brain, 'agents', 'curator', 'cli.ts'),
  'curated-aggregator': path.join(personalizationRoot, 'curated-aggregator.ts'),
  'mode-formatter': path.join(personalizationRoot, 'mode-formatter.ts'),
  'training-exporter': path.join(personalizationRoot, 'training-exporter.ts'),
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
  })
  if (exitCode !== 0) {
    throw new Error(`${program} failed with exit code ${exitCode}`)
  }
}

function readFormattedSamples(formattedPath: string): FormattedSample[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(formattedPath, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Personalization dataset preparation produced no formatted samples')
  }
  return parsed as FormattedSample[]
}

export async function preparePersonalizationDataset(
  options: PreparePersonalizationDatasetOptions,
  dependencies: DatasetPipelineDependencies = {},
): Promise<PreparedPersonalizationDataset> {
  if (!options.username.trim()) throw new Error('username is required')
  if (!options.baseModel.trim()) throw new Error('baseModel is required')
  if (options.datasetPaths.length === 0) throw new Error('At least one dataset path is required')
  if (options.maxSamples !== undefined && (!Number.isSafeInteger(options.maxSamples) || options.maxSamples <= 0)) {
    throw new Error('maxSamples must be a positive integer')
  }
  if (options.recentDays !== undefined && (
    !Number.isSafeInteger(options.recentDays)
    || options.recentDays < 1
    || options.recentDays > 36_500
  )) {
    throw new Error('recentDays must be an integer from 1 to 36500')
  }
  if (options.olderSamples !== undefined && (
    !Number.isSafeInteger(options.olderSamples)
    || options.olderSamples < 0
    || options.olderSamples > 1_000_000
  )) {
    throw new Error('olderSamples must be an integer from 0 to 1000000')
  }

  const runProgram = dependencies.runProgram ?? runPersonalizationProgram
  const applySchema = dependencies.applySchema ?? applySchemaBatch
  const curatedPath = path.join(options.outputRoot, 'curated_memories.json')
  const formattedPath = path.join(options.outputRoot, 'formatted_samples.json')
  const schemaPath = path.join(options.outputRoot, 'schema_applied.json')

  fs.mkdirSync(options.outputRoot, { recursive: true })

  if (options.skipPreprocessing) {
    console.log(`[${options.logPrefix}] Memory refinement skipped; using the existing Curator store`)
  } else {
    await requireSuccessfulProgram(
      'organizer',
      ['--username', options.username, '--all', '--limit', '500'],
      options,
      runProgram,
    )
    await requireSuccessfulProgram(
      'curator',
      ['--username', options.username, '--all'],
      options,
      runProgram,
    )
  }

  const aggregatorArgs = [
    '--username', options.username,
    '--output', curatedPath,
  ]
  if (options.maxSamples !== undefined) {
    aggregatorArgs.push('--max', String(options.maxSamples))
  }
  if (options.modeFilter) {
    aggregatorArgs.push('--mode', options.modeFilter)
  }
  if (options.recentDays !== undefined) {
    aggregatorArgs.push('--days-recent', String(options.recentDays))
  }
  if (options.olderSamples !== undefined) {
    aggregatorArgs.push('--old-samples', String(options.olderSamples))
  }
  await requireSuccessfulProgram('curated-aggregator', aggregatorArgs, options, runProgram)

  await requireSuccessfulProgram(
    'mode-formatter',
    ['--input', curatedPath, '--output', formattedPath],
    options,
    runProgram,
  )

  console.log(`[${options.logPrefix}] Applying schema for base model: ${options.baseModel}`)
  const schemaAppliedSamples = applySchema(readFormattedSamples(formattedPath), options.baseModel)
  if (schemaAppliedSamples.length === 0) {
    throw new Error('Personalization schema application produced no samples')
  }
  fs.writeFileSync(schemaPath, JSON.stringify(schemaAppliedSamples, null, 2))

  if (options.format === 'input-output') {
    if (options.datasetPaths.length !== 1) {
      throw new Error('input-output datasets require exactly one output path')
    }
    const exporterArgs = ['--input', schemaPath, '--output', options.datasetPaths[0]!]
    if (options.skipValidation) exporterArgs.push('--skip-validation')
    await requireSuccessfulProgram('training-exporter', exporterArgs, options, runProgram)
  } else {
    const jsonl = schemaAppliedSamples
      .map(sample => JSON.stringify({
        instruction: sample.input,
        input: '',
        output: sample.output,
      }))
      .join('\n')

    for (const datasetPath of options.datasetPaths) {
      fs.mkdirSync(path.dirname(datasetPath), { recursive: true })
      fs.writeFileSync(datasetPath, jsonl)
    }
  }

  const primaryDatasetPath = options.datasetPaths[0]!
  const datasetBytes = fs.statSync(primaryDatasetPath).size
  const sampleCount = fs.readFileSync(primaryDatasetPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .length
  if (sampleCount !== schemaAppliedSamples.length) {
    throw new Error(`Dataset record count ${sampleCount} does not match schema sample count ${schemaAppliedSamples.length}`)
  }

  return {
    datasetBytes,
    datasetPaths: [...options.datasetPaths],
    sampleCount,
  }
}
