#!/usr/bin/env npx tsx
/**
 * Curiosity Researcher Agent — CLI Entry Point
 *
 * Performs deeper research on curiosity questions.
 *
 * Usage:
 *   npx tsx brain/agents/curiosity-researcher/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --single-user      Process only the default user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type CuriosityResearcherOptions } from './core.js';

const LOG_PREFIX = '[curiosity-researcher]';

async function main(): Promise<void> {
  initGlobalLogger('curiosity-researcher');
  console.log(`${LOG_PREFIX} ========== main HIT ==========`);

  // Parse arguments
  const args = process.argv.slice(2);
  const options: CuriosityResearcherOptions = {
    singleUser: args.includes('--single-user'),
  };

  // Parse username
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      const username = args[i + 1];
      // Validate username for security (alphanumeric, underscore, hyphen only)
      if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
        console.error(`${LOG_PREFIX} Invalid username: ${username}`);
        process.exit(1);
      }
      options.username = username;
      break;
    }
  }

  console.log(`${LOG_PREFIX} Starting with options:`, options);

  try {
    const result = await runCycle(options);

    console.log(`${LOG_PREFIX} Completed: ${result.researchCompleted} research tasks`);

    if (result.errors.length > 0) {
      console.error(`${LOG_PREFIX} Errors:`, result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);

    audit({
      category: 'system',
      level: 'error',
      event: `Curiosity researcher CLI error: ${(error as Error).message}`,
      actor: 'curiosity-researcher',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
