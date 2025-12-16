#!/usr/bin/env npx tsx
/**
 * Desire Outcome Reviewer Agent — CLI Entry Point
 *
 * Reviews completed/failed desires to determine next action.
 *
 * Usage:
 *   npx tsx brain/agents/desire-outcome-reviewer/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --single-user      Process only the default user
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type DesireOutcomeReviewerOptions } from './core.js';

async function main() {
  initGlobalLogger('desire-outcome-reviewer');

  const args = process.argv.slice(2);
  const options: DesireOutcomeReviewerOptions = {
    singleUser: args.includes('--single-user'),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      options.username = args[i + 1];
      break;
    }
  }

  try {
    const result = await runCycle(options);
    console.log(`[desire-outcome-reviewer] Completed:`, result.stats);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-outcome-reviewer] Fatal error:', error);
    process.exit(1);
  }
}

main();
