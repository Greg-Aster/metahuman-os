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

const LOG_PREFIX = '[curator]';

async function main(): Promise<void> {
  console.log(`${LOG_PREFIX} ========== main HIT ==========`);
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
    // Validate username for security (alphanumeric + underscore/hyphen only)
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
      console.error(`${LOG_PREFIX} ERROR: Invalid username format. Must be alphanumeric with underscore/hyphen, 1-50 characters.`);
      process.exit(1);
    }
    options.username = username;
  }

  if (!options.username && !options.singleUser) {
    console.error(`${LOG_PREFIX} ERROR: --username <name> is required`);
    console.error(`\nUsage: npx tsx brain/agents/curator/cli.ts --username <username>`);
    console.error(`Or set MH_TRIGGER_USERNAME environment variable`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Starting with options:`, options);

  try {
    const result = await runCycle(options);

    console.log(`${LOG_PREFIX} Completed: ${result.usersProcessed} users processed`);

    if (result.errors.length > 0) {
      console.error(`${LOG_PREFIX} Errors:`, result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);

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
