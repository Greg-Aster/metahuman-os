/**
 * Night Pipeline Agent — Core Logic
 *
 * Wrapper agent triggered by the scheduler to run the nightly processing pipeline.
 * Checks conditions and orchestrates nightly tasks:
 * - Within sleep window (start/end time from sleep.json)
 * - System is idle (meets minIdleMins threshold)
 * - Dreamer agent
 * - Night processor (audio backlog)
 * - LoRA training pipeline
 *
 * This module provides:
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import { audit } from '@metahuman/core';
import {
  loadSleepConfig,
  isSleepTime,
  isIdle,
  resetDayCounter,
  runNightlyPipeline,
  type SleepConfig,
} from '../sleep-service.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface NightPipelineOptions {
  force?: boolean; // Skip condition checks
}

export interface NightPipelineResult {
  success: boolean;
  skipped: boolean;
  skipReason?: string;
  config?: SleepConfig;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

/**
 * Check if night pipeline should run
 */
export function checkPipelineConditions(config: SleepConfig): {
  canRun: boolean;
  reason?: string;
  inSleepWindow: boolean;
  systemIdle: boolean;
} {
  if (!config.enabled) {
    return { canRun: false, reason: 'sleep_system_disabled', inSleepWindow: false, systemIdle: false };
  }

  const inSleepWindow = isSleepTime(config.window);
  const systemIdle = isIdle(config.minIdleMins);

  if (!inSleepWindow) {
    return { canRun: false, reason: 'not_in_sleep_window', inSleepWindow, systemIdle };
  }

  if (!systemIdle) {
    return { canRun: false, reason: 'system_not_idle', inSleepWindow, systemIdle };
  }

  return { canRun: true, inSleepWindow, systemIdle };
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Run night pipeline cycle (CLI usage)
 */
export async function runCycle(options: NightPipelineOptions = {}): Promise<NightPipelineResult> {
  const result: NightPipelineResult = {
    success: true,
    skipped: false,
    errors: [],
  };

  try {
    console.log('[night-pipeline] Starting nightly pipeline check...');

    const config = loadSleepConfig();
    result.config = config;

    // Check conditions unless forced
    if (!options.force) {
      const conditions = checkPipelineConditions(config);

      console.log(`[night-pipeline] Conditions: sleepWindow=${conditions.inSleepWindow}, idle=${conditions.systemIdle}`);

      if (!conditions.canRun) {
        result.skipped = true;
        result.skipReason = conditions.reason;

        console.log(`[night-pipeline] Skipping: ${conditions.reason}`);

        audit({
          level: 'info',
          category: 'action',
          event: 'night_pipeline_skipped',
          details: {
            reason: conditions.reason,
            window: config.window,
            minIdleMins: config.minIdleMins,
          },
          actor: 'night-pipeline',
        });

        return result;
      }
    }

    console.log('[night-pipeline] All conditions met (or forced), running nightly pipeline');

    // Reset daily counter (e.g., max dreams per night)
    resetDayCounter();

    audit({
      level: 'info',
      category: 'action',
      event: 'night_pipeline_triggered',
      details: {
        window: config.window,
        minIdleMins: config.minIdleMins,
        forced: options.force,
      },
      actor: 'night-pipeline',
    });

    await runNightlyPipeline(config);

    console.log('[night-pipeline] Nightly pipeline completed');

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);

    console.error('[night-pipeline] Failed:', error);

    audit({
      level: 'error',
      category: 'action',
      event: 'night_pipeline_failed',
      details: { error: (error as Error).message },
      actor: 'night-pipeline',
    });

    return result;
  }
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: NightPipelineOptions = {
    force: args.includes('--force') || opts.force === true,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      skipped: result.skipped,
      skipReason: result.skipReason,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
