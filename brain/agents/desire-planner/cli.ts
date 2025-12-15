#!/usr/bin/env npx tsx
import { initGlobalLogger, acquireLock, releaseLock, isLocked, audit } from '@metahuman/core';
import { runCycle, type DesirePlannerOptions } from './core.js';

const LOCK_NAME = 'agent-desire-planner';

async function main() {
  initGlobalLogger('desire-planner');
  if (isLocked(LOCK_NAME)) { console.log('[desire-planner] Another instance running. Exiting.'); process.exit(0); }
  if (!acquireLock(LOCK_NAME)) { console.log('[desire-planner] Failed to acquire lock. Exiting.'); process.exit(0); }

  const args = process.argv.slice(2);
  const options: DesirePlannerOptions = { singleUser: args.includes('--single-user') };
  for (let i = 0; i < args.length; i++) { if (args[i] === '--username' && i + 1 < args.length) { options.username = args[i + 1]; break; } }

  try {
    const result = await runCycle(options);
    console.log(`[desire-planner] Completed:`, result.stats);
    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[desire-planner] Fatal error:', error);
    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
