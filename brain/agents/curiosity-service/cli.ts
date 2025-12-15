#!/usr/bin/env npx tsx
/**
 * Curiosity Service Agent — CLI Entry Point
 *
 * Monitors user inactivity and asks thoughtful questions.
 *
 * Usage:
 *   npx tsx brain/agents/curiosity-service/cli.ts [options]
 *
 * Options:
 *   --single-user  Process only the default user
 */

import { initGlobalLogger, acquireLock, releaseLock, isLocked, audit } from '@metahuman/core';
import { runCycle, type CuriosityServiceOptions } from './core.js';

const LOCK_NAME = 'agent-curiosity';

async function main() {
  initGlobalLogger('curiosity-service');

  // Acquire lock
  if (isLocked(LOCK_NAME)) {
    console.log('[curiosity-service] Another instance is already running. Exiting.');
    process.exit(0);
  }

  if (!acquireLock(LOCK_NAME)) {
    console.log('[curiosity-service] Failed to acquire lock. Exiting.');
    process.exit(0);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const options: CuriosityServiceOptions = {
    singleUser: args.includes('--single-user'),
  };

  console.log('[curiosity-service] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[curiosity-service] Completed: ${result.questionsAsked} questions asked`);

    if (result.errors.length > 0) {
      console.error('[curiosity-service] Errors:', result.errors);
    }

    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[curiosity-service] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      message: `Curiosity service CLI error: ${(error as Error).message}`,
      actor: 'curiosity-service',
      metadata: { error: (error as Error).stack },
    });

    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
