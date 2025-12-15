#!/usr/bin/env npx tsx
import { initGlobalLogger, acquireLock, releaseLock, isLocked } from '@metahuman/core';
import { runCycle, type CoderOptions } from './core.js';

const LOCK_NAME = 'agent-coder';

async function main() {
  initGlobalLogger('coder');
  if (isLocked(LOCK_NAME)) { console.log('[coder] Another instance running. Exiting.'); process.exit(0); }
  if (!acquireLock(LOCK_NAME)) { console.log('[coder] Failed to acquire lock. Exiting.'); process.exit(0); }

  const args = process.argv.slice(2);
  const options: CoderOptions = {
    singleUser: args.includes('--single-user'),
    maintenanceOnly: args.includes('--maintenance-only'),
  };
  for (let i = 0; i < args.length; i++) { if (args[i] === '--username' && i + 1 < args.length) { options.username = args[i + 1]; break; } }

  try {
    const result = await runCycle(options);
    console.log(`[coder] Completed:`, {
      usersProcessed: result.usersProcessed,
      errorsProcessed: result.errorsProcessed,
      fixesGenerated: result.fixesGenerated,
      maintenanceRun: result.maintenanceRun,
    });
    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[coder] Fatal error:', error);
    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
