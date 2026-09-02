#!/usr/bin/env node
/** Thin CLI adapter for the canonical finite Organizer agent. */

import { getTargetUser, initGlobalLogger } from '@metahuman/core'
import { parseOrganizerArgs, runOrganizer, runOrganizerToCompletion } from './core.js'

async function main(): Promise<void> {
  initGlobalLogger('organizer')
  const parsed = parseOrganizerArgs(
    process.argv.slice(2),
    process.env.MH_TRIGGER_USERNAME,
  )
  const target = getTargetUser({ username: parsed.username })
  if (!target) throw new Error('Organizer requires an existing active or explicitly selected user')

  const execute = parsed.all ? runOrganizerToCompletion : runOrganizer
  const result = await execute({
    username: target.username,
    limit: parsed.limit,
    reprocess: parsed.reprocess,
    all: parsed.all,
    maxBatches: parsed.maxBatches,
  })
  console.log(
    `[organizer] ${target.username}: ${result.totalProcessed} updated, `
    + `${result.totalSkipped} skipped, ${result.totalFailed} failed`,
  )
  if (!result.success) {
    throw new Error(result.errors.join('; ') || 'Organizer execution failed')
  }
}

main().catch(error => {
  console.error('[organizer] Fatal error:', (error as Error).message)
  process.exitCode = 1
})
