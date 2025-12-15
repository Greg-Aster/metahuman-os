#!/usr/bin/env node
/**
 * Organizer Agent — CLI Entry Point
 *
 * Thin wrapper that parses command-line args and calls core logic.
 * Used when running via tsx/process spawn on web/desktop.
 *
 * Command line args:
 *   --limit=N      Only process N memories per user
 *   --single-user  Only process current user (not multi-user)
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type OrganizerOptions } from './core.js';

async function main() {
  initGlobalLogger('organizer');

  // Parse command line args
  const args = process.argv.slice(2);
  const singleUser = args.includes('--single-user');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  const options: OrganizerOptions = {
    singleUser,
    limit,
  };

  console.log('[organizer] Running single cycle (managed by scheduler)...');
  if (limit) console.log(`[organizer]   Limit: ${limit} memories per user`);
  if (singleUser) console.log('[organizer]   Mode: single-user');

  const result = await runCycle(options);

  if (!result.success) {
    console.error('[organizer] Cycle completed with errors:', result.errors.join(', '));
    process.exit(1);
  }

  console.log(`[organizer] Done. Processed ${result.totalProcessed} memories across ${result.userCount} users.`);
}

main().catch(err => {
  console.error('[organizer] Fatal error:', err);
  process.exit(1);
});
