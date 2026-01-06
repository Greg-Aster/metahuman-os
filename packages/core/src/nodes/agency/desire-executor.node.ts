/**
 * Desire Executor Node
 *
 * Executes a desire's plan by routing each step through the Big Brother operator.
 * This is where desires become REAL ACTIONS.
 *
 * Inputs:
 *   - desire: Desire object with approved plan
 *   - userContext: { userId, cognitiveMode }
 *
 * Outputs:
 *   - execution: DesireExecution object with step results
 *   - success: boolean
 *   - error?: string
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesireExecution, PlanStep } from '../../agency/types.js';
import type { DesireProgressCallback } from '../../agency/executor.js';
import {
  saveExecutionToFolder,
  saveDesireManifest,
  addScratchpadEntryToFolder,
} from '../../agency/storage.js';
import { appendExecutionProgressToBuffer } from '../../conversation-buffer.js';
import {
  escalate,
  getActiveBackend,
  ensureBackendsInitialized,
} from '../../escalation-backend.js';
import { loadOperatorConfig, loadUserConfig } from '../../config.js';
import type { AgencyExecutionConfig } from '../../agency/types.js';

// Default timeout: 10 minutes
const DEFAULT_EXECUTION_TIMEOUT = 600000;

interface StepResult {
  stepOrder: number;
  success: boolean;
  result?: unknown;
  error?: string;
  completedAt: string;
}

/**
 * Build a task prompt for execution
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

## Instructions
1. Execute this step to completion
2. Be thorough and verify your work
3. Report what you accomplished

Please execute this step now.`;
}

/**
 * Load agency execution config with defaults
 */
function getAgencyExecutionConfig(username?: string): AgencyExecutionConfig {
  const defaults: AgencyExecutionConfig = {
    preferredBackend: 'claude-code',
    fallbackBackend: 'codex',
    availableBackends: ['claude-code', 'codex', 'open-interpreter', 'aider'],
    delegateToToolExecutor: true,
    localExecutionEnabled: false,
    plannerIncludesToolCapabilities: true,
    feasibilityCheckEnabled: true,
    maxPlanRetries: 3,
    taskGenerationEnabled: true,
  };

  try {
    const agencyConfig = loadUserConfig<{ execution?: AgencyExecutionConfig }>(
      'agency.json',
      { execution: defaults },
      username
    );
    return agencyConfig.execution || defaults;
  } catch {
    return defaults;
  }
}

/**
 * Execute a step using the configured escalation backend
 * Uses the unified backend abstraction to route to the user's preferred backend
 */
async function executeStep(
  step: PlanStep,
  desire: Desire,
  username?: string,
  onProgress?: DesireProgressCallback
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const prompt = buildTaskPrompt(step, desire);

  // Ensure backends are loaded before checking
  await ensureBackendsInitialized();

  // Load agency execution config to get preferred backend
  const execConfig = getAgencyExecutionConfig(username);
  const preferredBackendId = execConfig.preferredBackend;

  // Get the backend - prefer agency config, fall back to tool-executor config
  let backend = preferredBackendId ?
    (await import('../../escalation-backend.js')).getBackend(preferredBackendId) :
    undefined;

  if (!backend) {
    backend = getActiveBackend(username);
  }

  if (!backend) {
    console.log(`[desire-executor] ❌ No execution backend configured`);
    return {
      success: false,
      error: 'No execution backend configured. Enable one in Settings.',
    };
  }

  // Check if backend is available
  const available = await backend.isAvailable();
  if (!available) {
    console.log(`[desire-executor] ❌ Backend ${backend.name} is not available`);
    return {
      success: false,
      error: `Backend ${backend.name} is not available. Check installation.`,
    };
  }

  console.log(`[desire-executor] 🤖 Using ${backend.name}...`);
  console.log(`[desire-executor]    Action: ${step.action}`);
  console.log(`[desire-executor]    Expected: ${step.expectedOutcome || 'Complete successfully'}`);

  const workingMsg = `🤖 ${backend.name} is working on: ${step.action}`;

  // Emit working progress
  onProgress?.({
    type: 'claude_working',
    stepNumber: step.order,
    totalSteps: desire.plan?.steps?.length || 0,
    action: step.action,
    message: workingMsg,
    timestamp: Date.now(),
  });

  // Write to inner dialogue buffer
  if (username) {
    appendExecutionProgressToBuffer(username, workingMsg, {
      desireId: desire.id,
      stepNumber: step.order,
      action: step.action,
      backend: backend.id,
    });
  }

  try {
    // Get configurable timeout from operator config
    let timeout = DEFAULT_EXECUTION_TIMEOUT;
    if (username) {
      try {
        const config = loadOperatorConfig(username);
        timeout = config.bigBrotherMode?.executionTimeout || DEFAULT_EXECUTION_TIMEOUT;
      } catch {
        // Use default if config load fails
      }
    }

    // Execute via unified backend abstraction with agency's preferred backend
    const timeoutMins = Math.round(timeout / 60000);
    console.log(`[desire-executor] ⏳ Waiting for response (${timeoutMins} min timeout)...`);
    let result = await escalate(prompt, {
      timeout,
      username,
      preferredBackend: preferredBackendId,
    });

    // Try fallback backend if primary fails and fallback is configured
    if (!result.success && execConfig.fallbackBackend && execConfig.fallbackBackend !== preferredBackendId) {
      console.log(`[desire-executor] ⚠️ Primary backend failed, trying fallback: ${execConfig.fallbackBackend}`);
      result = await escalate(prompt, {
        timeout,
        username,
        preferredBackend: execConfig.fallbackBackend,
      });
    }

    if (!result.success) {
      console.log(`[desire-executor] ❌ Execution failed: ${result.error}`);
      return {
        success: false,
        error: result.error || 'Execution failed',
      };
    }

    // Log response summary
    const responseLines = result.output.split('\n').filter((l: string) => l.trim());
    const responseSummary = responseLines.slice(0, 5).join('\n   ');
    console.log(`[desire-executor] 📥 Response (${result.output.length} chars):`);
    console.log(`[desire-executor]    ${responseSummary}${responseLines.length > 5 ? '\n   ...(truncated)' : ''}`);

    return {
      success: true,
      result: {
        response: result.output,
        executedVia: backend.id,
        executionTime: result.executionTime,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.log(`[desire-executor] ❌ Execution error: ${(error as Error).message}`);
    return {
      success: false,
      error: `Execution failed: ${(error as Error).message}`,
    };
  }
}

const execute: NodeExecutor = async (inputs, context, _properties) => {
  // Inputs from graph - graph executor maps by handle name (string keys)
  // Edge uses slot_0/slot_1 handles, so we access by those keys
  // Also check context.desire for direct injection from executeDesireViaGraph
  const slot0 = (inputs['slot_0'] || inputs[0]) as { desire?: Desire } | Desire | undefined;
  const slot1 = (inputs['slot_1'] || inputs[1]) as { userId?: string; cognitiveMode?: string } | undefined;

  // Handle both wrapped { desire } format and direct Desire object
  // Also check context.desire for cases where desire is injected directly
  let desire: Desire | undefined;
  if (context.desire) {
    desire = context.desire as Desire;
  } else if (slot0) {
    desire = (slot0 as { desire?: Desire }).desire || (slot0 as Desire);
  }
  // Use userId from slot1 or context
  const username = slot1?.userId || (context.userId as string | undefined);

  if (!desire) {
    return {
      execution: null,
      success: false,
      error: 'No desire provided',
    };
  }

  if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
    return {
      execution: null,
      success: false,
      error: 'Desire has no plan to execute',
    };
  }

  if (desire.status !== 'approved' && desire.status !== 'executing') {
    return {
      execution: null,
      success: false,
      error: `Cannot execute desire in '${desire.status}' status. Must be 'approved' or 'executing'.`,
    };
  }

  const plan = desire.plan;
  const execution: DesireExecution = {
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    stepsCompleted: 0,
    stepsTotal: plan.steps.length,
    stepResults: [],
  };

  // Get progress callback from context (passed by executeDesireViaGraph)
  const onProgress = context.onDesireProgress as DesireProgressCallback | undefined;

  console.log(`[desire-executor] 🚀 Executing plan with ${plan.steps.length} steps`);
  console.log(`[desire-executor]    Goal: ${plan.operatorGoal}`);

  // Execute each step sequentially
  for (const step of plan.steps) {
    console.log(`[desire-executor] 📍 Step ${step.order}: ${step.action}`);
    execution.currentStep = step.order;

    // Emit step start progress
    const stepStartMsg = `Step ${step.order}/${plan.steps.length}: ${step.action}`;
    onProgress?.({
      type: 'step_start',
      stepNumber: step.order,
      totalSteps: plan.steps.length,
      action: step.action,
      message: stepStartMsg,
      timestamp: Date.now(),
      data: { expectedOutcome: step.expectedOutcome, risk: step.risk },
    });

    // Write to inner dialogue buffer for real-time visibility
    if (username) {
      appendExecutionProgressToBuffer(username, `🎯 ${stepStartMsg}`, {
        desireId: desire.id,
        stepNumber: step.order,
        totalSteps: plan.steps.length,
        action: step.action,
      });
    }

    try {
      const result = await executeStep(step, desire, username, onProgress);

      const stepResult: StepResult = {
        stepOrder: step.order,
        success: result.success,
        result: result.result,
        error: result.error,
        completedAt: new Date().toISOString(),
      };

      (execution.stepResults as StepResult[]).push(stepResult);

      if (result.success) {
        execution.stepsCompleted = (execution.stepsCompleted || 0) + 1;
        console.log(`[desire-executor]    ✅ Step ${step.order} completed`);

        // Emit step complete progress
        const stepCompleteMsg = `✅ Step ${step.order}/${plan.steps.length} completed`;
        onProgress?.({
          type: 'step_complete',
          stepNumber: step.order,
          totalSteps: plan.steps.length,
          action: step.action,
          message: stepCompleteMsg,
          timestamp: Date.now(),
          data: { result: result.result },
        });

        // Write completion to inner dialogue buffer
        if (username) {
          appendExecutionProgressToBuffer(username, stepCompleteMsg, {
            desireId: desire.id,
            stepNumber: step.order,
            totalSteps: plan.steps.length,
            action: step.action,
            success: true,
          });
        }
      } else {
        execution.status = 'failed';
        execution.error = `Step ${step.order} failed: ${result.error}`;
        console.log(`[desire-executor]    ❌ Step ${step.order} failed: ${result.error}`);

        // Emit step error progress
        const stepErrorMsg = `❌ Step ${step.order} failed: ${result.error}`;
        onProgress?.({
          type: 'step_error',
          stepNumber: step.order,
          totalSteps: plan.steps.length,
          action: step.action,
          message: stepErrorMsg,
          timestamp: Date.now(),
          data: { error: result.error },
        });

        // Write error to inner dialogue buffer
        if (username) {
          appendExecutionProgressToBuffer(username, stepErrorMsg, {
            desireId: desire.id,
            stepNumber: step.order,
            totalSteps: plan.steps.length,
            action: step.action,
            success: false,
            error: result.error,
          });
        }
        break;
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = `Step ${step.order} threw error: ${(error as Error).message}`;
      console.log(`[desire-executor]    ❌ Step ${step.order} error: ${(error as Error).message}`);

      // Emit step error progress
      const exceptionMsg = `❌ Step ${step.order} error: ${(error as Error).message}`;
      onProgress?.({
        type: 'step_error',
        stepNumber: step.order,
        totalSteps: plan.steps.length,
        action: step.action,
        message: exceptionMsg,
        timestamp: Date.now(),
        data: { error: (error as Error).message },
      });

      // Write exception to inner dialogue buffer
      if (username) {
        appendExecutionProgressToBuffer(username, exceptionMsg, {
          desireId: desire.id,
          stepNumber: step.order,
          totalSteps: plan.steps.length,
          action: step.action,
          success: false,
          error: (error as Error).message,
        });
      }
      break;
    }
  }

  // Mark as completed if all steps succeeded
  if (execution.status !== 'failed' && execution.stepsCompleted === plan.steps.length) {
    execution.status = 'completed';
    execution.completedAt = new Date().toISOString();
    console.log(`[desire-executor] 🎉 All ${plan.steps.length} steps completed!`);
  }

  // Save execution to desire folder
  try {
    // Calculate attempt number from metrics
    const attemptNumber = (desire.metrics?.executionAttemptCount || 0) + 1;

    // Save execution to folder
    await saveExecutionToFolder(desire.id, execution, attemptNumber, username);
    console.log(`[desire-executor] 💾 Saved execution attempt #${attemptNumber} to folder`);

    // Update desire with execution result and metrics
    const now = new Date().toISOString();
    const executionSucceeded = execution.status === 'completed';
    desire.execution = execution;
    desire.updatedAt = now;
    // Always send to outcome review; failures are handled there (retry/escalate/abandon).
    desire.status = 'awaiting_review';
    desire.currentStage = 'outcome_review';

    // Update metrics
    if (desire.metrics) {
      desire.metrics.executionAttemptCount++;
      desire.metrics.lastActivityAt = now;
      if (execution.status === 'completed') {
        desire.metrics.executionSuccessCount++;
      } else {
        desire.metrics.executionFailCount++;
      }
    }

    // Update stage iterations
    if (!desire.stageIterations) {
      desire.stageIterations = {
        planning: 0,
        planReview: 0,
        userApproval: 0,
        executing: 0,
        outcomeReview: 0,
      };
    }
    desire.stageIterations.executing++;

    // Save updated desire manifest
    await saveDesireManifest(desire, username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(desire.id, {
      timestamp: now,
      type: execution.status === 'completed' ? 'execution_completed' : 'execution_failed',
      description: execution.status === 'completed'
        ? `Execution completed successfully (${execution.stepsCompleted}/${execution.stepsTotal} steps)`
        : `Execution failed: ${execution.error}`,
      actor: 'system',
      data: {
        attemptNumber,
        stepsCompleted: execution.stepsCompleted,
        stepsTotal: execution.stepsTotal,
        status: execution.status,
        error: execution.error,
      },
    }, username);

  } catch (saveError) {
    console.error(`[desire-executor] ⚠️ Failed to save execution to folder:`, saveError);
    // Don't fail the whole execution just because of save error
  }

  // Generate human-readable summary for inner dialogue and TTS
  let summary = '';
  if (execution.status === 'completed') {
    summary = `I completed "${desire.title}". `;
    if (plan.operatorGoal) {
      summary += plan.operatorGoal + ' ';
    }
    // Add step summaries
    const stepSummaries: string[] = [];
    for (const stepResult of (execution.stepResults || [])) {
      if (stepResult.success && stepResult.result) {
        const resultObj = stepResult.result as { response?: string };
        // Use the generic 'response' field from escalation result
        const response = resultObj.response || '';
        if (response) {
          // Extract first meaningful line
          const lines = response.split('\n').filter((l: string) => l.trim());
          if (lines.length > 0) {
            stepSummaries.push(lines[0].substring(0, 150));
          }
        }
      }
    }
    if (stepSummaries.length > 0) {
      summary += 'What I did: ' + stepSummaries.slice(0, 3).join('; ');
    }
  } else {
    summary = `I tried to execute "${desire.title}" but it failed: ${execution.error}`;
  }

  return {
    execution,
    success: execution.status === 'completed',
    error: execution.error,
    desire, // Return updated desire
    summary, // Human-readable summary for inner dialogue and TTS
  };
};

export const DesireExecutorNode: NodeDefinition = defineNode({
  id: 'desire_executor',
  name: 'Desire Executor',
  category: 'agency',
  description: 'Executes a desire plan through the Big Brother operator',

  inputs: [
    { name: 'desire', type: 'object', description: 'Desire with approved plan to execute' },
    { name: 'userContext', type: 'object', description: 'User context (userId, cognitiveMode)' },
  ],

  outputs: [
    { name: 'execution', type: 'object', description: 'Execution results with step details' },
    { name: 'success', type: 'boolean', description: 'Whether all steps completed' },
    { name: 'error', type: 'string', description: 'Error message if execution failed' },
    { name: 'desire', type: 'object', description: 'Updated desire with execution and metrics' },
    { name: 'summary', type: 'string', description: 'Human-readable summary for inner dialogue and TTS' },
  ],

  properties: {},

  execute,
});

export default DesireExecutorNode;
