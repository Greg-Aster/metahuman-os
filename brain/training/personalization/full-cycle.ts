/**
 * Shared personalization worker and CLI bridge.
 * Core's training launcher admits every CLI/UI job; this worker orchestrates its
 * frozen dataset, trainer and candidate verification without activating a model.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  systemPaths, getProfilePaths, readProfileTrainingConfig, trainingLaunchConfigForProfile,
  launchTrainingJob, loadRunpodConfig, verifyTrainingCandidate, safeWriteJSON,
  finalizeTrainingProcess, type TrainingProcessName,
  readSleepRuntimeState,
  type TrainingLaunchConfig, type TrainingMethod,
} from '@metahuman/core'
import { parseTrainingDataSettings, type CognitiveMode } from '@metahuman/core/training-schema'
import { withUserContext } from '@metahuman/core/context'
import { requireUserInfo } from '@metahuman/core/user-resolver'
import { preparePersonalizationDataset, parsePositiveInteger, parseCognitiveMode } from './dataset-pipeline.js'
import { runRemoteTraining } from './lora-trainer.js'

export async function runLocalTraining(options: {
  workDirectory: string; outputDirectory: string; trainingPath: string; evaluationPath: string
  configPath: string; manifestPath: string
  signal?: AbortSignal
}): Promise<void> {
  const python = path.join(systemPaths.root, 'venv/bin/python3')
  if (!fs.existsSync(python)) throw new Error('Local training environment is missing; run ./bin/setup-local-training')
  const child = spawn(python, [
    path.join(systemPaths.root, 'docker/runpod-trainer/train_unsloth.py'),
    '--data', options.trainingPath, '--eval-data', options.evaluationPath,
    '--manifest', options.manifestPath, '--config', options.configPath, '--output', options.outputDirectory,
  ], { cwd: options.workDirectory, stdio: 'inherit', signal: options.signal, env: { ...process.env, PYTHONUNBUFFERED: '1', UNSLOTH_SKIP_SYSTEM_INSTALL: '1' } })
  await new Promise<void>((resolve, reject) => {
    let failure: Error | undefined
    child.once('error', error => { failure = error })
    child.once('close', (code, signal) => code === 0 && !signal
      ? resolve() : reject(failure ?? new Error('Local trainer failed: ' + (signal ?? 'exit ' + code))))
  })
}

export async function runPersonalizationCycle(username: string, method: TrainingMethod, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const runLabel = process.env.METAHUMAN_TRAINING_RUN_LABEL
  const configPath = process.env.METAHUMAN_TRAINING_CONFIG_PATH
  if (!runLabel || !/^\d{4}-\d{2}-\d{2}T[0-9TZ-]+$/.test(runLabel) || !configPath) {
    throw new Error('This worker requires a job admitted by the Core training launcher')
  }
  const date = runLabel.slice(0, 10)
  const workDirectory = path.join(systemPaths.root, 'metahuman-runs', username, date, runLabel)
  if (path.resolve(configPath) !== path.join(workDirectory, 'config.json')) throw new Error('Training configuration is outside the admitted run')
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (cfg.training_mode !== (method === 'fine-tune' ? 'full_finetune' : 'lora')) throw new Error('Worker method differs from its admitted configuration')
  const settings = parseTrainingDataSettings(cfg.data)
  const profile = getProfilePaths(username)
  const outputRoot = path.join(profile.out, 'adapters', date, runLabel)
  const candidateDirectory = path.join(outputRoot, method === 'fine-tune' ? 'model' : 'adapter')
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 })
  const summaryPath = path.join(outputRoot, 'run.json')
  if (fs.existsSync(summaryPath)) throw new Error('This training run already has an execution receipt')
  const summary: Record<string, unknown> = {
    version: 2, runLabel, username, method, trainingTarget: cfg.trainingTarget, baseModel: cfg.base_model, startedAt: new Date().toISOString(),
    status: 'preparing', candidateDirectory, workDirectory, activation: 'not-activated',
  }
  safeWriteJSON(summaryPath, summary)
  console.log('[full-cycle] Starting ' + method + ' for user: ' + username)
  console.log('[full-cycle] Training base model: ' + cfg.base_model)
  try {
    const frozenConfigCopy = path.join(outputRoot, 'config.json')
    fs.copyFileSync(configPath, frozenConfigCopy, fs.constants.COPYFILE_EXCL)
    const dataset = await preparePersonalizationDataset({
      actor: username, baseModel: cfg.base_model, datasetPaths: [path.join(outputRoot, 'train.jsonl')],
      logPrefix: 'full-cycle', maxSamples: cfg.max_samples, outputRoot,
      recentDays: cfg.monthly_training ? cfg.days_recent ?? 30 : undefined,
      olderSamples: cfg.monthly_training ? cfg.old_samples ?? 3000 : undefined,
      modeFilter: cfg.mode_filter as CognitiveMode | undefined,
      skipPreprocessing: process.env.METAHUMAN_SKIP_PREPROCESSING === '1',
      cutoff: cfg.datasetCutoff, username, signal,
    }, { settings })
    const manifest = JSON.parse(fs.readFileSync(dataset.manifestPath, 'utf8'))
    Object.assign(summary, { status: 'training', datasetId: dataset.datasetId, trainingSamples: dataset.sampleCount,
      evaluationSamples: dataset.evaluationCount, cutoff: manifest.cutoff })
    safeWriteJSON(summaryPath, summary)
    signal?.throwIfAborted()
    if (method === 'local-lora') {
      await runLocalTraining({
        workDirectory, outputDirectory: candidateDirectory, trainingPath: dataset.datasetPaths[0],
        evaluationPath: dataset.evaluationPaths[0], configPath, manifestPath: dataset.manifestPath, signal,
      })
    } else {
      const remote = await runRemoteTraining({
        DATE_STR: date, RUN_LABEL: runLabel, run_id: runLabel, WORK_LOCAL: workDirectory, OUT_ROOT: outputRoot,
        FINAL_ADAPTER_DIR: candidateDirectory, RAW_DATA_FILE: dataset.datasetPaths[0], CLEAN_DATA_FILE: dataset.datasetPaths[0],
        EVAL_DATA_FILE: dataset.evaluationPaths[0], DATASET_MANIFEST_FILE: dataset.manifestPath,
        CONFIG_FILE: configPath, SUMMARY_FILE: path.join(workDirectory, 'run-summary.json'),
        samples_used: dataset.sampleCount, username, signal,
      })
      Object.assign(summary, { podId: remote.pod_id, podTerminated: remote.terminated })
      if (!remote.training_success) throw new Error(remote.error ?? 'Remote training failed')
    }
    const candidate = await verifyTrainingCandidate(candidateDirectory, {
      datasetId: dataset.datasetId, baseModel: cfg.base_model, configPath: frozenConfigCopy,
      evaluationSha256: manifest.evaluation.sha256, requireGguf: cfg.gguf_conversion.enabled,
    })
    Object.assign(summary, {
      status: candidate.qualityGate === 'passed' ? 'candidate' : 'rejected', qualityGate: candidate.qualityGate,
      baselineLoss: candidate.baselineLoss, candidateLoss: candidate.candidateLoss, finishedAt: new Date().toISOString(),
    })
    safeWriteJSON(summaryPath, summary)
    console.log('[full-cycle] Candidate saved for review: ' + candidateDirectory)
    console.log('[full-cycle] Quality gate: ' + candidate.qualityGate + '; serving validation and activation review required')
  } catch (error) {
    Object.assign(summary, { status: signal?.aborted ? 'cancelled' : 'failed', error: (error as Error).message, finishedAt: new Date().toISOString() })
    safeWriteJSON(summaryPath, summary)
    throw error
  }
}

export function parseTrainingArguments(args: string[]): {
  username: string; overrides: Partial<TrainingLaunchConfig>; modeFilter?: CognitiveMode
} {
  let username = ''
  const overrides: Partial<TrainingLaunchConfig> = {}
  let modeFilter: CognitiveMode | undefined
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--monthly') { overrides.monthly_training = true; continue }
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + argument)
    if (argument === '--username') username = value
    else if (argument === '--base-model') overrides.base_model = value
    else if (argument === '--max') overrides.max_samples = value === 'all' ? null : parsePositiveInteger(value, '--max')
    else if (argument === '--mode') modeFilter = parseCognitiveMode(value, '--mode')
    else if (argument === '--days-recent') {
      overrides.days_recent = parsePositiveInteger(value, '--days-recent')
      overrides.monthly_training = true
    } else if (argument === '--old-samples') {
      const count = Number(value)
      if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) throw new Error('--old-samples must be an integer from 0 to 1000000')
      overrides.old_samples = count
      overrides.monthly_training = true
    } else throw new Error('Unknown training argument: ' + argument)
  }
  if (!username.trim()) throw new Error('--username is required')
  return { username, overrides, modeFilter }
}

export async function runTrainingEntryPoint(method: TrainingMethod, args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help')) {
    console.log('Training options: --username NAME [--base-model MODEL] [--max N|all] [--mode dual|agent|emulation|environment] [--monthly] [--days-recent N] [--old-samples N]')
    console.log('Jobs use the same Core launcher and saved settings as Training Wizard. Review candidates in Training History.')
    return
  }
  const options = parseTrainingArguments(args)
  const user = requireUserInfo(options.username)
  await withUserContext(user, async () => {
    if (process.env.METAHUMAN_TRAINING_CONFIG_PATH) {
      const name: TrainingProcessName = method === 'local-lora' ? 'full-cycle-local' : method === 'fine-tune' ? 'fine-tune-cycle' : 'full-cycle'
      const controller = new AbortController()
      const onCancel = () => {
        if (controller.signal.aborted) return
        controller.abort(new Error('Training was cancelled'))
        // Also stop converter/reload grandchildren. The worker retains control of remote cleanup.
        try { process.kill(-process.pid, 'SIGTERM') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
      process.on('SIGTERM', onCancel)
      process.on('SIGINT', onCancel)
      const admittedConfig = JSON.parse(fs.readFileSync(process.env.METAHUMAN_TRAINING_CONFIG_PATH, 'utf8'))
      const automatic = admittedConfig.automaticAdmission
      const checkAdmission = () => {
        if (!automatic) return
        try {
          const session = readSleepRuntimeState().currentSession
          if (!Number.isFinite(Date.parse(automatic.deadline)) || Date.now() >= Date.parse(automatic.deadline)
              || !session || session.id !== automatic.sessionId || session.state !== 'running'
              || session.username !== options.username || session.currentStageId !== 'train-personalization') onCancel()
        } catch (error) {
          console.error('[full-cycle] Automatic admission could not be verified: ' + (error as Error).message)
          onCancel()
        }
      }
      checkAdmission()
      const admissionTimer = automatic ? setInterval(checkAdmission, 1000) : undefined
      try {
        await runPersonalizationCycle(options.username, method, controller.signal)
        controller.signal.throwIfAborted()
        finalizeTrainingProcess(name, process.pid, { status: 'completed', exitCode: 0 })
      } catch (error) {
        finalizeTrainingProcess(name, process.pid, { status: controller.signal.aborted ? 'cancelled' : 'failed', exitCode: 1, error: (error as Error).message })
        throw error
      } finally {
        if (admissionTimer) clearInterval(admissionTimer)
        process.removeListener('SIGTERM', onCancel)
        process.removeListener('SIGINT', onCancel)
      }
      return
    }
    const profile = readProfileTrainingConfig(options.username)
    const runpod = method === 'local-lora' ? undefined : loadRunpodConfig(options.username)
    const launch = launchTrainingJob(options.username, {
      method, trainingTarget: profile.trainingTarget === 'vllm' ? 'vllm' : 'ollama',
      trainingConfig: { ...trainingLaunchConfigForProfile(options.username, options.overrides), mode_filter: options.modeFilter },
      runpodConfig: runpod ? { apiKey: runpod.apiKey ?? '', templateId: runpod.templateId ?? '', gpuType: runpod.gpuType ?? '' } : undefined,
      advancedSettings: { enableS3Upload: false, enablePreprocessing: true },
    })
    if (!launch.success) throw new Error(launch.error)
    console.log(launch.message + ' (PID ' + launch.pid + '). Track or cancel it in Training Wizard.')
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTrainingEntryPoint('remote-lora').catch(error => { console.error('[full-cycle] failed:', error); process.exitCode = 1 })
}
