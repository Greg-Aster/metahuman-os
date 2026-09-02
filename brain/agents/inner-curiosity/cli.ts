#!/usr/bin/env npx tsx
/**
 * Inner Curiosity Agent — CLI Entry Point
 *
 * Generates self-directed questions and answers them using local memory.
 *
 * The Work Coordinator supplies profile and execution identity through its
 * process environment. This entry point intentionally has no private options.
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { parseInnerCuriosityArgs, runCycle } from './core.js';

async function main() {
  initGlobalLogger('inner-curiosity');

  try {
    const options = parseInnerCuriosityArgs(process.argv.slice(2));
    const result = await runCycle(options);

    console.log(
      `[inner-curiosity] Completed: ${result.questionsGenerated} generated, ${result.questionsSkipped} skipped`,
    );

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
