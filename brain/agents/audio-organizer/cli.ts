#!/usr/bin/env npx tsx
/**
 * Audio Organizer Agent — CLI Entry Point
 *
 * Organizes transcribed audio files into episodic memories.
 *
 * Usage:
 *   npx tsx brain/agents/audio-organizer/cli.ts [options]
 *
 * Options:
 *   --oneshot  Run once and exit
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type AudioOrganizerOptions } from './core.js';

const LOG_PREFIX = '[audio-organizer]';

async function main(): Promise<void> {
  initGlobalLogger('audio-organizer');
  console.log(`${LOG_PREFIX} ========== main HIT ==========`);

  const args = process.argv.slice(2);
  const options: AudioOrganizerOptions = {
    oneShot: args.includes('--oneshot'),
  };
  console.log(`${LOG_PREFIX} Options: oneShot=${options.oneShot}`);

  try {
    const result = await runCycle(options);
    console.log(`${LOG_PREFIX} Completed: ${result.transcriptsOrganized} organized, ${result.transcriptsFailed} failed`);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  }
}

main();
