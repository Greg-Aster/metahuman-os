#!/usr/bin/env npx tsx
/**
 * Reflector Agent — CLI Entry Point
 *
 * Invokes the editable, persona-aware Reflector graph for the active user.
 *
 * Usage:
 *   npx tsx brain/agents/reflector/cli.ts [options]
 *
 * Options:
 *   --single-user       Process only the active authenticated user
 */

import { initGlobalLogger, audit } from '@metahuman/core';
import { runCycle, type ReflectorOptions } from './core.js';

async function main() {
  initGlobalLogger('reflector');

  // Parse arguments
  const args = process.argv.slice(2);
  const options: ReflectorOptions = {
    singleUser: args.includes('--single-user'),
  };

  console.log('[reflector] Starting with options:', options);

  try {
    const result = await runCycle(options);

    console.log(`[reflector] Completed: ${result.reflectionsGenerated} reflections generated`);

    if (result.errors.length > 0) {
      console.error('[reflector] Errors:', result.errors);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[reflector] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      event: `Reflector CLI error: ${(error as Error).message}`,
      actor: 'reflector',
      details: { error: (error as Error).stack },
    });

    process.exit(1);
  }
}

main();
