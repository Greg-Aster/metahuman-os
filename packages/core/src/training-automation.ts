import { inspectTrainingDataset, selectPersonalizationDataset, trainingPersonaContext, readTrainingDatasetHistory, type TrainingDatasetInspection, type SelectedPersonalizationDataset, type TrainingDatasetHistory } from './training-dataset.js'
import { readSleepRuntimeState } from './sleep-runtime.js'
import { DEFAULT_TRAINING_MODEL } from './model-defaults.js'
import { loadRunpodConfig } from './runpod-config.js'
import {
  readTrainingDataSettings,
  readProfileTrainingConfig,
  updateProfileTrainingConfig,
} from './training-config.js'
import {
  trainingLaunchConfigForProfile, launchTrainingJob, waitForTrainingJob,
  validateTrainingLaunchConfig,
  type TrainingLaunchConfig,
  type TrainingLaunchRequest,
  type TrainingMethod,
  type TrainingTarget,
} from './training-launch.js'
import { listTrainingProcesses, readTrainingHistoryForUser, type TrackedTrainingProcess } from './training-process.js'

export interface AutomaticTrainingConfig {
  version: 1
  enabled: boolean
  method: TrainingMethod
  trainingTarget: TrainingTarget
  minimumTrainableSamples: number
  minimumNewSamples: number
  cooldownHours: number
  maxRuntimeMinutes: number
  baseModel: string
  epochs: number
  maxSamples: number | null
  useRollingWindow: boolean
  recentDays: number
  olderSamples: number
  loraRank: number
  loraAlpha: number
  learningRate: number
  batchSize: number
  gradientAccumulationSteps: number
  maxSequenceLength: number
  quantization: string
  runpodTemplateId: string
  runpodGpuType: string
  enableS3Upload: boolean
  updatedAt?: string
}

export interface AutomaticTrainingReadiness {
  eligible: boolean
  blockers: string[]
  trainableSamples: number
  newSamplesSinceLastRun: number
  lastCompletedAt: string | null
  cooldownEndsAt: string | null
  runningProcess: TrackedTrainingProcess | null
  remoteCredentialsConfigured: boolean
}

export interface AutomaticTrainingRun {
  startTime: string
  endTime?: string
  status: 'completed' | 'failed' | 'cancelled' | 'incomplete'
}

export interface AutomaticTrainingStatus {
  config: AutomaticTrainingConfig
  readiness: AutomaticTrainingReadiness
  dataset: TrainingDatasetInspection['stats']
  integration: {
    owner: 'sleep-workflow'
    triggerInstalled: true
    message: string
  }
}

export const DEFAULT_AUTOMATIC_TRAINING_CONFIG: AutomaticTrainingConfig = {
  version: 1,
  enabled: false,
  method: 'local-lora',
  trainingTarget: 'ollama',
  minimumTrainableSamples: 250,
  minimumNewSamples: 50,
  cooldownHours: 168,
  maxRuntimeMinutes: 180,
  baseModel: DEFAULT_TRAINING_MODEL,
  epochs: 1,
  maxSamples: 3000,
  useRollingWindow: false,
  recentDays: 30,
  olderSamples: 3000,
  loraRank: 16,
  loraAlpha: 32,
  learningRate: 0.0001,
  batchSize: 1,
  gradientAccumulationSteps: 16,
  maxSequenceLength: 2048,
  quantization: 'Q4_K_M',
  runpodTemplateId: 'metahuman-runpod-trainer',
  runpodGpuType: 'NVIDIA H100 PCIe',
  enableS3Upload: false,
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function requireString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new Error(`${field} must be a non-empty string no longer than ${maximumLength} characters`)
  }
  return value.trim()
}

function trainingConfigFromAutomatic(
  candidate: AutomaticTrainingConfig | Record<string, unknown>,
  trainingTarget: TrainingTarget,
): TrainingLaunchConfig {
  const trainingConfig = {
    base_model: candidate.baseModel,
    num_train_epochs: candidate.epochs,
    max_samples: candidate.maxSamples,
    monthly_training: candidate.useRollingWindow,
    days_recent: candidate.recentDays,
    old_samples: candidate.olderSamples,
    lora_rank: candidate.loraRank,
    lora_alpha: candidate.loraAlpha,
    learning_rate: candidate.learningRate,
    per_device_train_batch_size: candidate.batchSize,
    gradient_accumulation_steps: candidate.gradientAccumulationSteps,
    max_seq_length: candidate.maxSequenceLength,
    quantization: candidate.quantization,
    skipGguf: trainingTarget === 'vllm',
  } as TrainingLaunchConfig
  const error = validateTrainingLaunchConfig(trainingConfig)
  if (error) throw new Error(error)
  return trainingConfig
}

function automaticDefaultsForProfile(username: string): AutomaticTrainingConfig {
  const launchConfig = trainingLaunchConfigForProfile(username)
  const runpod = loadRunpodConfig(username)
  return {
    ...DEFAULT_AUTOMATIC_TRAINING_CONFIG,
    baseModel: launchConfig.base_model,
    epochs: launchConfig.num_train_epochs,
    maxSamples: launchConfig.max_samples,
    useRollingWindow: launchConfig.monthly_training ?? false,
    recentDays: launchConfig.days_recent ?? DEFAULT_AUTOMATIC_TRAINING_CONFIG.recentDays,
    olderSamples: launchConfig.old_samples ?? DEFAULT_AUTOMATIC_TRAINING_CONFIG.olderSamples,
    loraRank: launchConfig.lora_rank,
    loraAlpha: launchConfig.lora_alpha,
    learningRate: launchConfig.learning_rate,
    batchSize: launchConfig.per_device_train_batch_size,
    gradientAccumulationSteps: launchConfig.gradient_accumulation_steps,
    maxSequenceLength: launchConfig.max_seq_length,
    quantization: launchConfig.quantization,
    runpodTemplateId: runpod.templateId ?? DEFAULT_AUTOMATIC_TRAINING_CONFIG.runpodTemplateId,
    runpodGpuType: runpod.gpuType ?? DEFAULT_AUTOMATIC_TRAINING_CONFIG.runpodGpuType,
  }
}

export function parseAutomaticTrainingConfig(
  value: unknown,
  defaults: AutomaticTrainingConfig = DEFAULT_AUTOMATIC_TRAINING_CONFIG,
): AutomaticTrainingConfig {
  if (value === undefined) return { ...defaults }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('automatic training configuration must be an object')
  }

  const candidate: Record<string, unknown> = {
    ...defaults,
    ...(value as Record<string, unknown>),
  }
  if (candidate.version !== 1) throw new Error('automatic training configuration version must be 1')
  if (typeof candidate.enabled !== 'boolean') throw new Error('enabled must be a boolean')
  if (candidate.method !== 'local-lora' && candidate.method !== 'remote-lora' && candidate.method !== 'fine-tune') {
    throw new Error('method must be local-lora, remote-lora, or fine-tune')
  }
  if (candidate.trainingTarget !== 'ollama' && candidate.trainingTarget !== 'vllm') {
    throw new Error('trainingTarget must be ollama or vllm')
  }
  const method = candidate.method as TrainingMethod
  const trainingTarget = candidate.trainingTarget as TrainingTarget
  const trainingConfig = trainingConfigFromAutomatic(candidate, trainingTarget)
  if (method !== 'fine-tune' && (trainingConfig.lora_rank < 1 || trainingConfig.lora_alpha < 1)) {
    throw new Error('LoRA training requires loraRank and loraAlpha to be at least 1')
  }
  if (typeof candidate.useRollingWindow !== 'boolean') throw new Error('useRollingWindow must be a boolean')
  if (typeof candidate.enableS3Upload !== 'boolean') throw new Error('enableS3Upload must be a boolean')
  if (candidate.updatedAt !== undefined && (
    typeof candidate.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(candidate.updatedAt))
  )) {
    throw new Error('updatedAt must be an ISO timestamp')
  }

  return {
    version: 1,
    enabled: candidate.enabled,
    method,
    trainingTarget,
    minimumTrainableSamples: requireInteger(candidate.minimumTrainableSamples, 'minimumTrainableSamples', 1, 1_000_000),
    minimumNewSamples: requireInteger(candidate.minimumNewSamples, 'minimumNewSamples', 1, 1_000_000),
    cooldownHours: requireInteger(candidate.cooldownHours, 'cooldownHours', 1, 8760),
    maxRuntimeMinutes: requireInteger(candidate.maxRuntimeMinutes, 'maxRuntimeMinutes', 1, 720),
    baseModel: trainingConfig.base_model,
    epochs: trainingConfig.num_train_epochs,
    maxSamples: trainingConfig.max_samples,
    useRollingWindow: candidate.useRollingWindow,
    recentDays: requireInteger(candidate.recentDays, 'recentDays', 1, 36_500),
    olderSamples: requireInteger(candidate.olderSamples, 'olderSamples', 0, 1_000_000),
    loraRank: trainingConfig.lora_rank,
    loraAlpha: trainingConfig.lora_alpha,
    learningRate: trainingConfig.learning_rate,
    batchSize: trainingConfig.per_device_train_batch_size,
    gradientAccumulationSteps: trainingConfig.gradient_accumulation_steps,
    maxSequenceLength: trainingConfig.max_seq_length,
    quantization: trainingConfig.quantization,
    runpodTemplateId: requireString(candidate.runpodTemplateId, 'runpodTemplateId', 300),
    runpodGpuType: requireString(candidate.runpodGpuType, 'runpodGpuType', 300),
    enableS3Upload: candidate.enableS3Upload,
    ...(candidate.updatedAt ? { updatedAt: candidate.updatedAt } : {}),
  }
}

export function readAutomaticTrainingConfig(username: string): AutomaticTrainingConfig {
  return parseAutomaticTrainingConfig(
    readProfileTrainingConfig(username).automatic,
    automaticDefaultsForProfile(username),
  )
}

export function saveAutomaticTrainingConfig(
  username: string,
  value: unknown,
  now = new Date(),
): AutomaticTrainingConfig {
  const parsed = parseAutomaticTrainingConfig(value, automaticDefaultsForProfile(username))
  const config = { ...parsed, updatedAt: now.toISOString() }
  updateProfileTrainingConfig(username, { automatic: config })
  return config
}

export function evaluateAutomaticTrainingReadiness(
  config: AutomaticTrainingConfig,
  selection: { train: ReadonlyArray<{ id: string }>; evaluation: ReadonlyArray<{ id: string }> },
  runs: AutomaticTrainingRun[],
  runningProcesses: TrackedTrainingProcess[],
  remoteCredentialsConfigured: boolean,
  now = Date.now(),
  history: TrainingDatasetHistory = { assignments: {}, completedSampleIds: [] },
): AutomaticTrainingReadiness {
  const ordered = [...runs].sort((a, b) => Date.parse(b.endTime || b.startTime) - Date.parse(a.endTime || a.startTime))
  const lastCompleted = ordered.find(run => run.status === 'completed')
  const lastCompletedAt = lastCompleted?.endTime || lastCompleted?.startTime || null
  const previousSamples = new Set(history.completedSampleIds)
  const newSamplesSinceLastRun = selection.train.filter(row => !previousSamples.has(row.id)).length
  // Failed attempts also consume the cooldown; unavailable infrastructure must not cause nightly retry storms.
  const lastAttempt = ordered[0]
  const cooldownEndsAt = lastAttempt ? new Date(Date.parse(lastAttempt.endTime || lastAttempt.startTime) + config.cooldownHours * 3_600_000).toISOString() : null
  const runningProcess = runningProcesses[0] ?? null
  const blockers: string[] = []
  if (!config.enabled) blockers.push('Automatic training is disabled')
  if (runningProcess) blockers.push(runningProcess.name + ' is already running')
  if (selection.train.length < config.minimumTrainableSamples) blockers.push('Need ' + (config.minimumTrainableSamples - selection.train.length) + ' more eligible training samples')
  if (!selection.evaluation.length) blockers.push('An independent evaluation group is required')
  if (newSamplesSinceLastRun < config.minimumNewSamples) blockers.push('Need ' + (config.minimumNewSamples - newSamplesSinceLastRun) + ' more new samples')
  if (cooldownEndsAt && now < Date.parse(cooldownEndsAt)) blockers.push('Cooldown remains active until ' + cooldownEndsAt)
  if (config.method !== 'local-lora' && !remoteCredentialsConfigured) blockers.push('Complete RunPod credentials are required for the selected method')
  return { eligible: blockers.length === 0, blockers, trainableSamples: selection.train.length,
    newSamplesSinceLastRun, lastCompletedAt, cooldownEndsAt, runningProcess, remoteCredentialsConfigured }
}

export function automaticTrainingLaunchRequest(
  username: string,
  config = readAutomaticTrainingConfig(username),
): TrainingLaunchRequest {
  const savedRunpod = loadRunpodConfig(username)
  const runpodConfig = config.method !== 'local-lora' && savedRunpod.apiKey
    ? {
        apiKey: savedRunpod.apiKey,
        templateId: config.runpodTemplateId,
        gpuType: config.runpodGpuType,
      }
    : undefined
  return {
    method: config.method,
    trainingTarget: config.trainingTarget,
    ...(runpodConfig ? { runpodConfig } : {}),
    trainingConfig: trainingConfigFromAutomatic(config, config.trainingTarget),
    advancedSettings: {
      enablePreprocessing: false, // Sleep already completed the canonical refinement stages.
      enableS3Upload: config.enableS3Upload,
    },
  }
}

export function automaticTrainingRuntimeInputs(username: string, cutoff = Date.now()) {
  const config = readAutomaticTrainingConfig(username)
  const inspection = inspectTrainingDataset(username, cutoff)
  const settings = readTrainingDataSettings(username)
  const history = readTrainingDatasetHistory(username)
  const selection = selectPersonalizationDataset(inspection, settings, {
    maxSamples: config.maxSamples, recentDays: config.useRollingWindow ? config.recentDays : undefined,
    olderSamples: config.useRollingWindow ? config.olderSamples : undefined,
    personaContext: trainingPersonaContext(username, settings), history,
  })
  return { config, inspection, selection, history, runs: readTrainingHistoryForUser(username),
    runningProcesses: listTrainingProcesses(), remoteCredentialsConfigured: Boolean(loadRunpodConfig(username).apiKey) }
}

export function getAutomaticTrainingStatus(username: string, cutoff = Date.now()): AutomaticTrainingStatus {
  const input = automaticTrainingRuntimeInputs(username, cutoff)
  return {
    config: input.config, dataset: input.inspection.stats,
    readiness: evaluateAutomaticTrainingReadiness(input.config, input.selection, input.runs, input.runningProcesses, input.remoteCredentialsConfigured, Date.now(), input.history),
    integration: { owner: 'sleep-workflow', triggerInstalled: true,
      message: 'Sleep runs one bounded training job after successful Organizer and Curator stages. New activity cancels the job. Candidates require review before activation.' },
  }
}

/** Only the active, prerequisite-complete Sleep stage may request automatic admission. */
export async function runAutomaticTrainingForSleep(username: string, sessionId: string, signal: AbortSignal,
  dependencies: {
    runtime?: typeof automaticTrainingRuntimeInputs
    sleep?: typeof readSleepRuntimeState
    launch?: typeof launchTrainingJob
    wait?: typeof waitForTrainingJob
    now?: () => number
  } = {},
): Promise<Record<string, unknown>> {
  const session = (dependencies.sleep ?? readSleepRuntimeState)().currentSession
  if (!session || session.id !== sessionId || session.username !== username || session.state !== 'running'
      || session.currentStageId !== 'train-personalization') throw new Error('Automatic training requires its active Sleep stage')
  if (['organize-memory', 'curate-memory'].some(id => session.stages.find(stage => stage.id === id)?.state !== 'completed')) {
    return { skipped: true, reason: 'Organizer and Curator must complete successfully before automatic training' }
  }
  signal.throwIfAborted()
  const now = (dependencies.now ?? Date.now)()
  const input = (dependencies.runtime ?? automaticTrainingRuntimeInputs)(username, Date.parse(session.startedAt))
  const readiness = evaluateAutomaticTrainingReadiness(input.config, input.selection, input.runs, input.runningProcesses, input.remoteCredentialsConfigured, now, input.history)
  if (!readiness.eligible) return { skipped: true, reason: readiness.blockers.join('; '), readiness }
  const automatic = { sessionId, cutoff: session.startedAt, deadline: new Date(now + input.config.maxRuntimeMinutes * 60_000).toISOString() }
  const launched = (dependencies.launch ?? launchTrainingJob)(username, automaticTrainingLaunchRequest(username, input.config), automatic)
  if (!launched.success) throw new Error(launched.error)
  await (dependencies.wait ?? waitForTrainingJob)(username, launched.pid, launched.runLabel, signal)
  return { trained: true, runLabel: launched.runLabel, activation: 'review-required' }
}
