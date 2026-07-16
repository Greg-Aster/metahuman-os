#!/usr/bin/env tsx
/**
 * Maintenance Service
 *
 * Persistent owner for stale-lock cleanup, audit-log retention, and embedding
 * preload. Work admission remains exclusively owned by TriggerManager inside
 * the core Work Coordinator.
 */

import { audit, acquireLock, cleanupStaleLocks, initGlobalLogger, purgeOldAuditLogs } from '@metahuman/core';
import { getAgentStatuses } from '@metahuman/core/agent-monitor';
import { preloadEmbeddingModel } from '@metahuman/core/embeddings';

const SERVICE_ID = 'maintenance-service';
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let healthCheckTimer: NodeJS.Timeout | null = null;
let logCleanupTimer: NodeJS.Timeout | null = null;

function performHealthCheck(): void {
  try {
    const staleLocks = cleanupStaleLocks();
    if (staleLocks > 0) {
      console.log(`[${SERVICE_ID}] Health check: cleaned ${staleLocks} stale lock(s)`);
      audit({
        level: 'info',
        category: 'system',
        event: 'health_check_cleanup',
        details: { staleLocks },
        actor: SERVICE_ID,
      });
    }
    getAgentStatuses();
  } catch (error) {
    console.error(`[${SERVICE_ID}] Health check error:`, error);
  }
}

export async function run() {
  let lock;
  try {
    lock = acquireLock('service-maintenance', { exitOnSignal: false });
  } catch {
    throw new Error('Another maintenance-service instance is already running');
  }

  initGlobalLogger(SERVICE_ID);
  console.log(`[${SERVICE_ID}] Initializing...`);

  try {
    purgeOldAuditLogs();
    console.log(`[${SERVICE_ID}] Old audit logs purged`);
  } catch (error) {
    console.warn(`[${SERVICE_ID}] Failed to purge old logs:`, error);
  }

  const cleanedLocks = cleanupStaleLocks();
  if (cleanedLocks > 0) console.log(`[${SERVICE_ID}] Cleaned ${cleanedLocks} stale lock(s) on startup`);

  console.log(`[${SERVICE_ID}] Started (maintenance only; work admission is coordinator-owned)`);
  healthCheckTimer = setInterval(performHealthCheck, HEALTH_CHECK_INTERVAL_MS);
  logCleanupTimer = setInterval(() => {
    try {
      purgeOldAuditLogs();
      console.log(`[${SERVICE_ID}] Daily log cleanup completed`);
    } catch (error) {
      console.warn(`[${SERVICE_ID}] Daily log cleanup failed:`, error);
    }
  }, LOG_CLEANUP_INTERVAL_MS);

  preloadEmbeddingModel().catch(error => console.error(`[${SERVICE_ID}] Failed to preload embedding model:`, error));

  let finishShutdown: (() => void) | undefined;
  const shutdown = () => finishShutdown?.();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await new Promise<void>(resolve => {
      finishShutdown = resolve;
    });
  } finally {
    console.log(`[${SERVICE_ID}] Shutting down...`);
    if (healthCheckTimer) clearInterval(healthCheckTimer);
    if (logCleanupTimer) clearInterval(logCleanupTimer);
    healthCheckTimer = null;
    logCleanupTimer = null;
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    lock.release();
  }
}

export default run;
