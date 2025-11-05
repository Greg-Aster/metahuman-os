#!/usr/bin/env tsx
/**
 * Scheduler Service
 *
 * Background service that runs the AgentScheduler.
 * Manages all agent triggers (interval, time-of-day, event, activity).
 */

import fs from 'node:fs';
import path from 'node:path';
import { scheduler, paths, audit, acquireLock, initGlobalLogger } from '@metahuman/core';

function main() {
  initGlobalLogger('scheduler-service');
  console.log('[scheduler-service] Initializing...');

  // Single-instance guard
  try {
    acquireLock('service-scheduler');
  } catch {
    console.log('[scheduler-service] Another instance is already running. Exiting.');
    return;
  }

  // Load configuration
  const configLoaded = scheduler.loadConfig();
  if (!configLoaded) {
    console.warn('[scheduler-service] No configuration found, using defaults');
  }

  // Start scheduler
  const started = scheduler.start();
  if (!started) {
    console.error('[scheduler-service] Failed to start scheduler');
    process.exit(1);
  }

  console.log('[scheduler-service] Started successfully');

  // Watch configuration file for changes
  const configPath = path.join(paths.etc, 'agents.json');
  fs.watch(configPath, (eventType) => {
    if (eventType === 'change') {
      console.log('[scheduler-service] Configuration changed, reloading...');
      scheduler.loadConfig();

      audit({
        level: 'info',
        category: 'system',
        event: 'scheduler_config_reloaded',
        actor: 'scheduler-service',
      });
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[scheduler-service] Shutting down...');
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[scheduler-service] Shutting down...');
    scheduler.stop();
    process.exit(0);
  });
}

main();
