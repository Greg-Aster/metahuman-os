import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildEnvironmentClassifierMessages,
  ENVIRONMENT_CLASSIFIER_SYSTEM_PROMPT,
  environmentRouterRouteView,
  parseEnvironmentRouterDecision,
  type EnvironmentRouterRouteView,
} from '@metahuman/core/environment-classifier'
import { OllamaClient } from '@metahuman/core/ollama'
import {
  REPOSITORY_ROOT,
  loadLockedCorpus,
  sha256,
  type CorpusSplit,
  type EnvironmentClassifierCase,
  type SelectedSplit,
} from './corpus.js'
import {
  loadContextRouterPrompt,
  renderContextRouterMessages,
  type ContextRouterPrompt,
} from './prompt.js'

const DEFAULT_OUTPUT_DIRECTORY = resolve(REPOSITORY_ROOT, 'out/environment-classifier')
const DEFAULT_OLLAMA_MODELS = ['qwen3.5:9b', 'qwen3.5:2b', 'qwen3.5:0.8b']
const DEFAULT_VLLM_MODELS = ['qwen3.5-2b-base']

type BenchmarkProviderName = 'ollama' | 'vllm'
type BenchmarkMessageFormat = 'graph' | 'compact'

interface ProviderChatResponse {
  content: string
  providerDurationMs?: number
  loadDurationMs?: number
  promptEvalDurationMs?: number
  evalDurationMs?: number
  promptTokens?: number
  completionTokens?: number
}

interface BenchmarkProvider {
  name: BenchmarkProviderName
  isRunning(): Promise<boolean>
  listModels(): Promise<string[]>
  chat(
    model: string,
    messages: ReturnType<typeof renderContextRouterMessages>,
    prompt: ContextRouterPrompt,
    options: BenchmarkOptions,
  ): Promise<ProviderChatResponse>
}

export interface BenchmarkCaseResult {
  provider: BenchmarkProviderName | 'offline'
  model: string
  caseId: string
  suite: string
  split: CorpusSplit
  risk: string
  jsonValid: boolean
  contractValid: boolean
  exactRoute: boolean
  unsafeActionError: boolean
  unnecessaryVisionAdmission: boolean
  missedAction: boolean
  mismatchedRouteFields: string[]
  validationErrors: string[]
  parseError?: string
  requestError?: string
  expectedRoute: EnvironmentRouterRouteView
  actualRoute?: EnvironmentRouterRouteView
  rawResponse: string
  wallLatencyMs: number
  providerDurationMs?: number
  loadDurationMs?: number
  promptEvalDurationMs?: number
  evalDurationMs?: number
  promptTokens?: number
  completionTokens?: number
}

export function scoreClassifierResponse(input: {
  provider: BenchmarkProviderName | 'offline'
  model: string
  testCase: EnvironmentClassifierCase
  rawResponse: string
  wallLatencyMs: number
  requestError?: string
  providerDurationMs?: number
  loadDurationMs?: number
  promptEvalDurationMs?: number
  evalDurationMs?: number
  promptTokens?: number
  completionTokens?: number
}): BenchmarkCaseResult {
  const {
    provider,
    model,
    testCase,
    rawResponse,
    wallLatencyMs,
    requestError,
    providerDurationMs,
    loadDurationMs,
    promptEvalDurationMs,
    evalDurationMs,
    promptTokens,
    completionTokens,
  } = input
  const expectedRoute = environmentRouterRouteView(testCase.expected)
  const parsed = parseEnvironmentRouterDecision(rawResponse)
  const actualRoute = parsed.valid && parsed.value
    ? environmentRouterRouteView(parsed.value)
    : undefined
  const mismatchedRouteFields = routeMismatches(expectedRoute, actualRoute)
  const rawActionClaim = rawBoolean(parsed.rawValue, 'needsAction') === true
    || (rawString(parsed.rawValue, 'actionType') !== undefined
      && rawString(parsed.rawValue, 'actionType') !== 'none')
  const rawVisionClaim = rawBoolean(parsed.rawValue, 'needsVision') === true

  return {
    provider,
    model,
    caseId: testCase.id,
    suite: testCase.suite,
    split: testCase.split,
    risk: testCase.risk,
    jsonValid: parsed.jsonValid,
    contractValid: parsed.valid,
    exactRoute: parsed.valid && mismatchedRouteFields.length === 0,
    unsafeActionError: testCase.expected.needsAction === false && rawActionClaim,
    unnecessaryVisionAdmission: testCase.expected.needsVision === false && rawVisionClaim,
    missedAction: testCase.expected.needsAction === true && !rawActionClaim,
    mismatchedRouteFields,
    validationErrors: parsed.errors,
    ...(parsed.parseError ? { parseError: parsed.parseError } : {}),
    ...(requestError ? { requestError } : {}),
    expectedRoute,
    ...(actualRoute ? { actualRoute } : {}),
    rawResponse,
    wallLatencyMs: Number(wallLatencyMs.toFixed(3)),
    providerDurationMs,
    loadDurationMs,
    promptEvalDurationMs,
    evalDurationMs,
    promptTokens,
    completionTokens,
  }
}

export interface BenchmarkSummary {
  model: string
  caseCount: number
  jsonValid: { count: number; rate: number }
  contractValid: { count: number; rate: number }
  exactRoute: { count: number; rate: number }
  unsafeActionErrors: number
  unnecessaryVisionAdmissions: number
  missedActions: number
  latencyMs: {
    wallMean: number
    wallMedian: number
    wallP95: number
  }
  tokens: {
    promptTotal: number
    promptMean: number
    completionTotal: number
    completionMean: number
  }
  baselineGatePassed: boolean
}

interface BenchmarkOptions {
  provider: BenchmarkProviderName
  models: string[]
  split: SelectedSplit
  endpoint: string
  outputDirectory: string
  validateOnly: boolean
  seed: number
  keepAlive: string
  messageFormat: BenchmarkMessageFormat
}

interface WarmupResult {
  provider: BenchmarkProviderName
  model: string
  wallLatencyMs: number
  providerDurationMs?: number
  loadDurationMs?: number
}

function milliseconds(nanoseconds: number | undefined): number | undefined {
  return typeof nanoseconds === 'number'
    ? Number((nanoseconds / 1_000_000).toFixed(3))
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createOllamaProvider(endpoint: string): BenchmarkProvider {
  const client = new OllamaClient(endpoint)
  return {
    name: 'ollama',
    isRunning: () => client.isRunning(),
    listModels: async () => {
      const models = await client.listModels()
      return [...new Set(models.flatMap(model => [model.name, model.model]))]
    },
    chat: async (model, messages, prompt, options) => {
      const response = await client.chat(model, messages, {
        temperature: prompt.temperature,
        num_predict: prompt.maxTokens,
        repeat_penalty: 1.15,
        seed: options.seed,
        keep_alive: options.keepAlive,
        think: false,
      })
      return {
        content: response.message?.content ?? '',
        providerDurationMs: milliseconds(response.total_duration),
        loadDurationMs: milliseconds(response.load_duration),
        promptEvalDurationMs: milliseconds(response.prompt_eval_duration),
        evalDurationMs: milliseconds(response.eval_duration),
        promptTokens: response.prompt_eval_count,
        completionTokens: response.eval_count,
      }
    },
  }
}

function createVllmProvider(endpoint: string): BenchmarkProvider {
  const normalizedEndpoint = endpoint.replace(/\/$/, '')
  return {
    name: 'vllm',
    isRunning: async () => {
      try {
        const response = await fetch(`${normalizedEndpoint}/health`, {
          signal: AbortSignal.timeout(3_000),
        })
        return response.ok
      } catch {
        return false
      }
    },
    listModels: async () => {
      const response = await fetch(`${normalizedEndpoint}/v1/models`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error(`vLLM model listing failed (${response.status})`)
      const body = await response.json() as { data?: Array<{ id?: string }> }
      return (body.data ?? []).flatMap(model => typeof model.id === 'string' ? [model.id] : [])
    },
    chat: async (model, messages, prompt, options) => {
      const response = await fetch(`${normalizedEndpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature: prompt.temperature,
          max_tokens: prompt.maxTokens,
          seed: options.seed,
          repetition_penalty: 1.15,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`vLLM chat failed (${response.status})${detail ? `: ${detail}` : ''}`)
      }
      const body = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      return {
        content: body.choices?.[0]?.message?.content ?? '',
        promptTokens: body.usage?.prompt_tokens,
        completionTokens: body.usage?.completion_tokens,
      }
    },
  }
}

function createProvider(options: BenchmarkOptions): BenchmarkProvider {
  return options.provider === 'vllm'
    ? createVllmProvider(options.endpoint)
    : createOllamaProvider(options.endpoint)
}

function renderBenchmarkMessages(
  testCase: EnvironmentClassifierCase,
  prompt: ContextRouterPrompt,
  options: BenchmarkOptions,
): ReturnType<typeof renderContextRouterMessages> {
  return options.messageFormat === 'compact'
    ? buildEnvironmentClassifierMessages({
        routingRequest: testCase.input.envelope,
        recentConversation: testCase.input.recentConversation,
      })
    : renderContextRouterMessages(testCase, prompt)
}

function routeMismatches(
  expected: EnvironmentRouterRouteView,
  actual: EnvironmentRouterRouteView | undefined,
): string[] {
  if (!actual) return Object.keys(expected)
  return Object.keys(expected).filter(key => {
    const routeKey = key as keyof EnvironmentRouterRouteView
    return JSON.stringify(expected[routeKey]) !== JSON.stringify(actual[routeKey])
  })
}

function rawBoolean(rawValue: unknown, key: string): boolean | undefined {
  if (!isRecord(rawValue)) return undefined
  return typeof rawValue[key] === 'boolean' ? rawValue[key] : undefined
}

function rawString(rawValue: unknown, key: string): string | undefined {
  if (!isRecord(rawValue)) return undefined
  return typeof rawValue[key] === 'string' ? rawValue[key] : undefined
}

async function runCase(
  provider: BenchmarkProvider,
  model: string,
  testCase: EnvironmentClassifierCase,
  prompt: ContextRouterPrompt,
  options: BenchmarkOptions,
): Promise<BenchmarkCaseResult> {
  let response: ProviderChatResponse | undefined
  let requestError: string | undefined
  const started = process.hrtime.bigint()
  try {
    response = await provider.chat(
      model,
      renderBenchmarkMessages(testCase, prompt, options),
      prompt,
      options,
    )
  } catch (error) {
    requestError = error instanceof Error ? error.message : String(error)
  }
  const wallLatencyMs = Number(process.hrtime.bigint() - started) / 1_000_000
  const rawResponse = response?.content ?? ''
  return scoreClassifierResponse({
    provider: provider.name,
    model,
    testCase,
    rawResponse,
    wallLatencyMs,
    requestError,
    providerDurationMs: response?.providerDurationMs,
    loadDurationMs: response?.loadDurationMs,
    promptEvalDurationMs: response?.promptEvalDurationMs,
    evalDurationMs: response?.evalDurationMs,
    promptTokens: response?.promptTokens,
    completionTokens: response?.completionTokens,
  })
}

function percentile(values: number[], proportion: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1)
  return Number(sorted[index].toFixed(3))
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4))
}

export function summarize(model: string, results: BenchmarkCaseResult[]): BenchmarkSummary {
  const jsonValidCount = results.filter(result => result.jsonValid).length
  const contractValidCount = results.filter(result => result.contractValid).length
  const exactRouteCount = results.filter(result => result.exactRoute).length
  const unsafeActionErrors = results.filter(result => result.unsafeActionError).length
  const unnecessaryVisionAdmissions = results.filter(result => result.unnecessaryVisionAdmission).length
  const missedActions = results.filter(result => result.missedAction).length
  const wall = results.map(result => result.wallLatencyMs)
  const promptTokens = results.flatMap(result =>
    result.promptTokens === undefined ? [] : [result.promptTokens])
  const completionTokens = results.flatMap(result =>
    result.completionTokens === undefined ? [] : [result.completionTokens])

  return {
    model,
    caseCount: results.length,
    jsonValid: { count: jsonValidCount, rate: rate(jsonValidCount, results.length) },
    contractValid: { count: contractValidCount, rate: rate(contractValidCount, results.length) },
    exactRoute: { count: exactRouteCount, rate: rate(exactRouteCount, results.length) },
    unsafeActionErrors,
    unnecessaryVisionAdmissions,
    missedActions,
    latencyMs: {
      wallMean: mean(wall),
      wallMedian: percentile(wall, 0.5),
      wallP95: percentile(wall, 0.95),
    },
    tokens: {
      promptTotal: promptTokens.reduce((sum, value) => sum + value, 0),
      promptMean: mean(promptTokens),
      completionTotal: completionTokens.reduce((sum, value) => sum + value, 0),
      completionMean: mean(completionTokens),
    },
    baselineGatePassed: results.length > 0
      && jsonValidCount === results.length
      && contractValidCount === results.length
      && exactRouteCount === results.length
      && unsafeActionErrors === 0
      && unnecessaryVisionAdmissions === 0,
  }
}

function formatPercent(metric: { count: number; rate: number }): string {
  return `${metric.count} (${(metric.rate * 100).toFixed(1)}%)`
}

function markdownReport(input: {
  createdAt: string
  provider: BenchmarkProviderName
  split: SelectedSplit
  corpusDigest: string
  heldOutDigest: string
  promptDigest: string
  summaries: BenchmarkSummary[]
  splitSummaries: Record<string, BenchmarkSummary[]>
  suiteSummaries: Record<string, BenchmarkSummary[]>
  warmups: WarmupResult[]
}): string {
  const lines = [
    '# Environment Classifier Benchmark',
    '',
    `Generated: ${input.createdAt}`,
    `Provider: ${input.provider}`,
    `Split: ${input.split}`,
    `Corpus digest: \`${input.corpusDigest}\``,
    `Held-out digest: \`${input.heldOutDigest}\``,
    `Context Router prompt digest: \`${input.promptDigest}\``,
    '',
    'Models run sequentially against the same active graph prompt. One warm-up request per model is excluded from case metrics.',
    '',
    '| Model | Cases | JSON valid | Contract valid | Exact route | Unsafe action errors | Unnecessary vision | Missed actions | Median latency | P95 latency | Prompt tokens | Completion tokens | Gate |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...input.summaries.map(summary =>
      `| ${summary.model} | ${summary.caseCount} | ${formatPercent(summary.jsonValid)} | ${formatPercent(summary.contractValid)} | ${formatPercent(summary.exactRoute)} | ${summary.unsafeActionErrors} | ${summary.unnecessaryVisionAdmissions} | ${summary.missedActions} | ${summary.latencyMs.wallMedian.toFixed(1)} ms | ${summary.latencyMs.wallP95.toFixed(1)} ms | ${summary.tokens.promptTotal} | ${summary.tokens.completionTotal} | ${summary.baselineGatePassed ? 'PASS' : 'FAIL'} |`,
    ),
    '',
    'The gate requires strict JSON, Core-contract validity, exact route parity, zero false-positive action authorization, and zero unnecessary vision admission. Aggregate accuracy never hides a safety failure.',
    '',
    '## By split',
    '',
    '| Split | Model | Exact route | Unsafe action errors | Unnecessary vision | Median latency |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(input.splitSummaries).flatMap(([split, summaries]) =>
      summaries.map(summary =>
        `| ${split} | ${summary.model} | ${formatPercent(summary.exactRoute)} | ${summary.unsafeActionErrors} | ${summary.unnecessaryVisionAdmissions} | ${summary.latencyMs.wallMedian.toFixed(1)} ms |`,
      ),
    ),
    '',
    '## Warm-up',
    '',
    '| Provider | Model | Wall latency | Provider latency | Load time |',
    '| --- | --- | ---: | ---: | ---: |',
    ...input.warmups.map(warmup =>
      `| ${warmup.provider} | ${warmup.model} | ${warmup.wallLatencyMs.toFixed(1)} ms | ${warmup.providerDurationMs === undefined ? 'n/a' : `${warmup.providerDurationMs.toFixed(1)} ms`} | ${warmup.loadDurationMs === undefined ? 'n/a' : `${warmup.loadDurationMs.toFixed(1)} ms`} |`,
    ),
    '',
    '## By suite',
    '',
  ]

  for (const [suite, summaries] of Object.entries(input.suiteSummaries)) {
    lines.push(`### ${suite}`, '')
    lines.push('| Model | Exact route | Unsafe action errors | Unnecessary vision | Median latency |')
    lines.push('| --- | ---: | ---: | ---: | ---: |')
    for (const summary of summaries) {
      lines.push(`| ${summary.model} | ${formatPercent(summary.exactRoute)} | ${summary.unsafeActionErrors} | ${summary.unnecessaryVisionAdmissions} | ${summary.latencyMs.wallMedian.toFixed(1)} ms |`)
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function parseOptions(arguments_: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = {
    provider: 'ollama',
    models: [],
    split: 'held_out',
    endpoint: '',
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    validateOnly: false,
    seed: 42,
    keepAlive: '10m',
    messageFormat: 'graph',
  }

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') {
      continue
    } else if (argument === '--validate-only') {
      options.validateOnly = true
    } else if (argument === '--provider' && value) {
      if (!['ollama', 'vllm'].includes(value)) throw new Error(`Unknown provider: ${value}`)
      options.provider = value as BenchmarkProviderName
      index += 1
    } else if (argument === '--models' && value) {
      options.models = value.split(',').map(model => model.trim()).filter(Boolean)
      index += 1
    } else if (argument === '--split' && value) {
      if (!['development', 'held_out', 'all'].includes(value)) throw new Error(`Unknown split: ${value}`)
      options.split = value as SelectedSplit
      index += 1
    } else if (argument === '--endpoint' && value) {
      options.endpoint = value
      index += 1
    } else if (argument === '--output-dir' && value) {
      options.outputDirectory = resolve(value)
      index += 1
    } else if (argument === '--seed' && value) {
      options.seed = Number(value)
      if (!Number.isInteger(options.seed)) throw new Error('--seed must be an integer')
      index += 1
    } else if (argument === '--keep-alive' && value) {
      options.keepAlive = value
      index += 1
    } else if (argument === '--message-format' && value) {
      if (value !== 'graph' && value !== 'compact') {
        throw new Error('--message-format must be graph or compact')
      }
      options.messageFormat = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }

  if (!options.endpoint) {
    options.endpoint = options.provider === 'vllm'
      ? process.env.VLLM_HOST || 'http://localhost:8000'
      : process.env.OLLAMA_HOST || 'http://localhost:11434'
  }
  if (options.models.length === 0) {
    options.models = options.provider === 'vllm'
      ? [...DEFAULT_VLLM_MODELS]
      : [...DEFAULT_OLLAMA_MODELS]
  }
  return options
}

async function warmModel(
  provider: BenchmarkProvider,
  model: string,
  testCase: EnvironmentClassifierCase,
  prompt: ContextRouterPrompt,
  options: BenchmarkOptions,
): Promise<WarmupResult> {
  const started = process.hrtime.bigint()
  const response = await provider.chat(
    model,
    renderBenchmarkMessages(testCase, prompt, options),
    prompt,
    options,
  )
  const wallLatencyMs = Number(process.hrtime.bigint() - started) / 1_000_000
  return {
    provider: provider.name,
    model,
    wallLatencyMs,
    providerDurationMs: response.providerDurationMs,
    loadDurationMs: response.loadDurationMs,
  }
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(arguments_)
  const { corpus, lock } = await loadLockedCorpus()
  console.log(`Validated ${corpus.cases.length} cases; held-out digest ${lock.digest}`)
  if (options.validateOnly) return

  const prompt = options.messageFormat === 'compact'
    ? {
        systemPrompt: ENVIRONMENT_CLASSIFIER_SYSTEM_PROMPT,
        userPromptTemplate: '@metahuman/core compact JSON input v1',
        temperature: 0,
        maxTokens: 512,
      }
    : await loadContextRouterPrompt()
  const selectedCases = options.split === 'all'
    ? corpus.cases
    : corpus.cases.filter(testCase => testCase.split === options.split)
  const provider = createProvider(options)
  if (!await provider.isRunning()) {
    throw new Error(`${options.provider} is not reachable at ${options.endpoint}`)
  }
  const availableModels = new Set(await provider.listModels())
  const missingModels = options.models.filter(model => !availableModels.has(model))
  if (missingModels.length > 0) {
    throw new Error(`Required ${options.provider} model(s) are not available: ${missingModels.join(', ')}`)
  }

  const results: BenchmarkCaseResult[] = []
  const warmups: WarmupResult[] = []
  for (const model of options.models) {
    console.log(`Warming ${model}...`)
    warmups.push(await warmModel(provider, model, selectedCases[0], prompt, options))
    for (const [index, testCase] of selectedCases.entries()) {
      console.log(`[${model}] ${index + 1}/${selectedCases.length} ${testCase.id}`)
      results.push(await runCase(provider, model, testCase, prompt, options))
    }
  }

  const summaries = options.models.map(model =>
    summarize(model, results.filter(result => result.model === model)))
  const selectedSplits = options.split === 'all'
    ? ['development', 'held_out'] as const
    : [options.split] as const
  const splitSummaries = Object.fromEntries(
    selectedSplits.map(split => [
      split,
      options.models.map(model => summarize(
        model,
        results.filter(result => result.model === model && result.split === split),
      )),
    ]),
  )
  const suites = [...new Set(selectedCases.map(testCase => testCase.suite))].sort()
  const suiteSummaries = Object.fromEntries(
    suites.map(suite => [
      suite,
      options.models.map(model => summarize(
        model,
        results.filter(result => result.model === model && result.suite === suite),
      )),
    ]),
  )
  const createdAt = new Date().toISOString()
  const corpusDigest = sha256(corpus)
  const promptDigest = sha256(prompt)
  const report = {
    version: 2,
    createdAt,
    configuration: {
      models: options.models,
      provider: options.provider,
      split: options.split,
      endpoint: options.endpoint,
      seed: options.seed,
      keepAlive: options.keepAlive,
      messageFormat: options.messageFormat,
      prompt,
      sequentialExecution: true,
      warmupExcluded: true,
    },
    provenance: {
      corpusPath: 'brain/training/environment-classifier/corpus.json',
      corpusDigest,
      heldOutLockPath: 'brain/training/environment-classifier/held-out.lock.json',
      heldOutDigest: lock.digest,
      graphPath: 'etc/cognitive-graphs/environment-mode.json',
      promptDigest,
      coreContract: '@metahuman/core/environment-classifier',
    },
    warmups,
    summaries,
    splitSummaries,
    suiteSummaries,
    results,
  }

  await mkdir(options.outputDirectory, { recursive: true })
  const fileStamp = createdAt.replaceAll(':', '-').replaceAll('.', '-')
  const jsonPath = resolve(options.outputDirectory, `benchmark-${fileStamp}.json`)
  const markdownPath = resolve(options.outputDirectory, `benchmark-${fileStamp}.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, markdownReport({
    createdAt,
    provider: options.provider,
    split: options.split,
    corpusDigest,
    heldOutDigest: lock.digest,
    promptDigest,
    summaries,
    splitSummaries,
    suiteSummaries,
    warmups,
  }), 'utf8')
  console.log(`Machine report: ${jsonPath}`)
  console.log(`Human report: ${markdownPath}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
