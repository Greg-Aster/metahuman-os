import { createHash } from 'node:crypto'

import type { CuratedMemory } from './contracts.js'

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
