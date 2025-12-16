#!/usr/bin/env npx tsx
/**
 * Desire Executor Agent — CLI Entry Point
 *
 * Executes approved desires through the operator system.
 *
 * Usage:
 *   npx tsx brain/agents/desire-executor/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --single-user      Process only the default user
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type DesireExecutorOptions } from './core.js';

async function main() {
  initGlobalLogger('desire-executor');

  const args = process.argv.slice(2);
  const options: DesireExecutorOptions = {
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
    console.log(`[desire-executor] Completed:`, result.stats);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-executor] Fatal error:', error);
    process.exit(1);
  }
}

main();
