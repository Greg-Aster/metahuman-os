#!/usr/bin/env npx tsx
/**
 * Desire Generator Agent — CLI Entry Point
 *
 * Generates desires from persona goals, tasks, memories, and other sources.
 *
 * Usage:
 *   npx tsx brain/agents/desire-generator/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --single-user      Process only the default user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type DesireGeneratorOptions } from './core.js';

async function main() {
  initGlobalLogger('desire-generator');

  // Parse arguments
  const args = process.argv.slice(2);
  const options: DesireGeneratorOptions = {
    singleUser: args.includes('--single-user'),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      options.username = args[i + 1];
      break;
    }
  }

  console.log('[desire-generator] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[desire-generator] Completed: ${result.totalGenerated} desires generated for ${result.usersProcessed} users`);

    if (result.errors.length > 0) {
      console.error('[desire-generator] Errors:', result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-generator] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Desire generator CLI error: ${(error as Error).message}`,
      actor: 'desire-generator',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
