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

async function main() {
  initGlobalLogger('audio-organizer');

  const args = process.argv.slice(2);
  const options: AudioOrganizerOptions = {
    oneShot: args.includes('--oneshot'),
  };

  try {
    const result = await runCycle(options);
    console.log(`[audio-organizer] Completed: ${result.transcriptsOrganized} organized, ${result.transcriptsFailed} failed`);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[audio-organizer] Fatal error:', error);
    process.exit(1);
  }
}

main();
