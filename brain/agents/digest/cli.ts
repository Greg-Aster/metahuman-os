#!/usr/bin/env npx tsx
/**
 * Digest Agent — CLI Entry Point
 *
 * Builds long-term thematic understanding from memories.
 *
 * Usage:
 *   npx tsx brain/agents/digest/cli.ts [options]
 *
 * Options:
 *   --single-user  Process only the default user
 *   --days=N       Number of days to analyze (default: 14)
 */

import { initGlobalLogger, acquireLock, releaseLock, isLocked, audit } from '@metahuman/core';
import { runCycle, type DigestOptions } from './core.js';

const LOCK_NAME = 'agent-digest';

async function main() {
  initGlobalLogger('digest');

  // Acquire lock
  if (isLocked(LOCK_NAME)) {
    console.log('[digest] Another instance is already running. Exiting.');
    process.exit(0);
  }

  if (!acquireLock(LOCK_NAME)) {
    console.log('[digest] Failed to acquire lock. Exiting.');
    process.exit(0);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const options: DigestOptions = {
    singleUser: args.includes('--single-user'),
  };

  // Parse days
  const daysArg = args.find(a => a.startsWith('--days='));
  if (daysArg) {
    options.days = parseInt(daysArg.split('=')[1], 10);
  }

  console.log('[digest] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[digest] Completed: ${result.usersProcessed} users processed`);

    if (result.errors.length > 0) {
      console.error('[digest] Errors:', result.errors);
    }

    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[digest] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      message: `Digest CLI error: ${(error as Error).message}`,
      actor: 'digest',
      metadata: { error: (error as Error).stack },
    });

    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
