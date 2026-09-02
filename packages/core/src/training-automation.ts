import { inspectTrainingDataset, type TrainingDatasetInspection } from './training-dataset.js'
import { DEFAULT_TRAINING_MODEL } from './model-defaults.js'
import { loadRunpodConfig } from './runpod-config.js'
import {
  readProfileTrainingConfig,
  updateProfileTrainingConfig,
} from './training-config.js'
import {
  trainingLaunchConfigForProfile,
  validateTrainingLaunchConfig,
  type TrainingLaunchConfig,
  type TrainingLaunchRequest,
  type TrainingMethod,
  type TrainingTarget,
} from './training-launch.js'
import { listTrainingProcesses, type TrackedTrainingProcess } from './training-process.js'

export interface AutomaticTrainingConfig {
  version: 1
  enabled: boolean
  method: TrainingMethod
  trainingTarget: TrainingTarget
  minimumTrainableSamples: number
  minimumNewSamples: number
  cooldownHours: number
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
  enablePreprocessing: boolean
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
    triggerInstalled: false
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
  baseModel: DEFAULT_TRAINING_MODEL,
  epochs: 5,
  maxSamples: 3000,
  useRollingWindow: false,
  recentDays: 30,
  olderSamples: 3000,
  loraRank: 16,
  loraAlpha: 32,
  learningRate: 0.0003,
  batchSize: 1,
  gradientAccumulationSteps: 16,
  maxSequenceLength: 2048,
  quantization: 'Q4_K_M',
  runpodTemplateId: 'metahuman-runpod-trainer',
  runpodGpuType: 'NVIDIA H100 PCIe',
  enablePreprocessing: true,
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
  if (candidate.trainingTarget === 'vllm' && candidate.method !== 'remote-lora') {
    throw new Error('vLLM artifacts require remote LoRA training')
  }
  const method = candidate.method as TrainingMethod
  const trainingTarget = candidate.trainingTarget as TrainingTarget
  const trainingConfig = trainingConfigFromAutomatic(candidate, trainingTarget)
  if (method !== 'fine-tune' && (trainingConfig.lora_rank < 1 || trainingConfig.lora_alpha < 1)) {
    throw new Error('LoRA training requires loraRank and loraAlpha to be at least 1')
  }
  if (typeof candidate.useRollingWindow !== 'boolean') throw new Error('useRollingWindow must be a boolean')
  if (typeof candidate.enablePreprocessing !== 'boolean') throw new Error('enablePreprocessing must be a boolean')
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
    enablePreprocessing: candidate.enablePreprocessing,
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
  inspection: TrainingDatasetInspection,
  runs: AutomaticTrainingRun[],
  runningProcesses: TrackedTrainingProcess[],
  remoteCredentialsConfigured: boolean,
  now = Date.now(),
): AutomaticTrainingReadiness {
  const completedRuns = runs
    .filter(run => run.status === 'completed')
    .sort((left, right) => Date.parse(right.endTime || right.startTime) - Date.parse(left.endTime || left.startTime))
  const lastCompleted = completedRuns[0]
  const lastCompletedAt = lastCompleted?.endTime || lastCompleted?.startTime || null
  const lastCompletedTime = lastCompletedAt ? Date.parse(lastCompletedAt) : Number.NaN
  const newSamplesSinceLastRun = Number.isFinite(lastCompletedTime)
    ? inspection.trainableCuratedAt.filter(timestamp => Date.parse(timestamp) > lastCompletedTime).length
    : inspection.stats.trainableSamples
  const cooldownEndsAt = Number.isFinite(lastCompletedTime)
    ? new Date(lastCompletedTime + config.cooldownHours * 60 * 60 * 1000).toISOString()
    : null
  const runningProcess = runningProcesses[0] ?? null
  const blockers: string[] = []

  if (!config.enabled) blockers.push('Automatic training is disabled')
  if (runningProcess) blockers.push(`${runningProcess.name} is already running`)
  if (inspection.stats.pendingOrganization > 0) {
    blockers.push(`${inspection.stats.pendingOrganization} episodic memories still need organization`)
  }
  if (inspection.stats.pendingCuration > 0) {
    blockers.push(`${inspection.stats.pendingCuration} episodic memories still need Curator review`)
  }
  if (inspection.stats.invalidCuratedRecords > 0) {
    blockers.push(`${inspection.stats.invalidCuratedRecords} Curator records fail the current training contract`)
  }
  if (inspection.stats.trainableSamples < config.minimumTrainableSamples) {
    blockers.push(`Need ${config.minimumTrainableSamples - inspection.stats.trainableSamples} more validated training samples`)
  }
  if (lastCompleted && newSamplesSinceLastRun < config.minimumNewSamples) {
    blockers.push(`Need ${config.minimumNewSamples - newSamplesSinceLastRun} more new samples since the last completed run`)
  }
  if (cooldownEndsAt && now < Date.parse(cooldownEndsAt)) {
    blockers.push(`Cooldown remains active until ${cooldownEndsAt}`)
  }
  if ((config.method === 'remote-lora' || config.method === 'fine-tune') && !remoteCredentialsConfigured) {
    blockers.push('Complete RunPod credentials are required for the selected method')
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    trainableSamples: inspection.stats.trainableSamples,
    newSamplesSinceLastRun,
    lastCompletedAt,
    cooldownEndsAt,
    runningProcess,
    remoteCredentialsConfigured,
  }
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
      enablePreprocessing: config.enablePreprocessing,
      enableS3Upload: config.enableS3Upload,
    },
  }
}

export function automaticTrainingRuntimeInputs(username: string): {
  config: AutomaticTrainingConfig
  inspection: TrainingDatasetInspection
  runningProcesses: TrackedTrainingProcess[]
  remoteCredentialsConfigured: boolean
} {
  const config = readAutomaticTrainingConfig(username)
  const runpod = loadRunpodConfig(username)
  return {
    config,
    inspection: inspectTrainingDataset(username),
    runningProcesses: listTrainingProcesses(),
    remoteCredentialsConfigured: Boolean(runpod.apiKey),
  }
}
