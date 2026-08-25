#!/usr/bin/env npx tsx

import { initGlobalLogger } from '@metahuman/core'
import { parseDesireOutcomeReviewerArgs, runCycle } from './core.js'

async function main() {
  initGlobalLogger('desire-outcome-reviewer')
  try {
    const result = await runCycle(parseDesireOutcomeReviewerArgs(process.argv.slice(2)))
    if (result.success) {
      console.log(`[desire-outcome-reviewer] Queued work item ${result.taskId} (${result.state})`)
    } else {
      console.error(`[desire-outcome-reviewer] ${result.errors.join('; ')}`)
    }
    process.exit(result.success ? 0 : 1)
  } catch (error) {
    console.error('[desire-outcome-reviewer] Fatal error:', error)
    process.exit(1)
  }
}

main()
