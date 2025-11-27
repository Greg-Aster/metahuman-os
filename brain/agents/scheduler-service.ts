#!/usr/bin/env tsx
/**
 * Scheduler Service
 *
 * Background service that runs the AgentScheduler.
 * Manages all agent triggers (interval, time-of-day, event, activity).
 */

import fs from 'node:fs';
import path from 'node:path';
import { scheduler, paths, audit, acquireLock, cleanupStaleLocks, initGlobalLogger } from '@metahuman/core';
import { getAgentStatuses } from '@metahuman/core/agent-monitor';
import { preloadEmbeddingModel } from '@metahuman/core/embeddings';

// Health check interval (5 minutes)
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let healthCheckTimer: NodeJS.Timeout | null = null;

/**
 * Perform health check: clean up stale locks and dead agent registry entries
 */
function performHealthCheck(): void {
  try {
    // Clean up stale lock files
    const staleLocks = cleanupStaleLocks();
    if (staleLocks > 0) {
      console.log(`[scheduler-service] Health check: cleaned ${staleLocks} stale lock(s)`);
      audit({
        level: 'info',
        category: 'system',
        event: 'health_check_cleanup',
        details: { staleLocks },
        actor: 'scheduler-service',
      });
    }

    // Clean up dead agent registry entries (getAgentStatuses auto-cleans)
    getAgentStatuses();
  } catch (error) {
    console.error('[scheduler-service] Health check error:', error);
  }
}

async function main() {
  initGlobalLogger('scheduler-service');
  console.log('[scheduler-service] Initializing...');

  // Clean up stale files on startup
  console.log('[scheduler-service] Cleaning up stale locks...');
  const cleanedLocks = cleanupStaleLocks();
  if (cleanedLocks > 0) {
    console.log(`[scheduler-service] Cleaned ${cleanedLocks} stale lock(s) on startup`);
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

  // Start periodic health check
  healthCheckTimer = setInterval(performHealthCheck, HEALTH_CHECK_INTERVAL_MS);
  console.log(`[scheduler-service] Health check scheduled every ${HEALTH_CHECK_INTERVAL_MS / 60000} minutes`);

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

  // Graceful shutdown
  const shutdown = () => {
    console.log('[scheduler-service] Shutting down...');
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[scheduler-service] Fatal error:', err);
  process.exit(1);
});
