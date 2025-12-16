#!/usr/bin/env npx tsx
/**
 * Inner Curiosity Agent — CLI Entry Point
 *
 * Generates self-directed questions and answers them using local memory.
 *
 * Usage:
 *   npx tsx brain/agents/inner-curiosity/cli.ts [options]
 *
 * Options:
 *   --single-user  Process only the default user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type InnerCuriosityOptions } from './core.js';

async function main() {
  initGlobalLogger('inner-curiosity');

  // Parse arguments
  const args = process.argv.slice(2);
  const options: InnerCuriosityOptions = {
    singleUser: args.includes('--single-user'),
  };

  console.log('[inner-curiosity] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[inner-curiosity] Completed: ${result.questionsGenerated} questions generated`);

    if (result.errors.length > 0) {
      console.error('[inner-curiosity] Errors:', result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[inner-curiosity] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Inner curiosity CLI error: ${(error as Error).message}`,
      actor: 'inner-curiosity',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
