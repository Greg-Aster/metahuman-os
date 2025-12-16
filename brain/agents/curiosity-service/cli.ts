#!/usr/bin/env npx tsx
/**
 * Curiosity Service Agent — CLI Entry Point
 *
 * Monitors user inactivity and asks thoughtful questions.
 *
 * Usage:
 *   npx tsx brain/agents/curiosity-service/cli.ts [options]
 *
 * Options:
 *   --single-user  Process only the default user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type CuriosityServiceOptions } from './core.js';

async function main() {
  initGlobalLogger('curiosity-service');

  // Parse arguments
  const args = process.argv.slice(2);
  const options: CuriosityServiceOptions = {
    singleUser: args.includes('--single-user'),
  };

  console.log('[curiosity-service] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[curiosity-service] Completed: ${result.questionsAsked} questions asked`);

    if (result.errors.length > 0) {
      console.error('[curiosity-service] Errors:', result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[curiosity-service] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Curiosity service CLI error: ${(error as Error).message}`,
      actor: 'curiosity-service',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
