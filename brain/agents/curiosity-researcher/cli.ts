#!/usr/bin/env npx tsx
/** Curiosity Researcher scheduled-process entry point. */

import { audit, initGlobalLogger } from '@metahuman/core'
import { parseCuriosityResearcherArgs, runCycle } from './core.js'

const LOG_PREFIX = '[curiosity-researcher]'

async function main(): Promise<void> {
  initGlobalLogger('curiosity-researcher')

  try {
    const options = parseCuriosityResearcherArgs(
      process.argv.slice(2),
      process.env.MH_TRIGGER_USERNAME,
    )
    if (!options.username) throw new Error('--username <name> is required')

    const result = await runCycle(options)
    console.log(`${LOG_PREFIX} Completed ${result.researchCompleted} research item(s)`)
    if (!result.success) process.exitCode = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${LOG_PREFIX} Fatal error: ${message}`)
    audit({
      category: 'system',
      level: 'error',
      event: 'curiosity_researcher_cli_failed',
      actor: 'curiosity-researcher',
      details: { error: message },
    })
    process.exitCode = 1
  }
}

void main()
