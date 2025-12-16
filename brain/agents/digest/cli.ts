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

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type DigestOptions } from './core.js';

async function main() {
  initGlobalLogger('digest');

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

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[digest] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Digest CLI error: ${(error as Error).message}`,
      actor: 'digest',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
