#!/usr/bin/env npx tsx
/**
 * Reflector Agent — CLI Entry Point
 *
 * Invokes the editable, persona-aware Reflector graph for one resolved user.
 *
 * Usage:
 *   npx tsx brain/agents/reflector/cli.ts [options]
 *
 * Options:
 *   --username <name>   Target a specific registered profile
 */

import { audit, initGlobalLogger } from '@metahuman/core'
import { parseReflectorArgs, runReflector } from './core.js'

async function main(): Promise<void> {
  initGlobalLogger('reflector')
  const options = parseReflectorArgs(process.argv.slice(2))

  try {
    const outcome = await runReflector(options)
    console.log(
      outcome.status === 'generated'
        ? `[reflector] Completed: reflection persisted from ${outcome.memoriesConsidered} memories`
        : `[reflector] Skipped: ${outcome.reason}`,
    )
  } catch (error) {
    console.error('[reflector] Fatal error:', error)

    audit({
      category: 'system',
      level: 'error',
      event: 'reflector_cli_failed',
      actor: 'reflector',
      details: { error: (error as Error).message },
    })

    process.exitCode = 1
  }
}

void main()
