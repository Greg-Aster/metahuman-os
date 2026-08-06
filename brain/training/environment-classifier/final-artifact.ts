import { access, readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { VLLMConfig } from '@metahuman/core/vllm'
import { REPOSITORY_ROOT } from './corpus.js'

const TRAINING_OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-classifier/training')

export interface FinalProvenance {
  owner?: string
  baseModel?: string
  heldOutDigest?: string
  heldOutUsed?: boolean
  mode?: string
}

export interface FinalEvaluationReceipt {
  owner?: string
  status?: string
  model?: string
  heldOutDigest?: string
}

interface AdapterConfig {
  base_model_name_or_path?: string
  r?: number
}

export interface FinalEnvironmentClassifierArtifact {
  root: string
  finalPath: string
  adapterPath: string
  provenance: FinalProvenance & { baseModel: string }
  receipt: FinalEvaluationReceipt & { model: string }
}

export function buildFinalArtifactVLLMConfig(artifact: {
  baseModel: string
  adapterPath: string
  model: string
}): VLLMConfig {
  return {
    endpoint: 'http://localhost:8000',
    model: artifact.baseModel,
    tokenizer: artifact.baseModel,
    chatTemplate: resolve(artifact.adapterPath, 'chat_template.jinja'),
    languageModelOnly: true,
    servedModelName: artifact.baseModel,
    loadFormat: 'safetensors',
    gpuMemoryUtilization: 0.23,
    maxModelLen: 2048,
    maxTokens: 512,
    tensorParallelSize: 1,
    dtype: 'bfloat16',
    quantization: null,
    enforceEager: true,
    autoUtilization: false,
    enableThinking: false,
    startupTimeoutMs: 240000,
    loraModules: [{ name: artifact.model, path: artifact.adapterPath }],
    maxLoraRank: 16,
    maxLoras: 1,
    maxCpuLoras: 1,
    loraDtype: 'bfloat16',
  }
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function loadScoredFinalArtifact(rootValue: string): Promise<FinalEnvironmentClassifierArtifact> {
  const root = resolve(rootValue)
  if (!root.startsWith(`${TRAINING_OUTPUT_ROOT}${sep}`)) {
    throw new Error(`Final artifact root must remain under ${TRAINING_OUTPUT_ROOT}`)
  }

  const finalPath = resolve(root, 'final')
  const adapterPath = resolve(finalPath, 'adapter')
  const provenance = await loadJson<FinalProvenance>(resolve(finalPath, 'run-provenance.json'))
  const receipt = await loadJson<FinalEvaluationReceipt>(resolve(finalPath, 'locked-evaluation-receipt.json'))
  const adapterConfig = await loadJson<AdapterConfig>(resolve(adapterPath, 'adapter_config.json'))

  if (provenance.owner !== 'environment-classifier'
    || provenance.baseModel !== 'unsloth/Qwen3.5-0.8B'
    || provenance.mode !== 'final-development-training'
    || provenance.heldOutUsed !== false
    || receipt.owner !== 'environment-classifier'
    || receipt.status !== 'completed'
    || receipt.heldOutDigest !== provenance.heldOutDigest
    || !receipt.model
    || adapterConfig.base_model_name_or_path !== provenance.baseModel
    || adapterConfig.r !== 16) {
    throw new Error('Operation requires the completed, one-shot-scored final Qwen3.5-0.8B artifact')
  }
  for (const required of ['adapter_model.safetensors', 'chat_template.jinja']) {
    await access(resolve(adapterPath, required))
  }

  return {
    root,
    finalPath,
    adapterPath,
    provenance: provenance as FinalProvenance & { baseModel: string },
    receipt: receipt as FinalEvaluationReceipt & { model: string },
  }
}
