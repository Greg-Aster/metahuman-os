#!/usr/bin/env npx tsx
/**
 * Train of Thought Agent — CLI Entry Point
 *
 * Performs recursive reasoning by following memory associations.
 *
 * Usage:
 *   npx tsx brain/agents/train-of-thought/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --single-user      Process only the default user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type TrainOfThoughtOptions } from './core.js';

async function main() {
  initGlobalLogger('train-of-thought');

  // Parse arguments
  const args = process.argv.slice(2);
  const options: TrainOfThoughtOptions = {
    singleUser: args.includes('--single-user'),
  };

  // Parse username
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      options.username = args[i + 1];
      break;
    }
  }

  console.log('[train-of-thought] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[train-of-thought] Completed: ${result.usersProcessed} users processed`);

    if (result.errors.length > 0) {
      console.error('[train-of-thought] Errors:', result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[train-of-thought] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Train of thought CLI error: ${(error as Error).message}`,
      actor: 'train-of-thought',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
