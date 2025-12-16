#!/usr/bin/env npx tsx
/**
 * Coder Agent — CLI Entry Point
 *
 * Self-healing agent that can modify the OS's own source code.
 *
 * Usage:
 *   npx tsx brain/agents/coder/cli.ts [options]
 *
 * Options:
 *   --username <name>    Process specific user
 *   --single-user        Process only the default user
 *   --maintenance-only   Only run maintenance tasks
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type CoderOptions } from './core.js';

async function main() {
  initGlobalLogger('coder');

  const args = process.argv.slice(2);
  const options: CoderOptions = {
    singleUser: args.includes('--single-user'),
    maintenanceOnly: args.includes('--maintenance-only'),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      options.username = args[i + 1];
      break;
    }
  }

  try {
    const result = await runCycle(options);
    console.log(`[coder] Completed:`, {
      usersProcessed: result.usersProcessed,
      errorsProcessed: result.errorsProcessed,
      fixesGenerated: result.fixesGenerated,
      maintenanceRun: result.maintenanceRun,
    });
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[coder] Fatal error:', error);
    process.exit(1);
  }
}

main();
