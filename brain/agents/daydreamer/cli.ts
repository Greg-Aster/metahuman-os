#!/usr/bin/env npx tsx
/**
 * Daydreamer Agent — CLI Wrapper
 *
 * Usage:
 *   npx tsx brain/agents/daydreamer/cli.ts [--force]
 *
 * Environment:
 *   MH_TRIGGER_USERNAME - Target user for manual triggers
 */

import { runCycle } from './core.js';

async function main() {
  const args = process.argv.slice(2);
  const forceRun = args.includes('--force');

  console.log('[daydreamer] CLI starting...');

  try {
    const result = await runCycle({ forceRun });

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
