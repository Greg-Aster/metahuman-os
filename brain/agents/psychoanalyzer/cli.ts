#!/usr/bin/env npx tsx
/**
 * Psychoanalyzer Agent — CLI Entry Point
 *
 * Reviews memories and extracts personality insights to update persona.
 *
 * Usage:
 *   npx tsx brain/agents/psychoanalyzer/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --single-user      Process only the default user
 */

import { initGlobalLogger, acquireLock, releaseLock, isLocked, audit } from '@metahuman/core';
import { runCycle, type PsychoanalyzerOptions } from './core.js';

const LOCK_NAME = 'agent-psychoanalyzer';

async function main() {
  initGlobalLogger('psychoanalyzer');

  // Acquire lock
  if (isLocked(LOCK_NAME)) {
    console.log('[psychoanalyzer] Another instance is already running. Exiting.');
    process.exit(0);
  }

  if (!acquireLock(LOCK_NAME)) {
    console.log('[psychoanalyzer] Failed to acquire lock. Exiting.');
    process.exit(0);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const options: PsychoanalyzerOptions = {
    singleUser: args.includes('--single-user'),
  };

  // Parse username
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      options.username = args[i + 1];
      break;
    }
  }

  console.log('[psychoanalyzer] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[psychoanalyzer] Completed: ${result.usersProcessed} users processed`);

    // Summary
    for (const [username, stats] of Object.entries(result.stats)) {
      if (stats.skipped) {
        console.log(`  - ${username}: skipped (${stats.skipReason})`);
      } else {
        console.log(`  - ${username}: ${stats.memoriesAnalyzed} memories, ${stats.changesApplied} changes`);
      }
    }

    if (result.errors.length > 0) {
      console.error('[psychoanalyzer] Errors:', result.errors);
    }

    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[psychoanalyzer] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      message: `Psychoanalyzer CLI error: ${(error as Error).message}`,
      actor: 'psychoanalyzer',
      metadata: { error: (error as Error).stack },
    });

    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
