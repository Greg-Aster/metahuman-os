import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { audit } from './audit.js'
import { getProfilePaths } from './path-builder.js'
import { systemPaths } from './paths.js'
import { safeWriteJSON } from './safe-file.js'
import { acquireLock, assertProfileMemoryAvailable } from './locks.js'
import { DEFAULT_TRAINING_MODEL, DEFAULT_VLLM_TRAINING_MODEL } from './model-defaults.js'
import { parseTrainingDataSettings, type CognitiveMode } from './training-schema.js'
import {
  readProfileTrainingConfig,
  updateProfileTrainingConfig,
} from './training-config.js'
import {
  listTrainingProcesses,
  finalizeTrainingProcess,
  trackTrainingProcess,
  stopTrainingProcesses, readTrainingHistoryForUser, listUnconfirmedTrainingCleanup,
  type TrainingProcessName,
} from './training-process.js'

export type TrainingMethod = 'local-lora' | 'remote-lora' | 'fine-tune'
export type TrainingTarget = 'ollama' | 'vllm'

export function listTrainingBaseModels(username: string) {
  const saved = readProfileTrainingConfig(username).base_model
  return [...new Set([saved, DEFAULT_TRAINING_MODEL, DEFAULT_VLLM_TRAINING_MODEL])]
    .filter((model): model is string => typeof model === 'string' && Boolean(model.trim()))
    .map(model => ({ id: model, name: model, description: model === saved ? 'Saved training base' : 'Unquantized Qwen 3.5 training weights',
      size: 'Depends on precision', vram: 'Depends on sequence length and batch size', license: 'See the source model card' }))
}

export async function getTrainingCapabilities(username: string) {
  const execute = promisify(execFile)
  const info = { hasLocalGPU: false, gpuModel: null as string | null, vramGB: null as number | null,
    freeVramGB: null as number | null, hasUnsloth: false, trainingEnvironmentError: null as string | null,
    hasRunpodKey: false, hasPreviousModel: false,
    hasS3Configured: Boolean(process.env.RUNPOD_S3_ACCESS_KEY && process.env.RUNPOD_S3_SECRET_KEY) }
  const { hasRunpodCredentials } = await import('./runpod-config.js')
  info.hasRunpodKey = hasRunpodCredentials(username)
  if (process.env.METAHUMAN_MOBILE === 'true') return info
  try {
    const { stdout } = await execute('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'], { timeout: 5000 })
    const [name, total, free] = stdout.trim().split('\n')[0].split(',').map(value => value.trim())
    if (!name || !Number.isFinite(Number(total)) || !Number.isFinite(Number(free))) throw new Error('Invalid GPU capability response')
    Object.assign(info, { hasLocalGPU: true, gpuModel: name, vramGB: Number(total) / 1024, freeVramGB: Number(free) / 1024 })
  } catch (error) { info.trainingEnvironmentError = (error as Error).message }
  try {
    await execute(path.join(systemPaths.root, 'venv/bin/python3'), [path.join(systemPaths.root, 'docker/runpod-trainer/train_unsloth.py'), '--check-environment'],
      { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, UNSLOTH_SKIP_SYSTEM_INSTALL: '1' } })
    info.hasUnsloth = true
  } catch (error) { info.trainingEnvironmentError = 'Training environment check failed: ' + (error as Error).message.slice(-3000) }
  const { listTrainingCandidates } = await import('./adapters.js')
  info.hasPreviousModel = listTrainingCandidates(username).some(candidate => candidate.review?.decision === 'accepted')
  return info
}

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
  load_in_4bit?: boolean
  mode_filter?: CognitiveMode
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
  runLabel: string
  logFile: string
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
  if (!nonEmptyString(config.quantization) || !['f16', 'bf16', 'q8_0', 'q6_k', 'q5_k_m', 'q5_k_s', 'q4_k_m', 'q4_k_s', 'q4_0'].includes(config.quantization.toLowerCase())) {
    return 'Select a supported GGUF quantization'
  }
  if (config.skipGguf !== undefined && typeof config.skipGguf !== 'boolean') {
    return 'skipGguf must be a boolean'
  }
  if (config.load_in_4bit !== undefined && typeof config.load_in_4bit !== 'boolean') return 'load_in_4bit must be a boolean'
  if (config.mode_filter !== undefined && !['dual', 'agent', 'emulation', 'environment'].includes(String(config.mode_filter))) return 'mode_filter is invalid'
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

  const configError = validateTrainingLaunchConfig(request.trainingConfig)
  if (configError) return configError
  const config = request.trainingConfig as TrainingLaunchConfig
  if (trainingTarget === 'ollama' && config.skipGguf === true) return 'Ollama review requires GGUF export; select vLLM to keep only native weights'
  if (method !== 'fine-tune' && (!config.lora_rank || !config.lora_alpha)) return 'LoRA rank and alpha must be positive for LoRA training'
  if (method === 'fine-tune' && config.load_in_4bit) return 'Full fine-tuning requires unquantized training weights'

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
    load_in_4bit: effective.load_in_4bit as boolean | undefined,
    mode_filter: effective.mode_filter as CognitiveMode | undefined,
  }
  const error = validateTrainingLaunchConfig(selected)
  if (error) throw new Error(`Profile training configuration is not launchable: ${error}`)
  return selected
}

export function buildTrainingEnvironmentOverrides(
  request: TrainingLaunchRequest,
): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {
    METAHUMAN_DISABLE_S3: request.advancedSettings?.enableS3Upload === true ? '0' : '1',
    METAHUMAN_SKIP_PREPROCESSING: request.advancedSettings?.enablePreprocessing === false ? '1' : '0',
  }
  if (request.runpodConfig) {
    overrides.RUNPOD_GPU_TYPE = request.runpodConfig.gpuType
    overrides.RUNPOD_API_KEY = request.runpodConfig.apiKey
    overrides.RUNPOD_TEMPLATE_ID = request.runpodConfig.templateId
  }
  return overrides
}

/** Freeze precisely the engine and data controls admitted for this run. */
export function buildTrainingEngineConfig(request: TrainingLaunchRequest, profile: Record<string, unknown>): Record<string, unknown> {
  const error = validateTrainingLaunchRequest(request)
  if (error) throw new Error(error)
  const config = request.trainingConfig
  if (!['bfloat16', 'float16'].includes(String(profile.dtype ?? 'bfloat16'))) throw new Error('Training dtype must be bfloat16 or float16')
  if (!['adamw_torch', 'adamw_8bit'].includes(String(profile.optimizer ?? 'adamw_torch'))) throw new Error('Training optimizer must be adamw_torch or adamw_8bit')
  const dropout = profile.lora_dropout ?? 0
  if (typeof dropout !== 'number' || !Number.isFinite(dropout) || dropout < 0 || dropout >= 1) throw new Error('LoRA dropout must be from 0 to less than 1')
  return {
    ...config,
    training_mode: request.method === 'fine-tune' ? 'full_finetune' : 'lora',
    trainingTarget: request.trainingTarget ?? 'ollama',
    data: parseTrainingDataSettings(profile.data ?? {}),
    dtype: profile.dtype ?? 'bfloat16',
    optimizer: profile.optimizer ?? 'adamw_torch',
    lora_dropout: profile.lora_dropout ?? 0,
    load_in_4bit: config.load_in_4bit === true,
    load_in_16bit: config.load_in_4bit !== true,
    chat_template: 'native', train_on_responses_only: true,
    gguf_conversion: {
      enabled: request.trainingTarget !== 'vllm' && config.skipGguf !== true,
      quantization_type: config.quantization,
    },
  }
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
 * automatic training through the finite Sleep workflow.
 */
export interface AutomaticTrainingAdmission { sessionId: string; cutoff: string; deadline: string }

export function launchTrainingJob(username: string, request: TrainingLaunchRequest, automatic?: AutomaticTrainingAdmission): TrainingLaunchResult {
  let lock
  try { lock = acquireLock('training-admission', { exitOnSignal: false }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { success: false, status: 409, error: 'Another training launch is being admitted' }
    throw error
  }
  try { return admitTrainingJob(username, request, automatic) } finally { lock.release() }
}

function admitTrainingJob(username: string, request: TrainingLaunchRequest, automatic?: AutomaticTrainingAdmission): TrainingLaunchResult {
  assertProfileMemoryAvailable(username)
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
  if (listUnconfirmedTrainingCleanup().length) return { success: false, status: 409, error: 'A previous training run has unconfirmed RunPod cleanup. Resolve it in that profile\'s Training History before another launch.' }

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
  const engineConfig = buildTrainingEngineConfig(request, readProfileTrainingConfig(username))
  if (automatic) engineConfig.automaticAdmission = automatic
  engineConfig.datasetCutoff = automatic?.cutoff ?? new Date().toISOString()
  const shouldConvertToGguf = trainingTarget !== 'vllm' && !launchConfig.skipGguf
  updateProfileTrainingConfig(username, {
    ...launchConfig,
    trainingTarget,
    gguf_conversion: {
      enabled: shouldConvertToGguf,
      quantization_type: launchConfig.quantization,
    },
  })

  if ((method === 'remote-lora' || method === 'fine-tune') && runpodConfig) {
    safeWriteJSON(path.join(profilePaths.etc, 'runpod.json'), runpodConfig)
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const workDirectory = path.join(systemPaths.root, 'metahuman-runs', username, timestamp.slice(0, 10), timestamp)
  fs.mkdirSync(workDirectory, { recursive: true, mode: 0o700 })
  const engineConfigPath = path.join(workDirectory, 'config.json')
  fs.writeFileSync(engineConfigPath, JSON.stringify(engineConfig, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  const agentName = agentFileName.replace('.ts', '') as TrainingProcessName
  const logPath = path.join(systemPaths.logs, 'run', `${agentName}-${timestamp}.log`)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const logStream = fs.openSync(logPath, 'w')

  const agentArgs = ['--username', username]

  const trainingEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_PATH: [
      path.join(systemPaths.root, 'node_modules'),
      path.join(systemPaths.root, 'packages/cli/node_modules'),
      path.join(systemPaths.root, 'apps/site/node_modules'),
    ].join(':'),
    ...buildTrainingEnvironmentOverrides(request),
    METAHUMAN_TRAINING_CONFIG_PATH: engineConfigPath,
    METAHUMAN_TRAINING_RUN_LABEL: timestamp,
  }

  // Run the worker directly so the tracked PID is its real process identity.
  const child = spawn(process.execPath, ['--import', 'tsx', agentPath, ...agentArgs], {
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
    const endedAt = new Date().toISOString()
    let historyWriteError: string | undefined
    try {
      finalizeTrainingProcess(agentName, childPid, {
        status: details.signal === 'SIGTERM' || details.signal === 'SIGINT' ? 'cancelled' : event === 'training_completed' ? 'completed' : 'failed',
        exitCode: details.exitCode as number | null | undefined,
        signal: details.signal as NodeJS.Signals | null | undefined,
        error: details.error as string | undefined,
      })
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
    trackTrainingProcess(agentName, childPid, { username, runLabel: timestamp, logFile: path.basename(logPath), workDirectory })
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
    runLabel: timestamp,
    logFile: path.basename(logPath),
    message: `Training agent ${agentName} started with PID ${childPid}`,
  }
}

/** Await the persisted terminal receipt, including provider cleanup after cancellation. */
export async function waitForTrainingJob(username: string, pid: number, runLabel: string, signal: AbortSignal): Promise<void> {
  let cancellationStartedAt: number | undefined
  const cancel = () => {
    cancellationStartedAt ??= Date.now()
    if (listTrainingProcesses().some(item => item.pid === pid && item.username === username && item.runLabel === runLabel)) stopTrainingProcesses(username)
  }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    while (listTrainingProcesses().some(item => item.pid === pid && item.runLabel === runLabel)) {
      if (cancellationStartedAt && Date.now() - cancellationStartedAt > 180_000) throw new Error('Training cancellation did not finish within three minutes; its process and cleanup receipts remain visible in Training History')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    const run = readTrainingHistoryForUser(username).find(item => item.pid === pid && item.runLabel === runLabel)
    if (!run || run.status !== 'completed') throw new Error(run?.error ?? 'Training ended without successful completion')
    signal.throwIfAborted()
  } finally { signal.removeEventListener('abort', cancel) }
}
