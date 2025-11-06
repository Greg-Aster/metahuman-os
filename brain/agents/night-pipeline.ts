#!/usr/bin/env tsx
/**
 * Night Pipeline Agent
 *
 * Wrapper agent triggered by the scheduler to run the nightly processing pipeline.
 *
 * This agent is scheduled by the AgentScheduler at the configured time (from sleep.json),
 * then checks if conditions are met before running the full pipeline:
 * - Within sleep window (start/end time from sleep.json)
 * - System is idle (meets minIdleMins threshold)
 *
 * The actual pipeline orchestration (dreamer, night-processor, LoRA training)
 * is handled by sleep-service.ts functions.
 */

import { audit } from '../../packages/core/src/index.js';
import {
  loadSleepConfig,
  isSleepTime,
  isIdle,
  resetDayCounter,
  runNightlyPipeline
} from './sleep-service.js';

async function main() {
  console.log('[night-pipeline] Starting nightly pipeline check...');

  const config = loadSleepConfig();

  if (!config.enabled) {
    console.log('[night-pipeline] Sleep system disabled in configuration, skipping');
    audit({
      level: 'info',
      category: 'action',
      event: 'night_pipeline_skipped',
      details: { reason: 'sleep_system_disabled' },
      actor: 'night-pipeline',
    });
    return;
  }

  const inSleepWindow = isSleepTime(config.window);
  const systemIdle = isIdle(config.minIdleMins);

  console.log(`[night-pipeline] Conditions: sleepWindow=${inSleepWindow}, idle=${systemIdle}`);

  if (!inSleepWindow) {
    console.log(`[night-pipeline] Not in sleep window (${config.window.start} - ${config.window.end}), skipping`);
    audit({
      level: 'info',
      category: 'action',
      event: 'night_pipeline_skipped',
      details: {
        reason: 'not_in_sleep_window',
        window: config.window,
      },
      actor: 'night-pipeline',
    });
    return;
  }

  if (!systemIdle) {
    const idleTime = Math.floor((Date.now() - Date.now()) / (60 * 1000)); // Approximate
    console.log(`[night-pipeline] System not idle (threshold: ${config.minIdleMins} mins), skipping`);
    audit({
      level: 'info',
      category: 'action',
      event: 'night_pipeline_skipped',
      details: {
        reason: 'system_not_idle',
        minIdleMins: config.minIdleMins,
      },
      actor: 'night-pipeline',
    });
    return;
  }

  console.log('[night-pipeline] All conditions met, running nightly pipeline');

  // Reset daily counter (e.g., max dreams per night)
  resetDayCounter();

  audit({
    level: 'info',
    category: 'action',
    event: 'night_pipeline_triggered',
    details: {
      window: config.window,
      minIdleMins: config.minIdleMins,
    },
    actor: 'night-pipeline',
  });

  await runNightlyPipeline(config);

  console.log('[night-pipeline] Nightly pipeline completed');
}

main().catch(err => {
  console.error('[night-pipeline] Failed:', err);
  audit({
    level: 'error',
    category: 'action',
    event: 'night_pipeline_failed',
    details: { error: (err as Error).message },
    actor: 'night-pipeline',
  });
  process.exit(1);
});
