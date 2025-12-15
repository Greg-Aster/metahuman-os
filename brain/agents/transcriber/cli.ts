#!/usr/bin/env npx tsx
import { initGlobalLogger, acquireLock, releaseLock, isLocked } from '@metahuman/core';
import { runCycle, type TranscriberOptions } from './core.js';

const LOCK_NAME = 'agent-transcriber';

async function main() {
  initGlobalLogger('transcriber');
  if (isLocked(LOCK_NAME)) { console.log('[transcriber] Another instance running. Exiting.'); process.exit(0); }
  if (!acquireLock(LOCK_NAME)) { console.log('[transcriber] Failed to acquire lock. Exiting.'); process.exit(0); }

  const args = process.argv.slice(2);
  const options: TranscriberOptions = { oneShot: args.includes('--oneshot') };

  try {
    const result = await runCycle(options);
    console.log(`[transcriber] Completed: ${result.filesTranscribed} transcribed, ${result.filesFailed} failed`);
    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[transcriber] Fatal error:', error);
    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
