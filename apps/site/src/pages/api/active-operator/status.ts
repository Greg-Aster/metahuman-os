/**
 * Active Operator Status API
 *
 * GET: Get current active operator status, queue, and metrics
 */

import type { APIRoute } from 'astro';
import {
  getModeController,
  loadActiveOperatorConfig,
  loadActiveOperatorMetrics,
  loadScratchpad,
  loadQueueState,
  getCostSummary,
  getErrorStatus,
  getActiveOperatorServiceStatus,
} from '@metahuman/core/active-operator';

export const GET: APIRoute = async () => {
  try {
    // System-level status - no auth required to read
    const config = loadActiveOperatorConfig();
    const metrics = loadActiveOperatorMetrics();
    const scratchpad = loadScratchpad();
    const queueState = loadQueueState() || [];
    const costSummary = getCostSummary();
    const errorStatus = getErrorStatus();

    // Get mode controller status
    let modeStatus;
    try {
      const controller = getModeController();
      modeStatus = controller.getStatus();
    } catch {
      modeStatus = {
        mode: config.enabled ? 'active' : 'passive',
        isExecuting: false,
        queueLength: queueState.length,
        lastActivityAt: new Date().toISOString(),
        health: 'healthy',
      };
    }

    // Get live service status
    const serviceStatus = getActiveOperatorServiceStatus();

    const status = {
      enabled: config.enabled,
      isRunning: serviceStatus.isRunning,  // Live running state from service manager
      mode: modeStatus.mode,
      isExecuting: modeStatus.isExecuting,
      currentTask: serviceStatus.currentTask || modeStatus.currentTask || null,
      consecutiveTasks: serviceStatus.consecutiveTasks,
      username: serviceStatus.username,
      health: modeStatus.health,
      healthMessage: modeStatus.healthMessage,

      queue: {
        length: queueState.length,
        tasks: queueState.slice(0, 10), // First 10 tasks
        hasUserMessages: queueState.some((t) => t.type === 'user_message'),
      },

      metrics: {
        totalTasksExecuted: metrics.totalTasksExecuted,
        tasksByType: metrics.tasksByType,
        successRate: metrics.totalTasksExecuted > 0
          ? ((metrics.successCount / metrics.totalTasksExecuted) * 100).toFixed(1) + '%'
          : 'N/A',
        averageDurationMs: Math.round(metrics.averageDurationMs),
        startedAt: metrics.startedAt,
      },

      cost: costSummary,

      errors: errorStatus,

      scratchpad: {
        cycleNumber: scratchpad.cycleNumber,
        entriesCount: scratchpad.entries.length,
        recentEntries: scratchpad.entries.slice(-5),
        lastDecision: scratchpad.lastDecision,
        activitySummary: scratchpad.activitySummary,
      },

      config: {
        decisionModel: config.decisionModel,
        cooldownMs: config.cooldownMs,
        maxConsecutiveTasks: config.maxConsecutiveTasks,
        enabledTaskTypes: config.enabledTaskTypes,
        enableSelfHealing: config.enableSelfHealing,
        energyBudget: config.energyBudget,
      },
    };

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[active-operator/status] GET error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
