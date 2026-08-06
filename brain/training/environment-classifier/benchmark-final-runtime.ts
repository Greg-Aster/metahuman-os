import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vllm, type VLLMConfig } from '@metahuman/core/vllm'
import { main as runBenchmark } from './benchmark.js'
import {
  buildFinalArtifactVLLMConfig,
  loadScoredFinalArtifact,
} from './final-artifact.js'

type RuntimeMode = 'eager' | 'compiled'

interface Options {
  root: string
  mode: RuntimeMode
}

function parseOptions(arguments_: string[]): Options {
  let rootValue: string | undefined
  let mode: RuntimeMode = 'compiled'
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--root' && value) {
      rootValue = value
      index += 1
    } else if (argument === '--mode' && (value === 'eager' || value === 'compiled')) {
      mode = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }
  if (!rootValue) {
    throw new Error('Usage: --root out/environment-classifier/training/<final-run> [--mode eager|compiled]')
  }
  return { root: rootValue, mode }
}

function serializableConfig(config: VLLMConfig): Record<string, unknown> {
  return {
    endpoint: config.endpoint,
    model: config.model,
    tokenizer: config.tokenizer,
    chatTemplate: config.chatTemplate,
    languageModelOnly: config.languageModelOnly,
    servedModelName: config.servedModelName,
    loadFormat: config.loadFormat,
    gpuMemoryUtilization: config.gpuMemoryUtilization,
    maxModelLen: config.maxModelLen,
    maxTokens: config.maxTokens,
    dtype: config.dtype,
    enforceEager: config.enforceEager,
    enableThinking: config.enableThinking,
    loraModules: config.loraModules,
    maxLoraRank: config.maxLoraRank,
    maxLoras: config.maxLoras,
    maxCpuLoras: config.maxCpuLoras,
    loraDtype: config.loraDtype,
  }
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(arguments_)
  const { finalPath, adapterPath, provenance, receipt } = await loadScoredFinalArtifact(options.root)
  if (await vllm.isRunning()) {
    throw new Error('A vLLM server is already running; stop it before an isolated runtime benchmark')
  }

  const runStamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const outputPath = resolve(finalPath, 'runtime-benchmarks', `vllm-${options.mode}-${runStamp}`)
  const model = `${receipt.model}-${options.mode}`
  const config: VLLMConfig = {
    ...buildFinalArtifactVLLMConfig({
      baseModel: provenance.baseModel,
      adapterPath,
      model,
    }),
    enforceEager: options.mode === 'eager',
  }

  await mkdir(outputPath, { recursive: true })
  await writeFile(resolve(outputPath, 'runtime-config.json'), `${JSON.stringify({
    version: 1,
    owner: 'environment-classifier',
    purpose: 'development-only-runtime-benchmark',
    mode: options.mode,
    sourceModel: receipt.model,
    heldOutUsed: false,
    createdAt: new Date().toISOString(),
    config: serializableConfig(config),
  }, null, 2)}\n`, 'utf8')

  let serverStarted = false
  try {
    vllm.setEndpoint('http://localhost:8000')
    const result = await vllm.startServer(config)
    if (!result.success) throw new Error(result.error || `vLLM failed to start in ${options.mode} mode`)
    serverStarted = true

    const loadedModels = await vllm.listModels()
    if (!loadedModels.some(loaded => loaded.id === model)) {
      throw new Error(`vLLM started without the runtime benchmark alias ${model}`)
    }

    await runBenchmark([
      '--provider', 'vllm',
      '--models', model,
      '--split', 'development',
      '--message-format', 'compact',
      '--endpoint', 'http://localhost:8000',
      '--output-dir', outputPath,
    ])
    console.log(`Runtime benchmark output: ${outputPath}`)
  } finally {
    if (serverStarted) await vllm.stopServer()
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
