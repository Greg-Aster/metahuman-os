/**
 * Unified Queue Triggers API
 *
 * GET: Get all registered triggers and their next run times
 */

import type { APIRoute } from 'astro';
import { getQueueSystem } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    // Public read - system-level triggers info, no auth required
    const queueSystem = getQueueSystem();
    const triggers = queueSystem.triggers.getTriggers();

    const triggerList = Array.from(triggers.entries()).map(([id, state]) => ({
      id,
      type: state.config.type,
      enabled: state.config.enabled,
      priority: state.config.priority,
      lastRun: state.lastRun?.toISOString(),
      nextRun: state.nextRun?.toISOString(),
      runCount: state.runCount,
      errorCount: state.errorCount,
      // Type-specific config
      interval: state.config.interval,
      schedule: state.config.schedule,
      inactivityThreshold: state.config.inactivityThreshold,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        triggers: triggerList,
        nextTriggers: queueSystem.getState().nextTriggers,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[unified-queue/triggers] GET error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
