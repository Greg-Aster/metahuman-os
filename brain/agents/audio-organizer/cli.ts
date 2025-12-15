#!/usr/bin/env npx tsx
import { initGlobalLogger, acquireLock, releaseLock, isLocked } from '@metahuman/core';
import { runCycle, type AudioOrganizerOptions } from './core.js';

const LOCK_NAME = 'agent-audio-organizer';

async function main() {
  initGlobalLogger('audio-organizer');
  if (isLocked(LOCK_NAME)) { console.log('[audio-organizer] Another instance running. Exiting.'); process.exit(0); }
  if (!acquireLock(LOCK_NAME)) { console.log('[audio-organizer] Failed to acquire lock. Exiting.'); process.exit(0); }

  const args = process.argv.slice(2);
  const options: AudioOrganizerOptions = { oneShot: args.includes('--oneshot') };

  try {
    const result = await runCycle(options);
    console.log(`[audio-organizer] Completed: ${result.transcriptsOrganized} organized, ${result.transcriptsFailed} failed`);
    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[audio-organizer] Fatal error:', error);
    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
