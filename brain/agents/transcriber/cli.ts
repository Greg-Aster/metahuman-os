#!/usr/bin/env npx tsx
/**
 * Transcriber Agent — CLI Entry Point
 *
 * Transcribes audio files using whisper.cpp.
 *
 * Usage:
 *   npx tsx brain/agents/transcriber/cli.ts [options]
 *
 * Options:
 *   --oneshot  Run once and exit
 */

import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type TranscriberOptions } from './core.js';

async function main() {
  initGlobalLogger('transcriber');

  const args = process.argv.slice(2);
  const options: TranscriberOptions = {
    oneShot: args.includes('--oneshot'),
  };

  try {
    const result = await runCycle(options);
    console.log(`[transcriber] Completed: ${result.filesTranscribed} transcribed, ${result.filesFailed} failed`);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[transcriber] Fatal error:', error);
    process.exit(1);
  }
}

main();
