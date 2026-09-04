import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

const execute: NodeExecutor = async (_inputs, context) => {
  const value = context.audioOrganizerTranscript
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Audio Organizer graph requires a selected transcript')
  }
  const transcript = value as Record<string, unknown>
  const audioId = typeof transcript.audioId === 'string' ? transcript.audioId.trim() : ''
  const content = typeof transcript.content === 'string' ? transcript.content.trim() : ''
  const metadataFile = typeof transcript.metadataFile === 'string' ? transcript.metadataFile.trim() : ''
  const relativePath = typeof transcript.relativePath === 'string' ? transcript.relativePath.trim() : ''
  const captureTimestamp = typeof transcript.captureTimestamp === 'string'
    ? transcript.captureTimestamp.trim()
    : ''
  if (!audioId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(audioId)) {
    throw new Error('Audio Organizer transcript has an invalid audioId')
  }
  if (!content) throw new Error('Audio Organizer transcript content is empty')
  if (!metadataFile || !metadataFile.endsWith('.meta.json')) {
    throw new Error('Audio Organizer transcript has an invalid metadata filename')
  }
  if (!relativePath) throw new Error('Audio Organizer transcript requires a source path')
  if (!captureTimestamp || Number.isNaN(Date.parse(captureTimestamp))) {
    throw new Error('Audio Organizer transcript requires a stable capture timestamp')
  }
  return {
    memory: {
      id: audioId,
      content,
      relativePath,
      tags: ['audio', 'transcript'],
      entities: [],
      metadata: { source: 'audio-organizer' },
    },
    metadataFile,
    captureTimestamp: new Date(captureTimestamp).toISOString(),
  }
}

export const AudioTranscriptInputNode: NodeDefinition = defineNode({
  id: 'audio_transcript_input',
  name: 'Audio Transcript Input',
  category: 'agent',
  inputs: [],
  outputs: [
    { name: 'memory', type: 'memory', description: 'Validated transcript enrichment input' },
    { name: 'metadataFile', type: 'string', description: 'Transcript metadata filename' },
    { name: 'captureTimestamp', type: 'string', description: 'Stable capture timestamp' },
  ],
  properties: {},
  description: 'Accepts one transcript selected by the canonical Audio Organizer agent',
  execute,
})
