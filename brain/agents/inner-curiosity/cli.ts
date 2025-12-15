#!/usr/bin/env npx tsx
/**
 * Inner Curiosity Agent — CLI Entry Point
 *
 * Generates self-directed questions and answers them using local memory.
 *
 * Usage:
 *   npx tsx brain/agents/inner-curiosity/cli.ts [options]
 *
 * Options:
 *   --single-user  Process only the default user
 */

import { initGlobalLogger, acquireLock, releaseLock, isLocked, audit } from '@metahuman/core';
import { runCycle, type InnerCuriosityOptions } from './core.js';

const LOCK_NAME = 'agent-inner-curiosity';

async function main() {
  initGlobalLogger('inner-curiosity');

  // Acquire lock
  if (isLocked(LOCK_NAME)) {
    console.log('[inner-curiosity] Another instance is already running. Exiting.');
    process.exit(0);
  }

  if (!acquireLock(LOCK_NAME)) {
    console.log('[inner-curiosity] Failed to acquire lock. Exiting.');
    process.exit(0);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const options: InnerCuriosityOptions = {
    singleUser: args.includes('--single-user'),
  };

  console.log('[inner-curiosity] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[inner-curiosity] Completed: ${result.questionsGenerated} questions generated`);

    if (result.errors.length > 0) {
      console.error('[inner-curiosity] Errors:', result.errors);
    }

    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[inner-curiosity] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      message: `Inner curiosity CLI error: ${(error as Error).message}`,
      actor: 'inner-curiosity',
      metadata: { error: (error as Error).stack },
    });

    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
