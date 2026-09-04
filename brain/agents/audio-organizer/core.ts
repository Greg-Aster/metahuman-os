import fs from 'node:fs'
import path from 'node:path'

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'
import {
  audit,
  cognitiveGraphPath,
  getFirstFailedNode,
  getUserByUsername,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
  storageClient,
  systemPaths,
  withUserContext,
  type CachedGraphEntry,
  type SafeUser,
  type SvelteFlowGraph,
} from '@metahuman/core'

const LOG_PREFIX = '[audio-organizer]'
const AUDIO_CONFIG_PATH = path.join(systemPaths.etc, 'audio.json')
const GRAPH_FILE = 'audio-organizer.json'
const MAX_METADATA_BYTES = 64 * 1024
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024
const graphCache: Record<string, CachedGraphEntry | null> = {}

interface AudioConfig {
  processing: {
    autoOrganize: boolean
    extractEntities: boolean
    generateSummary: boolean
  }
}

interface TranscriptMetadata {
  audioId: string
  organized?: boolean
  timestamp?: string
}

export interface AudioOrganizerOutcome {
  metadataFile: string
  audioId?: string
  status: 'organized' | 'skipped' | 'failed'
  eventId?: string
  deduplicated?: boolean
  error?: string
}

export interface AudioOrganizerResult {
  success: boolean
  username: string
  transcriptsProcessed: number
  transcriptsOrganized: number
  transcriptsSkipped: number
  transcriptsFailed: number
  outcomes: AudioOrganizerOutcome[]
}

export interface AudioOrganizerOptions {
  username: string
  signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Audio Organizer cancelled', 'AbortError')
}

function loadAudioConfig(): AudioConfig {
  if (!fs.existsSync(AUDIO_CONFIG_PATH)) {
    throw new Error(`Audio Organizer configuration not found: ${AUDIO_CONFIG_PATH}`)
  }
  const value = JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8')) as Record<string, unknown>
  const processing = value.processing
  if (!processing || typeof processing !== 'object' || Array.isArray(processing)) {
    throw new Error('Audio Organizer configuration requires processing settings')
  }
  const record = processing as Record<string, unknown>
  for (const key of ['autoOrganize', 'extractEntities', 'generateSummary']) {
    if (typeof record[key] !== 'boolean') throw new Error(`Audio Organizer processing.${key} must be a boolean`)
  }
  return { processing: record as AudioConfig['processing'] }
}

function readMetadata(metadataPath: string): TranscriptMetadata {
  if (fs.statSync(metadataPath).size > MAX_METADATA_BYTES) {
    throw new Error(`Transcript metadata exceeds ${MAX_METADATA_BYTES} bytes`)
  }
  const value = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
  const audioId = typeof value.audioId === 'string' ? value.audioId.trim() : ''
  if (!audioId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(audioId)) {
    throw new Error('Transcript metadata contains an invalid audioId')
  }
  if (value.organized !== undefined && typeof value.organized !== 'boolean') {
    throw new Error('Transcript metadata organized must be a boolean')
  }
  if (value.timestamp !== undefined
    && (typeof value.timestamp !== 'string' || Number.isNaN(Date.parse(value.timestamp)))) {
    throw new Error('Transcript metadata timestamp must be a valid date')
  }
  return {
    audioId,
    ...(value.organized === true ? { organized: true } : {}),
    ...(typeof value.timestamp === 'string' ? { timestamp: value.timestamp } : {}),
  }
}

async function loadGraph(): Promise<SvelteFlowGraph> {
  const loaded = await loadGraphFile(cognitiveGraphPath(GRAPH_FILE), {
    cache: graphCache,
    cacheKey: GRAPH_FILE,
    logPrefix: LOG_PREFIX,
  })
  if (!loaded) throw new Error(`Audio Organizer graph ${GRAPH_FILE} could not be loaded`)
  return loaded.graph
}

async function executeTranscript(
  user: SafeUser,
  graph: SvelteFlowGraph,
  directory: string,
  metadataFile: string,
  config: AudioConfig,
  signal?: AbortSignal,
): Promise<AudioOrganizerOutcome> {
  const metadataPath = path.join(directory, metadataFile)
  const metadata = readMetadata(metadataPath)
  if (metadata.organized) return { metadataFile, audioId: metadata.audioId, status: 'skipped' }
  const transcriptPath = path.join(directory, `${metadata.audioId}.txt`)
  if (!fs.existsSync(transcriptPath)) throw new Error(`Transcript not found for ${metadata.audioId}`)
  const stat = fs.statSync(transcriptPath)
  if (!stat.isFile()) throw new Error(`Transcript is not a file: ${metadata.audioId}.txt`)
  if (stat.size > MAX_TRANSCRIPT_BYTES) throw new Error(`Transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes`)
  const content = fs.readFileSync(transcriptPath, 'utf8').trim()
  if (!content) throw new Error(`Transcript is empty: ${metadata.audioId}.txt`)
  throwIfAborted(signal)
  const graphState = await runGraph({
    graph,
    signal,
    context: {
      username: user.username,
      userId: user.id,
      cognitiveMode: 'agent',
      allowMemoryWrites: true,
      organizerTimestamp: new Date().toISOString(),
      organizerIncludeSummary: config.processing.generateSummary,
      organizerExtractEntities: config.processing.extractEntities,
      organizerSkipEnrichment: !config.processing.generateSummary && !config.processing.extractEntities,
      audioOrganizerTranscript: {
        audioId: metadata.audioId,
        content,
        metadataFile,
        relativePath: `memory/audio/transcripts/${metadata.audioId}.txt`,
        captureTimestamp: metadata.timestamp || stat.mtime.toISOString(),
      },
      abortSignal: signal,
    },
  })
  throwIfAborted(signal)
  if (graphState.status !== 'completed') {
    const failed = getFirstFailedNode(graphState)
    throw new Error(failed
      ? `Audio Organizer graph failed at ${failed.nodeId}: ${failed.error}`
      : `Audio Organizer graph ended with status ${graphState.status}`)
  }
  const saved = requireGraphNodeOutput(graphState, 'audio_memory_saver')
  if (saved.success !== true || saved.audioId !== metadata.audioId || typeof saved.eventId !== 'string') {
    throw new Error(`Audio Organizer graph did not persist ${metadata.audioId}`)
  }
  return {
    metadataFile,
    audioId: metadata.audioId,
    status: 'organized',
    eventId: saved.eventId,
    deduplicated: saved.deduplicated === true,
  }
}

export async function runCycle(options: AudioOrganizerOptions): Promise<AudioOrganizerResult> {
  const username = options.username?.trim()
  if (!username) throw new Error('Audio Organizer requires a resolved username')
  const user = getUserByUsername(username)
  if (!user) throw new Error(`Audio Organizer profile does not exist: ${username}`)
  const config = loadAudioConfig()
  const result: AudioOrganizerResult = {
    success: false,
    username: user.username,
    transcriptsProcessed: 0,
    transcriptsOrganized: 0,
    transcriptsSkipped: 0,
    transcriptsFailed: 0,
    outcomes: [],
  }
  if (!config.processing.autoOrganize) {
    result.success = true
    return result
  }
  const directoryResult = storageClient.resolvePath({
    username: user.username,
    category: 'voice',
    subcategory: 'transcripts',
  })
  if (!directoryResult.success || !directoryResult.path) {
    throw new Error(`Cannot resolve transcript directory: ${directoryResult.error ?? 'unknown storage error'}`)
  }
  if (!fs.existsSync(directoryResult.path)) {
    result.success = true
    return result
  }
  const graph = await loadGraph()
  const metadataFiles = fs.readdirSync(directoryResult.path)
    .filter(file => file.endsWith('.meta.json'))
    .sort()

  await withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    async () => {
      for (const metadataFile of metadataFiles) {
        throwIfAborted(options.signal)
        try {
          const outcome = await executeTranscript(
            user,
            graph,
            directoryResult.path!,
            metadataFile,
            config,
            options.signal,
          )
          result.outcomes.push(outcome)
        } catch (error) {
          result.outcomes.push({
            metadataFile,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
  )
  result.transcriptsProcessed = result.outcomes.filter(outcome => outcome.status !== 'skipped').length
  result.transcriptsOrganized = result.outcomes.filter(outcome => outcome.status === 'organized').length
  result.transcriptsSkipped = result.outcomes.filter(outcome => outcome.status === 'skipped').length
  result.transcriptsFailed = result.outcomes.filter(outcome => outcome.status === 'failed').length
  result.success = result.transcriptsFailed === 0
  audit({
    category: 'agent',
    level: result.success ? 'info' : 'error',
    event: result.success ? 'audio_organizer_cycle_completed' : 'audio_organizer_cycle_failed',
    actor: 'audio-organizer',
    details: {
      username: user.username,
      transcriptsProcessed: result.transcriptsProcessed,
      transcriptsOrganized: result.transcriptsOrganized,
      transcriptsSkipped: result.transcriptsSkipped,
      transcriptsFailed: result.transcriptsFailed,
    },
  })
  return result
}

export async function run(ctx: AgentContext, _input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now()
  try {
    const result = await runCycle({ username: ctx.username, signal: ctx.signal })
    const errors = result.outcomes
      .filter(outcome => outcome.status === 'failed')
      .map(outcome => `${outcome.metadataFile}: ${outcome.error}`)
    return {
      success: result.success,
      data: result,
      ...(errors.length > 0 ? { errors } : {}),
      durationMs: Date.now() - startTime,
      itemsProcessed: result.transcriptsProcessed,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    }
  }
}
