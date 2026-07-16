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
 *   --reprocess    Clear existing tags/entities and regenerate from user content only
 *                  Use this to fix LLM-polluted metadata
 *
 * Environment variables:
 *   MH_TRIGGER_USERNAME  When set (by API), automatically enables single-user mode
 */

import { initGlobalLogger, withUserContext } from '@metahuman/core';
import { runCycle, processUserMemories, type OrganizerOptions } from './core.js';

async function main() {
  initGlobalLogger('organizer');

  // Parse command line args
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  const reprocess = args.includes('--reprocess');

  // Check for trigger username from API (enables single-user mode automatically)
  const triggerUsername = process.env.MH_TRIGGER_USERNAME;
  const singleUser = args.includes('--single-user') || !!triggerUsername;

  const options: OrganizerOptions = {
    singleUser,
    limit,
    reprocess,
  };

  console.log('[organizer] Running single cycle (managed by Trigger Manager)...');
  if (limit) console.log(`[organizer]   Limit: ${limit} memories per user`);
  if (reprocess) console.log('[organizer]   REPROCESS MODE: Regenerating all tags/entities from user content only');

  // If triggered by a specific user via API, only process that user's memories
  if (triggerUsername) {
    console.log(`[organizer]   Mode: single-user (triggered by ${triggerUsername})`);

    const processed = await withUserContext(
      { userId: triggerUsername, username: triggerUsername, role: 'owner' },
      async () => processUserMemories(triggerUsername, options)
    );

    console.log(`[organizer] Done. Processed ${processed} memories for user ${triggerUsername}.`);
    return;
  }

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
