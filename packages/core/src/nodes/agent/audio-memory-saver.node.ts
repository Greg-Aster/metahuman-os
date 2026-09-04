import fs from 'node:fs'
import path from 'node:path'

import { captureEventWithDetails } from '../../memory.js'
import { safeWriteJSON } from '../../safe-file.js'
import { storageClient } from '../../storage-client.js'
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

const MAX_SUMMARY_CHARS = 4_000

function shortTranscript(content: string): string {
  return content.length > 200 ? `${content.slice(0, 200)}...` : content
}

const execute: NodeExecutor = async (inputs, context) => {
  const username = typeof context.username === 'string' ? context.username.trim() : ''
  if (!username) throw new Error('Audio memory save requires a resolved username')
  const memory = inputs.memory
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new Error('Audio memory save requires an enriched transcript')
  }
  const audioId = typeof memory.id === 'string' ? memory.id.trim() : ''
  const content = typeof memory.content === 'string' ? memory.content.trim() : ''
  const relativePath = typeof memory.relativePath === 'string' ? memory.relativePath.trim() : ''
  const metadataFile = typeof inputs.metadataFile === 'string' ? inputs.metadataFile.trim() : ''
  const captureTimestamp = typeof inputs.captureTimestamp === 'string'
    ? inputs.captureTimestamp.trim()
    : ''
  if (!audioId || !content || !relativePath || !captureTimestamp
    || Number.isNaN(Date.parse(captureTimestamp))) {
    throw new Error('Audio memory save received incomplete transcript data')
  }
  if (!metadataFile || path.basename(metadataFile) !== metadataFile || !metadataFile.endsWith('.meta.json')) {
    throw new Error('Audio memory save received an unsafe metadata filename')
  }
  const analysis = inputs.analysis && typeof inputs.analysis === 'object' && !Array.isArray(inputs.analysis)
    ? inputs.analysis as Record<string, unknown>
    : {}
  const summary = typeof analysis.summary === 'string'
    ? analysis.summary.trim().slice(0, MAX_SUMMARY_CHARS)
    : ''
  const tags = Array.isArray(memory.tags)
    ? memory.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
    : []
  const entities = Array.isArray(memory.entities)
    ? memory.entities.filter((entity: unknown): entity is string => typeof entity === 'string' && Boolean(entity.trim()))
    : []

  const transcriptDirectory = storageClient.resolvePath({
    username,
    category: 'voice',
    subcategory: 'transcripts',
  })
  if (!transcriptDirectory.success || !transcriptDirectory.path) {
    throw new Error(`Cannot resolve transcript directory: ${transcriptDirectory.error ?? 'unknown storage error'}`)
  }
  const metadataPath = path.join(transcriptDirectory.path, metadataFile)
  if (!fs.existsSync(metadataPath)) throw new Error(`Transcript metadata no longer exists: ${metadataFile}`)
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
  if (metadata.audioId !== audioId) {
    throw new Error(`Transcript metadata ${metadataFile} does not belong to ${audioId}`)
  }

  const capture = captureEventWithDetails(summary || shortTranscript(content), {
    type: 'audio',
    timestamp: new Date(captureTimestamp).toISOString(),
    idempotencyKey: `audio-organizer:${username}:${audioId}`,
    tags: [...new Set(['audio', 'transcript', ...tags])],
    entities,
    links: [{ type: 'source', target: relativePath }],
    metadata: { producer: 'audio-organizer', audioId },
  })
  if (capture.encryptionFallback) {
    throw new Error(capture.encryptionWarning || 'Audio memory encryption was not applied')
  }
  safeWriteJSON(metadataPath, { ...metadata, organized: true })
  return {
    success: true,
    audioId,
    eventId: capture.eventId,
    deduplicated: capture.deduplicated === true,
    encrypted: capture.encrypted,
  }
}

export const AudioMemorySaverNode: NodeDefinition = defineNode({
  id: 'audio_memory_saver',
  name: 'Audio Memory Saver',
  category: 'agent',
  inputs: [
    { name: 'memory', type: 'memory' },
    { name: 'analysis', type: 'object', optional: true },
    { name: 'metadataFile', type: 'string' },
    { name: 'captureTimestamp', type: 'string' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'audioId', type: 'string' },
    { name: 'eventId', type: 'string' },
    { name: 'deduplicated', type: 'boolean' },
    { name: 'encrypted', type: 'boolean' },
  ],
  properties: {},
  description: 'Idempotently captures an enriched transcript through Core memory and marks its source metadata complete',
  execute,
})
