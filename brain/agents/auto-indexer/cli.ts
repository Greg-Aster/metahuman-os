#!/usr/bin/env node
/**
 * Auto-Indexer Agent — CLI Entry Point
 *
 * Thin wrapper that parses command-line args and calls core logic.
 * Used when running via tsx/process spawn on web/desktop.
 *
 * Command line args:
 *   --force         Force rebuild even if index is recent
 *   --single-user   Only process current user (not multi-user)
 *   --max-age=N     Skip rebuild if index is newer than N hours (default: 24)
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type AutoIndexerOptions } from './core.js';

async function main() {
  initGlobalLogger('auto-indexer');

  // Parse command line args
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const singleUser = args.includes('--single-user');
  const maxAgeArg = args.find(a => a.startsWith('--max-age='));
  const maxAgeHours = maxAgeArg ? parseInt(maxAgeArg.split('=')[1], 10) : 24;

  const options: AutoIndexerOptions = {
    force,
    singleUser,
    maxAgeHours,
  };

  console.log('[auto-indexer] Running index rebuild cycle...');
  if (force) console.log('[auto-indexer]   Mode: forced rebuild');
  if (singleUser) console.log('[auto-indexer]   Mode: single-user');
  console.log(`[auto-indexer]   Max age: ${maxAgeHours} hours`);

  const result = await runCycle(options);

  if (!result.success) {
    console.error('[auto-indexer] Cycle completed with errors:', result.errors.join(', '));
    process.exit(1);
  }

  console.log(`[auto-indexer] Done. Indexed ${result.totalIndexed} items across ${result.userCount} users (${result.skipped} skipped).`);
}

main().catch(err => {
  console.error('[auto-indexer] Fatal error:', err);
  process.exit(1);
});
