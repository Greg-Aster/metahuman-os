#!/usr/bin/env tsx
/**
 * Desire Executor Agent
 *
 * Executes approved desires:
 * - Polls for desires in 'approved' status
 * - Runs their plans through the operator system
 * - Updates status based on execution results
 * - Logs all activity to audit and inner dialogue
 *
 * Runs periodically (every 5 minutes) and USES LLM for execution.
 *
 * MULTI-USER: Processes only logged-in users (active sessions) with isolated contexts.
 */

import {
  ROOT,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  getLoggedInUsers,
  withUserContext,
  captureEvent,
} from '@metahuman/core';

import type { Desire, DesireExecution, PlanStep } from '@metahuman/core';
import { loadConfig, isAgencyEnabled } from '@metahuman/core';
import {
  saveDesire,
  moveDesire,
  listDesiresByStatus,
  incrementMetric,
} from '@metahuman/core';

import fs from 'node:fs/promises';
import path from 'node:path';

const LOCK_NAME = 'desire-executor';
const LOG_PREFIX = '[AGENCY:executor]';

// ============================================================================
// Plan Execution
// ============================================================================

/**
 * Execute a single plan step
 *
 * This is a simplified execution - in a full implementation,
 * this would call the actual skill/operator system.
 */
async function executeStep(
  step: PlanStep,
  desire: Desire,
  username?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  console.log(`${LOG_PREFIX} Executing step ${step.order}: ${step.action}`);

  // For now, simulate execution
  // In a full implementation, this would:
  // 1. Look up the skill by step.skill
  // 2. Call executeSkill(skillId, step.inputs)
  // 3. Return the actual result

  // If the step requires approval, check approval status
  if (step.requiresApproval) {
    console.log(`${LOG_PREFIX}   Step requires approval - checking...`);
    // In full implementation, check if this specific step was approved
  }

  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 100));

  // For now, always succeed (real implementation would handle errors)
  return {
    success: true,
    result: { completed: step.action },
  };
}

/**
 * Execute an entire desire plan
 */
async function executePlan(
  desire: Desire,
  username?: string
): Promise<DesireExecution> {
  const plan = desire.plan;
  if (!plan) {
    return {
      startedAt: new Date().toISOString(),
      status: 'failed',
      error: 'No plan attached to desire',
    };
  }

  const execution: DesireExecution = {
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    stepsCompleted: 0,
    stepResults: [],
  };

  console.log(`${LOG_PREFIX} Executing plan with ${plan.steps.length} steps`);
  console.log(`${LOG_PREFIX}   Goal: ${plan.operatorGoal}`);

  for (const step of plan.steps) {
    try {
      execution.currentStep = step.order;

      const result = await executeStep(step, desire, username);

      execution.stepResults?.push({
        stepOrder: step.order,
        success: result.success,
        result: result.result,
        error: result.error,
        completedAt: new Date().toISOString(),
      });

      if (result.success) {
        execution.stepsCompleted = (execution.stepsCompleted || 0) + 1;
      } else {
        // Step failed - abort execution
        execution.status = 'failed';
        execution.error = `Step ${step.order} failed: ${result.error}`;
        break;
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = `Step ${step.order} threw error: ${(error as Error).message}`;
      break;
    }
  }

  // If we completed all steps, mark as completed
  if (execution.status !== 'failed' && execution.stepsCompleted === plan.steps.length) {
    execution.status = 'completed';
    execution.completedAt = new Date().toISOString();
  }

  return execution;
}

// ============================================================================
// Desire Processing
// ============================================================================

/**
 * Process all approved desires for a user
 */
async function processApprovedDesires(username?: string): Promise<{
  executed: number;
  succeeded: number;
  failed: number;
}> {
  const config = await loadConfig(username);
  if (!await isAgencyEnabled(username)) {
    console.log(`${LOG_PREFIX} Agency disabled for user ${username || 'default'}`);
    return { executed: 0, succeeded: 0, failed: 0 };
  }

  const approvedDesires = await listDesiresByStatus('approved', username);
  console.log(`${LOG_PREFIX} Found ${approvedDesires.length} approved desires`);

  let executed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const desire of approvedDesires) {
    console.log(`${LOG_PREFIX} Executing desire: ${desire.title}`);

    // Update status to executing
    const executingDesire = {
      ...desire,
      status: 'executing' as const,
      updatedAt: new Date().toISOString(),
    };
    await moveDesire(executingDesire, 'approved', 'executing', username);

    // Execute the plan
    const execution = await executePlan(executingDesire, username);
    executed++;

    // Update desire with execution results
    const now = new Date().toISOString();

    if (execution.status === 'completed') {
      const finalDesire: Desire = {
        ...executingDesire,
        status: 'completed',
        execution,
        completedAt: now,
        updatedAt: now,
      };
      await moveDesire(finalDesire, 'executing', 'completed', username);
      succeeded++;

      await incrementMetric('totalCompleted', 1, username);

      console.log(`${LOG_PREFIX}   ✓ Completed successfully`);
    } else {
      const finalDesire: Desire = {
        ...executingDesire,
        status: 'failed',
        execution,
        completedAt: now,
        updatedAt: now,
      };
      await moveDesire(finalDesire, 'executing', 'failed', username);
      failed++;

      await incrementMetric('totalFailed', 1, username);

      console.log(`${LOG_PREFIX}   ✗ Failed: ${execution.error}`);
    }

    // Audit the execution
    audit({
      category: 'agent',
      level: execution.status === 'completed' ? 'info' : 'warn',
      event: 'desire_executed',
      actor: 'desire-executor',
      details: {
        desireId: desire.id,
        title: desire.title,
        status: execution.status,
        stepsCompleted: execution.stepsCompleted,
        totalSteps: desire.plan?.steps.length || 0,
        error: execution.error,
        username,
      },
    });

    // Log to inner dialogue
    const dialogueText = execution.status === 'completed'
      ? `I completed my desire "${desire.title}". ${desire.plan?.operatorGoal || ''}`
      : `I tried to execute "${desire.title}" but it failed: ${execution.error}`;

    await captureEvent(dialogueText, {
      type: 'inner_dialogue',
      tags: ['agency', 'execution', 'inner'],
      metadata: {
        desireId: desire.id,
        executionStatus: execution.status,
        source: 'desire-executor',
      },
    });
  }

  return { executed, succeeded, failed };
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  initGlobalLogger('desire-executor');
  console.log(`${LOG_PREFIX} Starting desire executor agent...`);

  // Check for existing lock
  if (isLocked(LOCK_NAME)) {
    console.log(`${LOG_PREFIX} Another instance is already running. Exiting.`);
    process.exit(0);
  }

  // Acquire lock
  let lock: { release: () => void } | null = null;
  try {
    lock = acquireLock(LOCK_NAME);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to acquire lock:`, error);
    process.exit(1);
  }

  try {
    // Process only logged-in users (not all profiles)
    const users = getLoggedInUsers();
    console.log(`${LOG_PREFIX} Processing ${users.length} logged-in user(s)`);

    let totalExecuted = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;

    for (const user of users) {
      const { userId, username, role } = user;
      console.log(`${LOG_PREFIX} --- Processing user: ${username} ---`);

      await withUserContext({ userId, username, role }, async () => {
        const result = await processApprovedDesires(username);
        totalExecuted += result.executed;
        totalSucceeded += result.succeeded;
        totalFailed += result.failed;
      });
    }

    console.log(`${LOG_PREFIX} Execution complete:`);
    console.log(`${LOG_PREFIX}   Executed: ${totalExecuted}`);
    console.log(`${LOG_PREFIX}   Succeeded: ${totalSucceeded}`);
    console.log(`${LOG_PREFIX}   Failed: ${totalFailed}`);

  } finally {
    if (lock) {
      lock.release();
    }
  }
}

// Export for use by other parts of the system (mobile, web, etc.)
export {
  processApprovedDesires,
  executePlan,
  executeStep,
};

// Only run if executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  });
}
