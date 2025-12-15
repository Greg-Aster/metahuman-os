#!/usr/bin/env npx tsx
/**
 * Night Pipeline Agent — CLI Entry Point
 *
 * Runs the nightly processing pipeline (dreams, audio, LoRA training).
 *
 * Usage:
 *   npx tsx brain/agents/night-pipeline/cli.ts [options]
 *
 * Options:
 *   --force  Skip condition checks (sleep window, idle time)
 */

import { initGlobalLogger, acquireLock, releaseLock, isLocked, audit } from '@metahuman/core';
import { runCycle, type NightPipelineOptions } from './core.js';

const LOCK_NAME = 'agent-night-pipeline';

async function main() {
  initGlobalLogger('night-pipeline');

  // Acquire lock
  if (isLocked(LOCK_NAME)) {
    console.log('[night-pipeline] Another instance is already running. Exiting.');
    process.exit(0);
  }

  if (!acquireLock(LOCK_NAME)) {
    console.log('[night-pipeline] Failed to acquire lock. Exiting.');
    process.exit(0);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const options: NightPipelineOptions = {
    force: args.includes('--force'),
  };

  console.log('[night-pipeline] Starting with options:', options);

  try {
    const result = await runCycle(options);

    if (result.skipped) {
      console.log(`[night-pipeline] Skipped: ${result.skipReason}`);
    } else {
      console.log('[night-pipeline] Completed');
    }

    if (result.errors.length > 0) {
      console.error('[night-pipeline] Errors:', result.errors);
    }

    releaseLock(LOCK_NAME);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('[night-pipeline] Fatal error:', error);

    audit({
      category: 'system',
      level: 'error',
      message: `Night pipeline CLI error: ${(error as Error).message}`,
      actor: 'night-pipeline',
      metadata: { error: (error as Error).stack },
    });

    releaseLock(LOCK_NAME);
    process.exit(1);
  }
}

main();
