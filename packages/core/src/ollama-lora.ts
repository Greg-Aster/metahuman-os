/**
 * Ollama LoRA packaging support.
 *
 * Ollama does not hot-attach PEFT adapters to an already selected model. It
 * packages a compatible adapter and base model into a normal derived Ollama
 * model. Once created, that model is discovered by the shared artifact registry
 * and uses the same backend/provider path as every other Ollama model.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { audit } from './audit.js'
import {
  discoverVllmLoraAdapters,
  isVllmLoraCompatibleWithModel,
  type VllmLoraAdapter,
} from './vllm-lora.js'

const execFileAsync = promisify(execFile)

export interface OllamaLoraAdapter extends VllmLoraAdapter {
  compatibleWithTarget: boolean
  supportedByOllama: boolean
  unavailableReason?: string
}

export interface CreateOllamaLoraModelInput {
  profileOutPath: string
  adapterName: string
  baseModel: string
  modelName?: string
  endpoint?: string
  actor?: string
  parameters?: {
    numCtx?: number
    numPredict?: number
    temperature?: number
    topP?: number
    topK?: number
    minP?: number
    repeatPenalty?: number
    seed?: number | null
  }
}

const OLLAMA_SAFETENSORS_ADAPTER_FAMILIES = ['llama', 'mistral', 'gemma']

export function isOllamaSafetensorsAdapterFamilySupported(baseModel: string | undefined): boolean {
  if (!baseModel) return false
  const normalized = baseModel.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  return OLLAMA_SAFETENSORS_ADAPTER_FAMILIES.some(family =>
    normalized.split(' ').some(part => part === family || part.startsWith(family))
  )
}

export function sanitizeOllamaModelName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/.]+|[-/.]+$/g, '')
    .slice(0, 120)
}

export function buildOllamaLoraModelName(baseModel: string, adapterName: string): string {
  const base = sanitizeOllamaModelName(baseModel.replace(/:[^/]+$/, '')) || 'model'
  const adapter = sanitizeOllamaModelName(adapterName) || 'adapter'
  return `${base}-${adapter}:latest`
}

export function buildOllamaLoraModelfile(
  baseModel: string,
  adapterPath: string,
  parameters: CreateOllamaLoraModelInput['parameters'] = {},
): string {
  const lines = [
    `FROM ${baseModel}`,
    `ADAPTER ${JSON.stringify(adapterPath)}`,
  ]
  const values: Array<[string, number | null | undefined]> = [
    ['num_ctx', parameters.numCtx],
    ['num_predict', parameters.numPredict],
    ['temperature', parameters.temperature],
    ['top_p', parameters.topP],
    ['top_k', parameters.topK],
    ['min_p', parameters.minP],
    ['repeat_penalty', parameters.repeatPenalty],
    ['seed', parameters.seed],
  ]
  for (const [name, value] of values) {
    if (value !== undefined && value !== null) lines.push(`PARAMETER ${name} ${value}`)
  }
  return `${lines.join('\n')}\n`
}

export async function discoverOllamaLoraAdapters(
  profileOutPath: string,
  targetModel: string,
): Promise<OllamaLoraAdapter[]> {
  const adapters = await discoverVllmLoraAdapters(profileOutPath)
  return adapters.map(adapter => {
    const compatibleWithTarget = isVllmLoraCompatibleWithModel(adapter.baseModel, targetModel)
    const supportedByOllama = isOllamaSafetensorsAdapterFamilySupported(adapter.baseModel)
    let unavailableReason: string | undefined
    if (!adapter.valid) {
      unavailableReason = 'The adapter files are incomplete.'
    } else if (!compatibleWithTarget) {
      unavailableReason = `This adapter was trained for ${adapter.baseModel || 'an unknown base model'}, not ${targetModel}.`
    } else if (!supportedByOllama) {
      unavailableReason = 'This safetensors adapter family is not supported by Ollama adapter import. Use vLLM, or select an already merged Ollama model.'
    }
    return {
      ...adapter,
      compatibleWithTarget,
      supportedByOllama,
      unavailableReason,
    }
  })
}

export async function createOllamaLoraModel(input: CreateOllamaLoraModelInput): Promise<{
  modelName: string
  adapterName: string
  baseModel: string
}> {
  if (!input.baseModel.trim()) throw new Error('A base Ollama model is required')
  const adapters = await discoverOllamaLoraAdapters(input.profileOutPath, input.baseModel)
  const adapter = adapters.find(candidate => candidate.name === input.adapterName)
  if (!adapter) throw new Error(`LoRA adapter not found: ${input.adapterName}`)
  if (adapter.unavailableReason) throw new Error(adapter.unavailableReason)

  const requestedName = input.modelName?.trim()
    ? sanitizeOllamaModelName(input.modelName)
    : buildOllamaLoraModelName(input.baseModel, adapter.name)
  if (!requestedName) throw new Error('The derived Ollama model name is invalid')

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-ollama-lora-'))
  const modelfilePath = path.join(tempDir, 'Modelfile')
  fs.writeFileSync(
    modelfilePath,
    buildOllamaLoraModelfile(input.baseModel, adapter.path, input.parameters),
    { encoding: 'utf-8', mode: 0o600 },
  )

  try {
    const env = { ...process.env }
    if (input.endpoint?.trim()) env.OLLAMA_HOST = input.endpoint.trim()
    const commandOptions = {
      env,
      timeout: 15 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    }
    try {
      await execFileAsync('ollama', ['create', requestedName, '-f', modelfilePath], commandOptions)
    } catch (firstError) {
      const detail = ((firstError as Error & { stderr?: string }).stderr || (firstError as Error).message).trim()
      if (!/experimental/i.test(detail)) throw firstError
      await execFileAsync(
        'ollama',
        ['create', requestedName, '-f', modelfilePath, '--experimental'],
        commandOptions,
      )
    }
  } catch (error) {
    const commandError = error as Error & { stderr?: string }
    const detail = commandError.stderr?.trim() || commandError.message
    throw new Error(`Ollama could not create ${requestedName}: ${detail}`)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'ollama_lora_model_created',
    actor: input.actor || 'system',
    details: {
      modelName: requestedName,
      baseModel: input.baseModel,
      adapterName: adapter.name,
    },
  })

  return {
    modelName: requestedName,
    adapterName: adapter.name,
    baseModel: input.baseModel,
  }
}
