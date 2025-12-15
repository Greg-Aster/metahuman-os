#!/usr/bin/env npx tsx
/**
 * Reflector Agent — CLI Entry Point
 *
 * Generates internal reflections from associative memory chains.
 * Saves as inner_dialogue type (never shown in main chat).
 *
 * Usage:
 *   npx tsx brain/agents/reflector/cli.ts [options]
 *
 * Options:
 *   --train-of-thought  Use recursive train-of-thought mode
 *   --chain=N           Set chain length (default: random 3-5)
 *   --single-user       Process only the default user
 */

import { initGlobalLogger, acquireLock, releaseLock, audit } from '@metahuman/core';
import { runCycle, type ReflectorOptions } from './core.js';

const LOCK_NAME = 'agent-reflector';

async function main() {
  initGlobalLogger('reflector');

  // Acquire lock
  if (!acquireLock(LOCK_NAME)) {
    console.log('[reflector] Another instance is already running. Exiting.');
    process.exit(0);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const options: ReflectorOptions = {
    useTrainOfThought: args.includes('--train-of-thought'),
    singleUser: args.includes('--single-user'),
  };

  // Parse chain length
  const chainArg = args.find(a => a.startsWith('--chain='));
  if (chainArg) {
    options.chainLength = parseInt(chainArg.split('=')[1], 10);
  }

  console.log('[reflector] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[reflector] Completed: ${result.reflectionsGenerated} reflections generated`);

    if (result.errors.length > 0) {
      console.error('[reflector] Errors:', result.errors);
    }

    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[reflector] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      message: `Reflector CLI error: ${(error as Error).message}`,
      actor: 'reflector',
      metadata: { error: (error as Error).stack },
    });

    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
