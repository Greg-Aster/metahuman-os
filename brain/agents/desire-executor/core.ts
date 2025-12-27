/**
 * Desire Executor Agent — Core Logic
 *
 * Executes approved desires using the node graph pipeline:
 * - Polls for desires in 'approved' status
 * - Runs their plans through the desire-executor graph
 * - Graph handles: execution → inner dialogue → TTS output
 * - Updates status based on execution results
 * - Logs all activity to audit and inner dialogue
 *
 * Runs periodically (every 5 minutes) and USES LLM for execution.
 *
 * MULTI-USER: Processes only logged-in users (active sessions) with isolated contexts.
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import type { Desire, DesireExecution, PlanStep } from '@metahuman/core';

import {
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  getTargetUser,
  withUserContext,
  captureEvent,
  loadConfig,
  isAgencyEnabled,
  moveDesire,
  listDesiresByStatus,
  incrementMetric,
  createTask,
  updateTaskStatus,
  canAutoApprove,
  loadDecisionRules,
  isClaudeSessionReady,
  sendPrompt,
  startClaudeSession,
  loadOperatorConfig,
  executeWithInterpreter,
  isInterpreterServerRunning,
  // Graph-based execution (single source of truth from @metahuman/core)
  executeDesireViaGraph,
} from '@metahuman/core';

const LOCK_NAME = 'desire-executor';
const LOG_PREFIX = '[AGENCY:executor]';

// Note: executeDesireViaGraph is now imported from @metahuman/core
// This is the single source of truth for graph-based desire execution

// ============================================================================
// Types
// ============================================================================

export interface DesireExecutorOptions {
  singleUser?: boolean;
  username?: string;
}

export interface DesireExecutorResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: {
    executed: number;
    succeeded: number;
    failed: number;
  };
}

// ============================================================================
// Plan Execution
// ============================================================================

/**
 * Build task prompt for execution
 */
function buildTaskPrompt(step: PlanStep, desire: Desire): string {
  return `You are executing a task for MetaHuman OS Agency system.

## Desire Context
**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason || 'Not specified'}

## Current Step (${step.order} of ${desire.plan?.steps?.length || '?'})
**Action**: ${step.action}
**Expected Outcome**: ${step.expectedOutcome || 'Complete successfully'}
**Risk Level**: ${step.risk}
${step.skill ? `**Suggested Approach**: ${step.skill}` : ''}
${step.inputs ? `**Inputs**: ${JSON.stringify(step.inputs, null, 2)}` : ''}
${step.requiresApproval ? '**⚠️ This step requires careful execution**' : ''}

## Instructions
1. Execute this step to completion
2. Be thorough and verify your work
3. Report what you accomplished

Please execute this step now.`;
}

/**
 * Execute step via Big Brother (Claude CLI)
 */
async function executeStepViaClaude(
  step: PlanStep,
  desire: Desire,
  username: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const prompt = buildTaskPrompt(step, desire);

  try {
    if (!isClaudeSessionReady()) {
      console.log(`${LOG_PREFIX}   ⏳ Starting Claude session...`);
      const started = await startClaudeSession();
      if (!started) {
        return { success: false, error: 'Failed to start Claude CLI session' };
      }
    }

    const response = await sendPrompt(prompt, 300000);

    audit({
      level: 'info',
      category: 'agent',
      event: 'desire_step_executed',
      actor: 'desire-executor',
      details: {
        desireId: desire.id,
        stepOrder: step.order,
        action: step.action,
        success: true,
        executedVia: 'claude-cli',
        responseLength: response.length,
        username,
      },
    });

    return {
      success: true,
      result: { claudeResponse: response, executedVia: 'claude-cli', timestamp: new Date().toISOString() },
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'agent',
      event: 'desire_step_failed',
      actor: 'desire-executor',
      details: { desireId: desire.id, stepOrder: step.order, action: step.action, error: (error as Error).message, username },
    });
    return { success: false, error: `Claude CLI execution failed: ${(error as Error).message}` };
  }
}

/**
 * Execute step via Open Interpreter
 */
async function executeStepViaInterpreter(
  step: PlanStep,
  desire: Desire,
  username: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const task = buildTaskPrompt(step, desire);

  try {
    const response = await executeWithInterpreter({ task }, undefined, username);

    if (!response.success) {
      return { success: false, error: response.error || 'Interpreter execution failed' };
    }

    audit({
      level: 'info',
      category: 'agent',
      event: 'desire_step_executed',
      actor: 'desire-executor',
      details: {
        desireId: desire.id,
        stepOrder: step.order,
        action: step.action,
        success: true,
        executedVia: 'open-interpreter',
        username,
      },
    });

    return {
      success: true,
      result: { interpreterResponse: response.finalOutput, messages: response.messages, executedVia: 'open-interpreter', timestamp: new Date().toISOString() },
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'agent',
      event: 'desire_step_failed',
      actor: 'desire-executor',
      details: { desireId: desire.id, stepOrder: step.order, action: step.action, error: (error as Error).message, username },
    });
    return { success: false, error: `Interpreter execution failed: ${(error as Error).message}` };
  }
}

/**
 * Execute a single plan step using the best available backend
 * Priority: Big Brother (if enabled) → Open Interpreter → Error
 */
export async function executeStep(
  step: PlanStep,
  desire: Desire,
  username?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  console.log(`${LOG_PREFIX} 🔧 Executing step ${step.order}: ${step.action}`);

  if (!username) {
    console.log(`${LOG_PREFIX}   ⚠️ No username provided, cannot execute`);
    return { success: false, error: 'No authenticated user for executing desire steps' };
  }

  // Check Big Brother configuration
  const operatorConfig = loadOperatorConfig(username);
  const bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled === true;

  // Try Big Brother first if enabled
  if (bigBrotherEnabled) {
    console.log(`${LOG_PREFIX}   🤖 Using Big Brother (Claude CLI)...`);
    return executeStepViaClaude(step, desire, username);
  }

  // Try Open Interpreter if available
  const interpreterRunning = await isInterpreterServerRunning();
  if (interpreterRunning) {
    console.log(`${LOG_PREFIX}   🐍 Using Open Interpreter...`);
    return executeStepViaInterpreter(step, desire, username);
  }

  // No execution backend available
  console.log(`${LOG_PREFIX}   ❌ No execution backend available`);
  return { success: false, error: 'No execution backend available. Enable Big Brother mode or start Open Interpreter server.' };
}

/**
 * Execute an entire desire plan
 */
export async function executePlan(
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

  console.log(`${LOG_PREFIX} 🚀 Executing plan with ${plan.steps.length} steps via Claude CLI`);
  console.log(`${LOG_PREFIX}    Goal: ${plan.operatorGoal}`);

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
export async function processApprovedDesires(username?: string): Promise<{
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

    // Create a linked task for this desire (Goal-Task-Desire integration)
    let linkedTaskPath: string | undefined;
    try {
      linkedTaskPath = createTask(desire.title, {
        description: desire.description || desire.plan?.operatorGoal || '',
        status: 'in_progress',
        priority: desire.risk === 'high' || desire.risk === 'critical' ? 'P0'
          : desire.risk === 'medium' ? 'P1' : 'P2',
        tags: ['agency', `desire:${desire.id}`, desire.source],
      });
      console.log(`${LOG_PREFIX}   📋 Created linked task: ${linkedTaskPath}`);

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_task_created',
        actor: 'desire-executor',
        details: {
          desireId: desire.id,
          taskPath: linkedTaskPath,
          title: desire.title,
          username,
        },
      });
    } catch (taskError) {
      console.warn(`${LOG_PREFIX}   ⚠ Failed to create linked task:`, taskError);
    }

    // Execute the plan via graph pipeline (handles inner dialogue + TTS output)
    const graphResult = await executeDesireViaGraph(executingDesire, username!);
    const execution = graphResult.execution;
    executed++;

    // Update desire with execution results
    const now = new Date().toISOString();

    // Extract task ID from path for status update
    let linkedTaskId: string | undefined;
    if (linkedTaskPath) {
      const match = linkedTaskPath.match(/([^/]+)\.json$/);
      if (match) {
        linkedTaskId = match[1];
      }
    }

    if (graphResult.success && execution?.status === 'completed') {
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

      // Complete the linked task (Goal-Task-Desire integration)
      if (linkedTaskId) {
        try {
          updateTaskStatus(linkedTaskId, 'done');
          console.log(`${LOG_PREFIX}   ✓ Linked task completed: ${linkedTaskId}`);
        } catch (taskError) {
          console.warn(`${LOG_PREFIX}   ⚠ Failed to complete linked task:`, taskError);
        }
      }

      console.log(`${LOG_PREFIX}   ✓ Completed successfully`);
    } else {
      const errorMessage = graphResult.error || execution?.error || 'Unknown error';
      const finalDesire: Desire = {
        ...executingDesire,
        status: 'failed',
        execution: execution || {
          startedAt: now,
          status: 'failed',
          error: errorMessage,
        },
        completedAt: now,
        updatedAt: now,
      };
      await moveDesire(finalDesire, 'executing', 'failed', username);
      failed++;

      await incrementMetric('totalFailed', 1, username);

      // Cancel the linked task on failure (Goal-Task-Desire integration)
      if (linkedTaskId) {
        try {
          updateTaskStatus(linkedTaskId, 'cancelled');
          console.log(`${LOG_PREFIX}   ✗ Linked task cancelled: ${linkedTaskId}`);
        } catch (taskError) {
          console.warn(`${LOG_PREFIX}   ⚠ Failed to cancel linked task:`, taskError);
        }
      }

      console.log(`${LOG_PREFIX}   ✗ Failed: ${errorMessage}`);
    }

    // Audit the execution
    const executionStatus = execution?.status || 'failed';
    audit({
      category: 'agent',
      level: executionStatus === 'completed' ? 'info' : 'warn',
      event: 'desire_executed',
      actor: 'desire-executor',
      details: {
        desireId: desire.id,
        title: desire.title,
        status: executionStatus,
        stepsCompleted: execution?.stepsCompleted || 0,
        totalSteps: desire.plan?.steps.length || 0,
        error: graphResult.error || execution?.error,
        username,
        usedGraphPipeline: true,
      },
    });

    // Note: Inner dialogue and TTS are now handled by the graph pipeline
    // The inner_dialogue_capture and tts nodes in the graph handle this automatically
  }

  return { executed, succeeded, failed };
}

/**
 * Process desires stuck in 'reviewing' status
 * Checks trust level to determine: auto-approve (high trust) vs await approval (low trust)
 */
export async function processReviewingDesires(username?: string): Promise<{
  transitioned: number;
  autoApproved: number;
}> {
  if (!await isAgencyEnabled(username)) {
    return { transitioned: 0, autoApproved: 0 };
  }

  const reviewingDesires = await listDesiresByStatus('reviewing', username);
  console.log(`${LOG_PREFIX} Found ${reviewingDesires.length} desires stuck in reviewing status`);

  let transitioned = 0;
  let autoApproved = 0;

  // Get user's current trust level
  let currentTrustLevel = 'supervised_auto';
  try {
    const rules = loadDecisionRules();
    currentTrustLevel = rules.trustLevel;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not load decision rules, using default trust level`);
  }
  console.log(`${LOG_PREFIX} Current trust level: ${currentTrustLevel}`);

  for (const desire of reviewingDesires) {
    const risk = desire.plan?.estimatedRisk || 'medium';
    const strength = desire.strength || 0.5;

    // Check if trust allows auto-approval (pass desire for maturity-based trust degradation)
    const approvalResult = await canAutoApprove(risk, strength, currentTrustLevel, username, desire);
    const degradationInfo = approvalResult.trustDegradation
      ? ` (trust degraded: ${approvalResult.trustDegradation.reduction} levels)`
      : '';
    console.log(`${LOG_PREFIX} Auto-approve check for "${desire.title}": risk=${risk}, strength=${strength.toFixed(2)}, trust=${currentTrustLevel}${degradationInfo} → ${approvalResult.autoApprove ? 'AUTO' : 'MANUAL'}`);

    const now = new Date().toISOString();

    if (approvalResult.autoApprove) {
      // Trust level allows auto-approval - move directly to 'approved'
      const updatedDesire = {
        ...desire,
        status: 'approved' as const,
        approvedAt: now,
        updatedAt: now,
        autoApproved: true,
        autoApproveReason: approvalResult.reason,
      };

      try {
        await moveDesire(updatedDesire, 'reviewing', 'approved', username);
        autoApproved++;

        audit({
          category: 'agent',
          level: 'info',
          event: 'desire_auto_approved',
          actor: 'desire-executor',
          details: {
            desireId: desire.id,
            title: desire.title,
            from: 'reviewing',
            to: 'approved',
            reason: approvalResult.reason,
            trustLevel: currentTrustLevel,
            risk,
            username,
          },
        });

        // Log to inner dialogue
        await captureEvent(
          `Auto-approved "${desire.title}" based on trust level (${currentTrustLevel}). Reason: ${approvalResult.reason}`,
          {
            type: 'inner_dialogue',
            tags: ['agency', 'auto-approval', 'trust', 'inner'],
            metadata: {
              desireId: desire.id,
              source: 'desire-executor',
              trustLevel: currentTrustLevel,
              risk,
            },
          }
        );

        console.log(`${LOG_PREFIX}   ✓ Auto-approved: ${desire.title}`);
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to auto-approve desire ${desire.id}:`, error);
      }
    } else {
      // Trust level requires manual approval - move to 'awaiting_approval'
      const updatedDesire = {
        ...desire,
        status: 'awaiting_approval' as const,
        updatedAt: now,
      };

      try {
        await moveDesire(updatedDesire, 'reviewing', 'awaiting_approval', username);
        transitioned++;

        audit({
          category: 'agent',
          level: 'info',
          event: 'desire_status_transition',
          actor: 'desire-executor',
          details: {
            desireId: desire.id,
            title: desire.title,
            from: 'reviewing',
            to: 'awaiting_approval',
            reason: approvalResult.reason,
            trustLevel: currentTrustLevel,
            risk,
            username,
          },
        });

        // Log to inner dialogue
        await captureEvent(
          `I need your approval for "${desire.title}". ${approvalResult.reason}. Please review it in the Agency tab.`,
          {
            type: 'inner_dialogue',
            tags: ['agency', 'approval-request', 'inner'],
            metadata: {
              desireId: desire.id,
              source: 'desire-executor',
              trustLevel: currentTrustLevel,
              risk,
            },
          }
        );

        console.log(`${LOG_PREFIX}   → Needs approval: ${desire.title} (${approvalResult.reason})`);
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to transition desire ${desire.id}:`, error);
      }
    }
  }

  return { transitioned, autoApproved };
}

// ============================================================================
// Agent Runtime Entry Points
// ============================================================================

/**
 * Run a single execution cycle - entry point for CLI and scheduler
 */
export async function runCycle(options: DesireExecutorOptions = {}): Promise<DesireExecutorResult> {
  const result: DesireExecutorResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: { executed: 0, succeeded: 0, failed: 0 },
  };

  try {
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    let user = getTargetUser(options);
    if (!user && options.singleUser) {
      user = { userId: 'default', username: 'default', role: 'owner' };
    }

    if (!user) {
      console.log(`${LOG_PREFIX} No active user found`);
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${user.username}`);

    try {
      console.log(`${LOG_PREFIX} --- Processing user: ${user.username} ---`);
      await withUserContext(user, async () => {
        // First, check reviewing desires - auto-approve if trust allows, else queue for approval
        const reviewResult = await processReviewingDesires(user!.username);
        if (reviewResult.autoApproved > 0) {
          console.log(`${LOG_PREFIX} Auto-approved ${reviewResult.autoApproved} desires (trust-based)`);
        }
        if (reviewResult.transitioned > 0) {
          console.log(`${LOG_PREFIX} Transitioned ${reviewResult.transitioned} desires to awaiting_approval`);
        }

        // Then, execute approved desires
        const r = await processApprovedDesires(user!.username);
        result.stats.executed += r.executed;
        result.stats.succeeded += r.succeeded;
        result.stats.failed += r.failed;
      });
      result.usersProcessed++;
    } catch (error) {
      result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
    }

    console.log(`${LOG_PREFIX} Execution complete:`);
    console.log(`${LOG_PREFIX}   Executed: ${result.stats.executed}`);
    console.log(`${LOG_PREFIX}   Succeeded: ${result.stats.succeeded}`);
    console.log(`${LOG_PREFIX}   Failed: ${result.stats.failed}`);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_executor_completed',
      actor: 'desire-executor',
      details: { ...result.stats, usersProcessed: result.usersProcessed },
    });

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    return result;
  }
}

/**
 * Agent runtime entry point - used by mobile and scheduler
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: DesireExecutorOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: result.stats,
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// CLI Entry Point (for direct execution)
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
    const result = await runCycle();

    if (!result.success) {
      console.error(`${LOG_PREFIX} Errors:`, result.errors);
      process.exit(1);
    }
  } finally {
    if (lock) {
      lock.release();
    }
  }
}

// Only run if executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  });
}
