#!/usr/bin/env npx tsx
/**
 * Daydreamer Agent — CLI Wrapper
 *
 * Usage:
 *   npx tsx brain/agents/daydreamer/cli.ts
 *
 * Environment:
 *   MH_TRIGGER_USERNAME - Target profile supplied by the Work Coordinator
 *   MH_TASK_ID - Stable Work Coordinator execution identity for retries
 *   MH_TASK_CREATED_AT - Stable Work Coordinator timestamp for retries
 */

import { runCycle } from './core.js';

async function main() {
  console.log('[daydreamer] CLI starting...');

  try {
    const args = process.argv.slice(2);
    if (args.length > 0) {
      throw new Error(`Unknown daydreamer option: ${args[0]}`);
    }

    const result = await runCycle();

    if (result.success) {
      console.log(`[daydreamer] Complete. Generated ${result.daydreamsGenerated} daydreams.`);
      process.exit(0);
    } else {
      console.error('[daydreamer] Failed:', result.errors.join(', '));
      process.exit(1);
    }
  } catch (error) {
    console.error('[daydreamer] Fatal error:', error);
    process.exit(1);
  }
}

main();
