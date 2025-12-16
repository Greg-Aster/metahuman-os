#!/usr/bin/env npx tsx
/**
 * Dreamer Agent — CLI Entry Point
 *
 * Generates surreal dream narratives from memory fragments.
 * Uses cognitive graph workflow for dream generation.
 *
 * Usage:
 *   npx tsx brain/agents/dreamer/cli.ts [options]
 *
 * Options:
 *   --force        Run even if sleep system is disabled
 *   --single-user  Process only the default user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type DreamerOptions } from './core.js';

async function main() {
  initGlobalLogger('dreamer');

  // Parse arguments
  const args = process.argv.slice(2);
  const options: DreamerOptions = {
    forceRun: args.includes('--force'),
    singleUser: args.includes('--single-user'),
  };

  console.log('[dreamer] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[dreamer] Completed: ${result.dreamsGenerated} dreams, ${result.memoriesCurated} memories curated`);

    if (result.errors.length > 0) {
      console.error('[dreamer] Errors:', result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[dreamer] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Dreamer CLI error: ${(error as Error).message}`,
      actor: 'dreamer',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
