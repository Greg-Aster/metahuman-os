import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { audit } from './audit.js'
import { getProfilePaths } from './path-builder.js'
import { systemPaths } from './paths.js'
import { safeWriteJSON } from './safe-file.js'
import {
  readProfileTrainingConfig,
  updateProfileTrainingConfig,
} from './training-config.js'
import {
  listTrainingProcesses,
  releaseTrainingProcess,
  trackTrainingProcess,
  type TrainingProcessName,
} from './training-process.js'

export type TrainingMethod = 'local-lora' | 'remote-lora' | 'fine-tune'
export type TrainingTarget = 'ollama' | 'vllm'

export interface TrainingRunpodConfig {
  apiKey: string
  templateId: string
  gpuType: string
}

export interface TrainingLaunchConfig {
  base_model: string
  num_train_epochs: number
  max_samples: number | null
  monthly_training?: boolean
  days_recent?: number
  old_samples?: number
  lora_rank: number
  lora_alpha: number
  learning_rate: number
  per_device_train_batch_size: number
  gradient_accumulation_steps: number
  max_seq_length: number
  quantization: string
  skipGguf?: boolean
}

export interface TrainingLaunchRequest {
  method: TrainingMethod
  trainingTarget?: TrainingTarget
  runpodConfig?: TrainingRunpodConfig
  trainingConfig: TrainingLaunchConfig
  advancedSettings?: {
    enableS3Upload: boolean
    enablePreprocessing: boolean
  }
}

export type TrainingLaunchResult = {
  success: true
  status: 200
  pid: number
  agentName: TrainingProcessName
  message: string
} | {
  success: false
  status: 400 | 409 | 500
  error: string
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateTrainingLaunchConfig(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Training configuration is required'
  }

  const config = value as Record<string, unknown>
  if (!nonEmptyString(config.base_model) || config.base_model.length > 300) {
    return 'base_model must be a non-empty model identifier'
  }

  const positiveIntegers: Array<[string, number, number]> = [
    ['num_train_epochs', 1, 50],
    ['per_device_train_batch_size', 1, 128],
    ['gradient_accumulation_steps', 1, 1024],
    ['max_seq_length', 128, 262_144],
  ]
  for (const [field, minimum, maximum] of positiveIntegers) {
    const candidate = config[field]
    if (!Number.isInteger(candidate) || (candidate as number) < minimum || (candidate as number) > maximum) {
      return `${field} must be an integer from ${minimum} to ${maximum}`
    }
  }

  if (config.max_samples !== null && (
    !Number.isInteger(config.max_samples)
    || (config.max_samples as number) < 1
    || (config.max_samples as number) > 1_000_000
  )) {
    return 'max_samples must be null or an integer from 1 to 1000000'
  }
  if (!Number.isInteger(config.lora_rank) || (config.lora_rank as number) < 0 || (config.lora_rank as number) > 1024) {
    return 'lora_rank must be an integer from 0 to 1024'
  }
  if (!Number.isInteger(config.lora_alpha) || (config.lora_alpha as number) < 0 || (config.lora_alpha as number) > 4096) {
    return 'lora_alpha must be an integer from 0 to 4096'
  }
  if (typeof config.learning_rate !== 'number' || !Number.isFinite(config.learning_rate) || config.learning_rate <= 0 || config.learning_rate > 1) {
    return 'learning_rate must be greater than 0 and no more than 1'
  }
  if (!nonEmptyString(config.quantization) || !/^[A-Za-z0-9_.-]{1,32}$/.test(config.quantization)) {
    return 'quantization is invalid'
  }
  if (config.skipGguf !== undefined && typeof config.skipGguf !== 'boolean') {
    return 'skipGguf must be a boolean'
  }
  if (config.monthly_training !== undefined && typeof config.monthly_training !== 'boolean') {
    return 'monthly_training must be a boolean'
  }
  if (config.days_recent !== undefined && (
    !Number.isInteger(config.days_recent)
    || (config.days_recent as number) < 1
    || (config.days_recent as number) > 36_500
  )) {
    return 'days_recent must be an integer from 1 to 36500'
  }
  if (config.old_samples !== undefined && (
    !Number.isInteger(config.old_samples)
    || (config.old_samples as number) < 0
    || (config.old_samples as number) > 1_000_000
  )) {
    return 'old_samples must be an integer from 0 to 1000000'
  }

  return null
}

export function validateTrainingLaunchRequest(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Training launch request is required'
  const request = value as Record<string, unknown>
  const method = request.method
  const trainingTarget = request.trainingTarget ?? 'ollama'

  if (method !== 'local-lora' && method !== 'remote-lora' && method !== 'fine-tune') {
    return `Invalid training method: ${String(method)}`
  }
  if (trainingTarget !== 'ollama' && trainingTarget !== 'vllm') {
    return `Invalid training target: ${String(trainingTarget)}`
  }
  if (trainingTarget === 'vllm' && method !== 'remote-lora') {
    return 'vLLM artifacts require remote LoRA training'
  }

  const configError = validateTrainingLaunchConfig(request.trainingConfig)
  if (configError) return configError

  if (method === 'remote-lora' || method === 'fine-tune') {
    const runpod = request.runpodConfig
    if (!runpod || typeof runpod !== 'object' || Array.isArray(runpod)) {
      return 'Complete RunPod configuration is required'
    }
    const candidate = runpod as Record<string, unknown>
    if (!nonEmptyString(candidate.apiKey) || !nonEmptyString(candidate.templateId) || !nonEmptyString(candidate.gpuType)) {
      return 'Complete RunPod configuration is required'
    }
  }

  return null
}

export function trainingLaunchConfigForProfile(
  username: string,
  overrides: Partial<TrainingLaunchConfig> = {},
): TrainingLaunchConfig {
  const effective = { ...readProfileTrainingConfig(username), ...overrides }
  const selected: TrainingLaunchConfig = {
    base_model: effective.base_model as string,
    num_train_epochs: effective.num_train_epochs as number,
    max_samples: effective.max_samples as number | null,
    monthly_training: effective.monthly_training as boolean | undefined,
    days_recent: effective.days_recent as number | undefined,
    old_samples: effective.old_samples as number | undefined,
    lora_rank: effective.lora_rank as number,
    lora_alpha: effective.lora_alpha as number,
    learning_rate: effective.learning_rate as number,
    per_device_train_batch_size: effective.per_device_train_batch_size as number,
    gradient_accumulation_steps: effective.gradient_accumulation_steps as number,
    max_seq_length: effective.max_seq_length as number,
    quantization: effective.quantization as string,
    skipGguf: effective.skipGguf as boolean | undefined,
  }
  const error = validateTrainingLaunchConfig(selected)
  if (error) throw new Error(`Profile training configuration is not launchable: ${error}`)
  return selected
}

export function buildTrainingEnvironmentOverrides(
  request: TrainingLaunchRequest,
  includePersona: boolean,
): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {
    METAHUMAN_INCLUDE_PERSONA: includePersona ? '1' : '0',
    METAHUMAN_BASE_MODEL: request.trainingConfig.base_model,
    METAHUMAN_MAX_SAMPLES: request.trainingConfig.max_samples === null
      ? ''
      : String(request.trainingConfig.max_samples),
    METAHUMAN_DISABLE_S3: request.advancedSettings?.enableS3Upload === false ? '1' : '0',
    METAHUMAN_SKIP_PREPROCESSING: request.advancedSettings?.enablePreprocessing === false ? '1' : '0',
  }
  if (request.runpodConfig) {
    overrides.RUNPOD_GPU_TYPE = request.runpodConfig.gpuType
    overrides.RUNPOD_API_KEY = request.runpodConfig.apiKey
    overrides.RUNPOD_TEMPLATE_ID = request.runpodConfig.templateId
  }
  return overrides
}

function terminateDetachedProcess(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}

/**
 * The one process-admission owner used by manual training now and Sleep-triggered
 * automatic training in the next phase.
 */
export function launchTrainingJob(username: string, request: TrainingLaunchRequest): TrainingLaunchResult {
  const requestError = validateTrainingLaunchRequest(request)
  if (requestError) return { success: false, status: 400, error: requestError }

  const method = request.method
  const trainingTarget = request.trainingTarget ?? 'ollama'
  const launchConfig = request.trainingConfig
  const runpodConfig = request.runpodConfig

  const [running] = listTrainingProcesses()
  if (running) {
    return {
      success: false,
      status: 409,
      error: `${running.name} is already running with PID ${running.pid}`,
    }
  }

  const agentMap: Record<TrainingMethod, string> = {
    'local-lora': 'full-cycle-local.ts',
    'remote-lora': 'full-cycle.ts',
    'fine-tune': 'fine-tune-cycle.ts',
  }
  const agentFileName = agentMap[method]
  const agentPath = path.join(systemPaths.brain, 'training', 'personalization', agentFileName)
  if (!fs.existsSync(agentPath)) {
    return { success: false, status: 500, error: `Training agent not found: ${agentFileName}` }
  }

  const tsxPath = path.join(systemPaths.root, 'node_modules', '.bin', 'tsx')
  if (!fs.existsSync(tsxPath)) {
    return { success: false, status: 500, error: 'Training runtime is not installed' }
  }

  const profilePaths = getProfilePaths(username)
  const shouldConvertToGguf = trainingTarget !== 'vllm' && !launchConfig.skipGguf
  const { monthly_training, days_recent, old_samples, ...sharedTrainingConfig } = launchConfig
  const updatedProfileConfig = updateProfileTrainingConfig(username, {
    ...sharedTrainingConfig,
    ...(method === 'fine-tune' ? { monthly_training, days_recent, old_samples } : {}),
    trainingTarget,
    gguf_conversion: {
      enabled: shouldConvertToGguf,
      quantization_type: launchConfig.quantization,
    },
  })
  const profileData = updatedProfileConfig.data
  const includePersona = !profileData
    || typeof profileData !== 'object'
    || Array.isArray(profileData)
    || (profileData as Record<string, unknown>).includePersona !== false

  if ((method === 'remote-lora' || method === 'fine-tune') && runpodConfig) {
    safeWriteJSON(path.join(profilePaths.etc, 'runpod.json'), runpodConfig)
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const agentName = agentFileName.replace('.ts', '') as TrainingProcessName
  const logPath = path.join(systemPaths.logs, 'run', `${agentName}-${timestamp}.log`)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const logStream = fs.openSync(logPath, 'w')

  const agentArgs = ['--username', username]
  if (method === 'fine-tune') {
    agentArgs.push('--base-model', launchConfig.base_model)
    if (launchConfig.monthly_training) {
      agentArgs.push('--monthly')
      if (launchConfig.days_recent) agentArgs.push('--days-recent', String(launchConfig.days_recent))
      if (launchConfig.old_samples !== undefined) agentArgs.push('--old-samples', String(launchConfig.old_samples))
    }
    if (launchConfig.max_samples) agentArgs.push('--max', String(launchConfig.max_samples))
  }

  const trainingEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_PATH: [
      path.join(systemPaths.root, 'node_modules'),
      path.join(systemPaths.root, 'packages/cli/node_modules'),
      path.join(systemPaths.root, 'apps/site/node_modules'),
    ].join(':'),
    ...buildTrainingEnvironmentOverrides(request, includePersona),
  }

  const child = spawn(tsxPath, [agentPath, ...agentArgs], {
    stdio: ['ignore', logStream, logStream],
    cwd: systemPaths.root,
    env: trainingEnv,
    detached: true,
  })

  let logClosed = false
  let launchEnded = false
  const closeLog = () => {
    if (logClosed) return
    logClosed = true
    fs.closeSync(logStream)
  }
  if (!child.pid) {
    child.once('error', closeLog)
    closeLog()
    return { success: false, status: 500, error: 'Failed to spawn training agent' }
  }
  const childPid = child.pid

  const finalizeLaunch = (
    event: 'training_completed' | 'training_failed',
    details: Record<string, unknown>,
  ) => {
    if (launchEnded) return
    launchEnded = true
    closeLog()
    releaseTrainingProcess(agentName, childPid)
    const endedAt = new Date().toISOString()
    let historyWriteError: string | undefined
    try {
      fs.appendFileSync(logPath, `\n[training-lifecycle] ${JSON.stringify({
        status: event === 'training_completed' ? 'completed' : 'failed',
        endedAt,
        agent: agentName,
        method,
        pid: childPid,
        username,
        ...details,
      })}\n`)
    } catch (error) {
      historyWriteError = error instanceof Error ? error.message : String(error)
      console.error('[training] Failed to persist terminal lifecycle marker:', error)
    }
    audit({
      level: event === 'training_completed' ? 'info' : 'error',
      category: 'system',
      event,
      details: {
        agent: agentName,
        method,
        pid: childPid,
        username,
        logPath: path.basename(logPath),
        timestamp: endedAt,
        historyWriteError,
        ...details,
      },
      actor: username,
    })
  }

  child.once('error', error => finalizeLaunch('training_failed', { error: error.message }))
  child.once('exit', (code, signal) => {
    finalizeLaunch(code === 0 ? 'training_completed' : 'training_failed', { exitCode: code, signal })
  })

  try {
    trackTrainingProcess(agentName, childPid)
  } catch (error) {
    launchEnded = true
    terminateDetachedProcess(childPid)
    closeLog()
    return {
      success: false,
      status: 500,
      error: `Failed to track training process: ${(error as Error).message}`,
    }
  }

  audit({
    level: 'info',
    category: 'system',
    event: 'training_started',
    details: {
      agent: agentName,
      method,
      trainingTarget,
      pid: childPid,
      username,
      config: launchConfig,
      runpodConfig: runpodConfig ? { templateId: runpodConfig.templateId, gpuType: runpodConfig.gpuType } : undefined,
      commandArgs: agentArgs,
      logPath: path.basename(logPath),
    },
    actor: username,
  })

  child.unref()
  return {
    success: true,
    status: 200,
    pid: childPid,
    agentName,
    message: `Training agent ${agentName} started with PID ${childPid}`,
  }
}
