#!/usr/bin/env npx tsx
/**
 * Ingestor Agent — CLI Entry Point
 *
 * Converts files in memory/inbox into episodic memories.
 *
 * Usage:
 *   npx tsx brain/agents/ingestor/cli.ts [options]
 *
 * Options:
 *   --single-user  Process only the default user
 *   --limit=N      Only process N files per user
 */

import { initGlobalLogger, acquireLock, releaseLock, isLocked, audit } from '@metahuman/core';
import { runCycle, type IngestorOptions } from './core.js';

const LOCK_NAME = 'agent-ingestor';

async function main() {
  initGlobalLogger('ingestor');

  // Acquire lock
  if (isLocked(LOCK_NAME)) {
    console.log('[ingestor] Another instance is already running. Exiting.');
    process.exit(0);
  }

  if (!acquireLock(LOCK_NAME)) {
    console.log('[ingestor] Failed to acquire lock. Exiting.');
    process.exit(0);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const options: IngestorOptions = {
    singleUser: args.includes('--single-user'),
  };

  // Parse limit
  const limitArg = args.find(a => a.startsWith('--limit='));
  if (limitArg) {
    options.limit = parseInt(limitArg.split('=')[1], 10);
  }

  console.log('[ingestor] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[ingestor] Completed: ${result.filesProcessed} files processed`);

    if (result.errors.length > 0) {
      console.error('[ingestor] Errors:', result.errors);
    }

    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[ingestor] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      message: `Ingestor CLI error: ${(error as Error).message}`,
      actor: 'ingestor',
      metadata: { error: (error as Error).stack },
    });

    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
