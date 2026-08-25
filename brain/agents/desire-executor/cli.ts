#!/usr/bin/env npx tsx
/**
 * Desire Executor Agent — CLI Entry Point
 *
 * Executes approved desires through the operator system.
 *
 * Usage:
 *   npx tsx brain/agents/desire-executor/cli.ts [options]
 *
 * Options:
 *   --username <name>  Execute for a specific profile
 *   --desire-id <id>   Execute one approved desire instead of the approved batch
 */

import { initGlobalLogger } from '@metahuman/core';
import { parseDesireExecutorArgs, runCycle } from './core.js';

async function main() {
  initGlobalLogger('desire-executor');

  const args = process.argv.slice(2);

  try {
    const result = await runCycle(parseDesireExecutorArgs(args));
    if (result.success) {
      console.log(`[desire-executor] Queued work item ${result.taskId} (${result.state})`);
    } else {
      console.error(`[desire-executor] ${result.errors.join('; ')}`);
    }
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-executor] Fatal error:', error);
    process.exit(1);
  }
}

main();
