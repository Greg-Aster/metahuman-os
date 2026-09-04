#!/usr/bin/env npx tsx
/**
 * Audio Organizer Agent — CLI Entry Point
 *
 * Organizes transcribed audio files into episodic memories.
 *
 * Usage:
 *   npx tsx brain/agents/audio-organizer/cli.ts
 */

import { getTargetUser, initGlobalLogger } from '@metahuman/core';
import { runCycle } from './core.js';

const LOG_PREFIX = '[audio-organizer]';

async function main(): Promise<void> {
  initGlobalLogger('audio-organizer');

  try {
    const target = getTargetUser({ username: process.env.MH_TRIGGER_USERNAME })
    if (!target) throw new Error('Audio Organizer requires an existing active or explicitly selected user')
    const result = await runCycle({ username: target.username });
    console.log(`${LOG_PREFIX} Completed: ${result.transcriptsOrganized} organized, ${result.transcriptsFailed} failed`);
    process.exit(result.transcriptsFailed === 0 ? 0 : 1);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  }
}

main();
