#!/usr/bin/env npx tsx
/**
 * Desire Explorer Agent - CLI Entry Point
 *
 * Explores activated desires before planning so downstream planners have
 * research context and user-specific clarifying questions.
 */

import { initGlobalLogger } from '@metahuman/core';
import { runDesireExplorer, type DesireExplorerOptions } from './core.js';

async function main() {
  initGlobalLogger('desire-explorer');

  const args = process.argv.slice(2);
  const options: DesireExplorerOptions = {
    singleUser: args.includes('--single-user'),
  };

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--username' && args[index + 1]) {
      options.username = args[index + 1];
      break;
    }
  }

  try {
    const result = await runDesireExplorer(options);
    console.log('[desire-explorer] Completed:', result.stats);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-explorer] Fatal error:', error);
    process.exit(1);
  }
}

main();
