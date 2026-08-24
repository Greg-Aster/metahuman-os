#!/usr/bin/env npx tsx
/**
 * Audio Organizer Agent — CLI Entry Point
 *
 * Organizes transcribed audio files into episodic memories.
 *
 * Usage:
 *   npx tsx brain/agents/audio-organizer/cli.ts
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle } from './core.js';

const LOG_PREFIX = '[audio-organizer]';

async function main(): Promise<void> {
  initGlobalLogger('audio-organizer');

  try {
    const result = await runCycle();
    console.log(`${LOG_PREFIX} Completed: ${result.transcriptsOrganized} organized, ${result.transcriptsFailed} failed`);
    process.exit(result.transcriptsFailed === 0 ? 0 : 1);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  }
}

main();
