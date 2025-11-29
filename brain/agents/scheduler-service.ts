#!/usr/bin/env tsx
/**
 * Scheduler Service
 *
 * Background service that runs the AgentScheduler.
 * Manages all agent triggers (interval, time-of-day, event, activity).
 */

import fs from 'node:fs';
import path from 'node:path';
import { scheduler, paths, audit, acquireLock, initGlobalLogger, purgeOldAuditLogs } from '@metahuman/core';
import { preloadEmbeddingModel } from '@metahuman/core/embeddings';

// Daily log cleanup interval (24 hours in ms)
const LOG_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

async function main() {
  initGlobalLogger('scheduler-service');
  console.log('[scheduler-service] Initializing...');

  // Purge old audit logs on startup
  try {
    purgeOldAuditLogs();
    console.log('[scheduler-service] Old audit logs purged');
  } catch (err) {
    console.warn('[scheduler-service] Failed to purge old logs:', err);
  }

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

  // Preload embedding model in background (don't block startup)
  preloadEmbeddingModel().catch((err) => {
    console.error('[scheduler-service] Failed to preload embedding model:', err);
  });

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

  // Schedule daily log cleanup
  const logCleanupInterval = setInterval(() => {
    try {
      purgeOldAuditLogs();
      console.log('[scheduler-service] Daily log cleanup completed');
    } catch (err) {
      console.warn('[scheduler-service] Daily log cleanup failed:', err);
    }
  }, LOG_CLEANUP_INTERVAL);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[scheduler-service] Shutting down...');
    clearInterval(logCleanupInterval);
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[scheduler-service] Shutting down...');
    clearInterval(logCleanupInterval);
    scheduler.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[scheduler-service] Fatal error:', err);
  process.exit(1);
});
