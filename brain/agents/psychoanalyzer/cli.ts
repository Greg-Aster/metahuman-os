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
 * The target user must resolve from --username, MH_TRIGGER_USERNAME, or the
 * canonical active-user resolver. No fabricated default profile is used.
 *
 * Environment variables:
 *   MH_TRIGGER_USERNAME  When set (by API), automatically targets that user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { parsePsychoanalyzerArgs, runCycle } from './core.js';

async function main() {
  initGlobalLogger('psychoanalyzer');

  const args = process.argv.slice(2);
  const triggerUsername = process.env.MH_TRIGGER_USERNAME;
  const options = parsePsychoanalyzerArgs(args);
  options.username ??= triggerUsername;

  console.log('[psychoanalyzer] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[psychoanalyzer] Completed: ${result.usersProcessed} users processed`);

    for (const [username, stats] of Object.entries(result.stats)) {
      if (stats.skipped) {
        console.log(`  - ${username}: skipped (${stats.skipReason})`);
      } else {
        console.log(
          `  - ${username}: ${stats.memoriesAnalyzed} memories, ${stats.changesApplied} applied, ${stats.changesRejected} rejected`,
        );
      }
    }

    if (result.errors.length > 0) {
      console.error('[psychoanalyzer] Errors:', result.errors);
    }

    process.exitCode = result.success ? 0 : 1;
  } catch (error) {
    console.error('[psychoanalyzer] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Psychoanalyzer CLI error: ${(error as Error).message}`,
      actor: 'psychoanalyzer',
      details: { error: (error as Error).stack },
    });

    process.exitCode = 1;
  }
}

main();
