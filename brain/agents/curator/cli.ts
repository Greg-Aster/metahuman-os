#!/usr/bin/env npx tsx
/**
 * Curator Agent — CLI Entry Point
 *
 * Prepares clean, persona-friendly training data.
 *
 * Usage:
 *   npx tsx brain/agents/curator/cli.ts [options]
 *
 * Options:
 *   --username <name>     Process a specific user (required unless --single-user)
 *   --single-user         Process only the currently resolved user
 *   --all                 Drain all available batches instead of one bounded batch
 *   --limit <count>       Memories per batch (1-500, default 20)
 *   --max-batches <count> Safety bound for --all (default 100)
 *   --temperature <0-1>  Curator LLM temperature
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { parseCuratorArgs, runCycle } from './core.js';

const LOG_PREFIX = '[curator]';

async function main(): Promise<void> {
  initGlobalLogger('curator');

  try {
    const args = process.argv.slice(2);
    const options = parseCuratorArgs(args, process.env.MH_TRIGGER_USERNAME);

    if (!options.username && !options.singleUser) {
      throw new Error('--username <name> is required unless --single-user is used');
    }

    console.log(`${LOG_PREFIX} Starting with options:`, options);

    const result = await runCycle(options);

    console.log(`${LOG_PREFIX} Completed: ${result.usersProcessed} user profile processed`);

    if (result.errors.length > 0) {
      console.error(`${LOG_PREFIX} Errors:`, result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);

    audit({
      category: 'system',
      level: 'error',
      event: `Curator CLI error: ${(error as Error).message}`,
      actor: 'curator',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
