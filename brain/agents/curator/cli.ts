#!/usr/bin/env npx tsx
/**
 * Curator Agent — CLI Entry Point
 *
 * Prepares clean, persona-friendly training data.
 *
 * Usage:
 *   npx tsx brain/agents/curator/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user (required unless --single-user)
 *   --single-user      Process only the default user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type CuratorOptions } from './core.js';

async function main() {
  initGlobalLogger('curator');

  // Parse arguments
  const args = process.argv.slice(2);
  const options: CuratorOptions = {
    singleUser: args.includes('--single-user'),
  };

  // Try environment variable first, then CLI args
  let username: string | null = process.env.MH_TRIGGER_USERNAME || null;

  if (!username) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--username' && i + 1 < args.length) {
        username = args[i + 1];
        break;
      }
    }
  }

  if (username) {
    options.username = username;
  }

  if (!options.username && !options.singleUser) {
    console.error('[curator] ERROR: --username <name> is required');
    console.error('\nUsage: npx tsx brain/agents/curator/cli.ts --username <username>');
    console.error('Or set MH_TRIGGER_USERNAME environment variable');
    process.exit(1);
  }

  console.log('[curator] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[curator] Completed: ${result.usersProcessed} users processed`);

    if (result.errors.length > 0) {
      console.error('[curator] Errors:', result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[curator] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Curator CLI error: ${(error as Error).message}`,
      actor: 'curator',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
