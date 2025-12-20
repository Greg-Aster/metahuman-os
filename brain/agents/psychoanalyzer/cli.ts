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
 *
 * Environment variables:
 *   MH_TRIGGER_USERNAME  When set (by API), automatically targets that user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type PsychoanalyzerOptions } from './core.js';

async function main() {
  initGlobalLogger('psychoanalyzer');

  // Parse arguments
  const args = process.argv.slice(2);

  // Check for trigger username from API (enables single-user mode automatically)
  const triggerUsername = process.env.MH_TRIGGER_USERNAME;

  const options: PsychoanalyzerOptions = {
    singleUser: args.includes('--single-user') || !!triggerUsername,
    username: triggerUsername, // Use trigger username if set
  };

  // Parse username from CLI args (overrides trigger username if provided)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      options.username = args[i + 1];
      break;
    }
  }

  if (triggerUsername && !args.includes('--username')) {
    console.log(`[psychoanalyzer] Mode: single-user (triggered by ${triggerUsername})`);
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

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[psychoanalyzer] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Psychoanalyzer CLI error: ${(error as Error).message}`,
      actor: 'psychoanalyzer',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
