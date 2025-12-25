#!/usr/bin/env tsx
/**
 * Scheduler Service
 *
 * Background service for system maintenance tasks.
 *
 * NOTE: Agent scheduling is now handled by TriggerManager in the unified queue system.
 * The old AgentScheduler is deprecated - TriggerManager starts automatically when
 * Active Operator starts via service-manager.ts → queueSystem.startTriggersOnly().
 *
 * This service now only handles:
 * - Health checks (stale lock cleanup)
 * - Daily log cleanup
 * - Embedding model preload
 */

import { audit, acquireLock, cleanupStaleLocks, initGlobalLogger, purgeOldAuditLogs } from '@metahuman/core';
import { getAgentStatuses } from '@metahuman/core/agent-monitor';
import { preloadEmbeddingModel } from '@metahuman/core/embeddings';

// Health check interval (5 minutes)
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let healthCheckTimer: NodeJS.Timeout | null = null;

// Daily log cleanup interval (24 hours in ms)
const LOG_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
let logCleanupTimer: NodeJS.Timeout | null = null;

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

  // Purge old audit logs on startup
  try {
    purgeOldAuditLogs();
    console.log('[scheduler-service] Old audit logs purged');
  } catch (err) {
    console.warn('[scheduler-service] Failed to purge old logs:', err);
  }

  // Clean up stale locks on startup
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

  // NOTE: Old AgentScheduler is deprecated
  // Agent scheduling is now handled by TriggerManager in the unified queue system
  // TriggerManager starts automatically when Active Operator starts
  console.log('[scheduler-service] Started (maintenance mode - agent triggers handled by TriggerManager)');

  // Start periodic health check
  healthCheckTimer = setInterval(performHealthCheck, HEALTH_CHECK_INTERVAL_MS);
  console.log(`[scheduler-service] Health check scheduled every ${HEALTH_CHECK_INTERVAL_MS / 60000} minutes`);

  // Schedule daily log cleanup
  logCleanupTimer = setInterval(() => {
    try {
      purgeOldAuditLogs();
      console.log('[scheduler-service] Daily log cleanup completed');
    } catch (err) {
      console.warn('[scheduler-service] Daily log cleanup failed:', err);
    }
  }, LOG_CLEANUP_INTERVAL);

  // Preload embedding model in background (don't block startup)
  preloadEmbeddingModel().catch((err) => {
    console.error('[scheduler-service] Failed to preload embedding model:', err);
  });

  // NOTE: Config file watching is now handled by TriggerManager
  // in the unified queue system (packages/core/src/queue/trigger-manager.ts)

  // Graceful shutdown
  const shutdown = () => {
    console.log('[scheduler-service] Shutting down...');
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
    if (logCleanupTimer) {
      clearInterval(logCleanupTimer);
      logCleanupTimer = null;
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[scheduler-service] Fatal error:', err);
  process.exit(1);
});
