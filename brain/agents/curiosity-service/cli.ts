#!/usr/bin/env npx tsx
/**
 * Curiosity Service Agent — CLI Entry Point
 *
 * Monitors user inactivity and asks thoughtful questions.
 *
 * Usage:
 *   npx tsx brain/agents/curiosity-service/cli.ts
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle } from './core.js';

async function main() {
  initGlobalLogger('curiosity-service');

  try {
    const args = process.argv.slice(2);
    if (args.length > 0) throw new Error('Curiosity Service does not accept command-line arguments');
    console.log('[curiosity-service] Starting one coordinator-managed cycle');
    const result = await runCycle();

    console.log(`[curiosity-service] Completed: ${result.questionsAsked} asked, ${result.questionsSkipped} skipped`);

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
