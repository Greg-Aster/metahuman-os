import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import * as storage from '../../storage-client.js'
import { episodicSourceHash } from '../../memory.js'
import { CURATOR_POLICY_VERSION, parseStoredCuratedMemory, type CuratedMemory, type EpisodicMemory } from './contracts.js'

const SUBCATEGORY = 'curated/conversations'
class InvalidCuratedRecordError extends Error {}

export function curatedMemoryDirectory(username: string): string {
  const result = storage.resolvePath({ username, category: 'memory', subcategory: SUBCATEGORY })
  if (!result.success || !result.path) throw new Error(result.error || 'Cannot resolve curated memory storage')
  return result.path
}

function checkFilename(filename: string): void {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(filename) || filename.startsWith('.')) {
    throw new Error('Curated memory filename must be a plain JSON filename')
  }
}

export function readCuratedMemory(username: string, filename: string): CuratedMemory {
  checkFilename(filename)
  const result = storage.readFileSync({
    username, category: 'memory', subcategory: SUBCATEGORY, relativePath: filename, encoding: 'utf8',
  })
  if (!result.success) throw new Error(`Cannot read Curator record ${filename}: ${result.error}`)
  try {
    return parseStoredCuratedMemory(JSON.parse(String(result.data)), `Curator record ${filename}`)
  } catch (error) {
    throw new InvalidCuratedRecordError((error as Error).message)
  }
}

export function writeCuratedMemory(username: string, memory: CuratedMemory): string {
  const validated = parseStoredCuratedMemory(memory)
  if (validated.provenance?.policyVersion !== CURATOR_POLICY_VERSION) {
    throw new Error('New Curator records require current review provenance')
  }
  const filename = curatedRecordFilename(validated)
  checkFilename(filename)
  const result = storage.writeFileSync({
    username, category: 'memory', subcategory: SUBCATEGORY, relativePath: filename,
    data: JSON.stringify(validated, null, 2) + '\n',
  })
  if (!result.success || !result.path) throw new Error(`Cannot save Curator record ${filename}: ${result.error}`)
  return result.path
}

export type CuratedMemoryScanOutcome =
  | { status: 'record'; filename: string; memory: CuratedMemory }
  | { status: 'failed'; filename: string; error: string }

export function* scanCuratedMemories(username: string): Generator<CuratedMemoryScanOutcome> {
  const directory = curatedMemoryDirectory(username)
  if (!fs.existsSync(directory)) return
  const filenames = [...new Set(fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.name.startsWith('.') && /\.json(?:\.enc)?$/.test(entry.name))
    .map(entry => entry.name.replace(/\.enc$/, '')))].sort()
  for (const filename of filenames) {
    try {
      yield { status: 'record', filename, memory: readCuratedMemory(username, filename) }
    } catch (error) {
      yield { status: 'failed', filename, error: (error as Error).message }
    }
  }
}

/** Missing, old or changed decisions are eligible for review again, never for silent reuse. */
export function sourceCurationStatus(username: string, memory: EpisodicMemory): { current: boolean; reason?: string } {
  const metadata = memory.metadata
  if (!metadata?.curated) return { current: false, reason: 'unreviewed' }
  if (metadata.curatorPolicyVersion !== CURATOR_POLICY_VERSION) return { current: false, reason: 'obsolete-policy' }
  const hash = episodicSourceHash(memory)
  if (metadata.curatorSourceHash !== hash) return { current: false, reason: 'source-changed' }
  const filename = metadata.curatorRecordFile
  if (typeof filename !== 'string') return { current: false, reason: 'missing-record-reference' }
  try { checkFilename(filename) } catch { return { current: false, reason: 'invalid-record-reference' } }
  const directory = curatedMemoryDirectory(username)
  if (!fs.existsSync(path.join(directory, filename)) && !fs.existsSync(path.join(directory, filename + '.enc'))) {
    return { current: false, reason: 'missing-record' }
  }
  let record: CuratedMemory
  try {
    record = readCuratedMemory(username, filename)
  } catch (error) {
    if (error instanceof InvalidCuratedRecordError) return { current: false, reason: 'invalid-record' }
    throw error
  }
  if (record.id !== metadata.curatorRecordId || record.provenance?.policyVersion !== CURATOR_POLICY_VERSION
      || record.provenance.sourceHashes[memory.id] !== hash
      || metadata.curationStatus !== (record.suitableForTraining ? 'accepted' : 'rejected')) {
    return { current: false, reason: 'decision-mismatch' }
  }
  return { current: true }
}

export function curatedRecordFilename(
  memory: Pick<CuratedMemory, 'id' | 'originalTimestamp'>,
): string {
  const timestamp = new Date(memory.originalTimestamp)
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Curated memory ${memory.id} has an invalid original timestamp`)
  }
  const date = timestamp.toISOString().slice(0, 10)
  if (/^[A-Za-z0-9._-]{1,120}$/.test(memory.id)) return `${date}-${memory.id}.json`

  const digest = createHash('sha256').update(memory.id).digest('hex').slice(0, 12)
  const safeId = `${encodeURIComponent(memory.id).replace(/%/g, '_').slice(0, 96)}-${digest}`
  if (!safeId) throw new Error(`Curated memory ${memory.id} has an invalid id`)
  return `${date}-${safeId}.json`
}
