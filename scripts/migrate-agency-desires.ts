#!/usr/bin/env tsx
import { migrateAgencyDesires } from '@metahuman/core'

const args = process.argv.slice(2)
const usernameArg = args.find(arg => arg.startsWith('--username='))
const unknown = args.filter(arg => arg !== '--apply' && !arg.startsWith('--username='))
if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`)
const username = usernameArg?.slice('--username='.length).trim()
if (!username) {
  throw new Error('Usage: pnpm migrate:agency --username=<profile> [--apply]')
}

async function main(username: string): Promise<void> {
  const report = await migrateAgencyDesires({ username, apply: args.includes('--apply') })
  const output = {
    mode: report.apply ? 'apply' : 'dry-run',
    migrationId: report.migrationId,
    username: report.username,
    scanned: report.scanned,
    changed: report.changed,
    applied: report.applied,
    unsafe: report.unsafe,
    wouldActivate: report.activated,
    activationReviewRequired: report.activationReviewRequired,
    statusCounts: report.statusCounts,
    exactTitleDuplicates: report.exactTitleDuplicates,
    duplicateSourceIds: report.duplicateSourceIds,
    changeCounts: report.items.reduce<Record<string, number>>((counts, item) => {
      for (const change of item.changes) counts[change] = (counts[change] || 0) + 1
      return counts
    }, {}),
    warnings: report.items
      .filter(item => item.warnings.length > 0)
      .map(item => ({ desireId: item.id, warnings: item.warnings })),
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

main(username).catch(error => {
  console.error(error)
  process.exitCode = 1
})
