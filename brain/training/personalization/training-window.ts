export interface TimestampedTrainingRecord {
  id?: string
  originalTimestamp: string
}

function timestampFor(record: TimestampedTrainingRecord): number {
  const timestamp = Date.parse(record.originalTimestamp)
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Training record ${record.id || 'unknown'} has an invalid originalTimestamp`)
  }
  return timestamp
}

/**
 * Keep every recent record and a bounded, evenly distributed sample of older
 * history. Even spacing makes repeated automatic runs reproducible while still
 * retaining coverage across the profile's older timeline.
 */
export function selectRollingTrainingWindow<T extends TimestampedTrainingRecord>(
  records: T[],
  recentDays: number,
  olderSamples: number,
  now = Date.now(),
): T[] {
  if (!Number.isSafeInteger(recentDays) || recentDays < 1 || recentDays > 36_500) {
    throw new Error('recentDays must be an integer from 1 to 36500')
  }
  if (!Number.isSafeInteger(olderSamples) || olderSamples < 0 || olderSamples > 1_000_000) {
    throw new Error('olderSamples must be an integer from 0 to 1000000')
  }

  const cutoff = now - recentDays * 24 * 60 * 60 * 1000
  const ordered = records
    .map(record => ({ record, timestamp: timestampFor(record) }))
    .sort((left, right) => left.timestamp - right.timestamp)
  const recent = ordered.filter(item => item.timestamp >= cutoff)
  const older = ordered.filter(item => item.timestamp < cutoff)

  if (olderSamples === 0 || older.length === 0) {
    return recent.map(item => item.record)
  }
  if (older.length <= olderSamples) {
    return [...older, ...recent].map(item => item.record)
  }

  const selectedOlder = Array.from({ length: olderSamples }, (_, index) => {
    const position = Math.floor(((index + 0.5) * older.length) / olderSamples)
    return older[Math.min(position, older.length - 1)]!
  })
  return [...selectedOlder, ...recent]
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(item => item.record)
}
