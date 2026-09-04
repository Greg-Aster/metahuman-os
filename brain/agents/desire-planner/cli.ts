#!/usr/bin/env npx tsx
/**
 * Desire Planner Agent — CLI Entry Point
 *
 * Generates plans for desires in 'planning' status.
 *
 * Usage:
 *   npx tsx brain/agents/desire-planner/cli.ts [options]
 *
 * Options:
 *   --username <name>  Process specific user
 *   --desire-id <id>   Process one specific desire
 */

import { initGlobalLogger } from '@metahuman/core';
import { parseDesirePlannerArgs, runCycle } from './core.js';

async function main() {
  initGlobalLogger('desire-planner');

  try {
    const result = await runCycle(parseDesirePlannerArgs(process.argv.slice(2)));
    console.log(`[desire-planner] Completed:`, result.stats);
    if (!result.success) {
      console.error('[desire-planner] Failed:', result.errors.join('; '));
    }
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-planner] Fatal error:', error);
    process.exit(1);
  }
}

main();
