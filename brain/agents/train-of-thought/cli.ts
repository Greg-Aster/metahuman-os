#!/usr/bin/env npx tsx
/**
 * Train of Thought Agent — CLI Entry Point
 *
 * Performs recursive reasoning by following memory associations.
 *
 * Usage:
 *   npx tsx brain/agents/train-of-thought/cli.ts [options]
 *
 * Options:
 *   --username <name>       Process one registered profile
 *   --seed <text>           Continue from an explicit thought or result
 *   --source-agent <name>   Record the upstream agent identity
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { parseTrainOfThoughtArgs, runTrainOfThought } from './core.js';

async function main() {
  initGlobalLogger('train-of-thought');

  try {
    const options = parseTrainOfThoughtArgs(process.argv.slice(2));
    const outcome = await runTrainOfThought(options);
    console.log(
      outcome.status === 'generated'
        ? `[train-of-thought] Completed: ${outcome.thoughtCount} thoughts persisted`
        : `[train-of-thought] Skipped: ${outcome.reason}`,
    );
  } catch (error) {
    console.error('[train-of-thought] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Train of thought CLI error: ${(error as Error).message}`,
      actor: 'train-of-thought',
      details: { error: (error as Error).stack },
    });

    process.exitCode = 1;
  }
}

void main();
