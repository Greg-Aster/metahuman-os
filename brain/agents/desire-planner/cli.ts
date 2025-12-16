#!/usr/bin/env npx tsx
/**
 * Desire Planner Agent — CLI Entry Point
 *
 * Generates plans for desires in 'planning' status.
 *
 * Usage:
 *   npx tsx brain/agents/desire-planner/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --single-user      Process only the default user
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type DesirePlannerOptions } from './core.js';

async function main() {
  initGlobalLogger('desire-planner');

  const args = process.argv.slice(2);
  const options: DesirePlannerOptions = {
    singleUser: args.includes('--single-user'),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      options.username = args[i + 1];
      break;
    }
  }

  try {
    const result = await runCycle(options);
    console.log(`[desire-planner] Completed:`, result.stats);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-planner] Fatal error:', error);
    process.exit(1);
  }
}

main();
