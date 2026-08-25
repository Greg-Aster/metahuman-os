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
import { submitExecutionProgress } from '../../buffer-admission.js';
import {
  escalate,
  getActiveBackend,
  getBackend,
  ensureBackendsInitialized,
} from '../../escalation-backend.js';
import { loadFreshOperatorConfig } from '../../config.js';
import { loadConfig as loadAgencyConfig } from '../../agency/config.js';
import type { AgencyExecutionConfig } from '../../agency/types.js';
import { renderPromptTemplate } from '../prompt-template.js';

// Default timeout: 10 minutes
const DEFAULT_EXECUTION_TIMEOUT = 600000;

const DEFAULT_TASK_PROMPT_TEMPLATE = `You are executing a task for MetaHuman OS Agency system.

## Desire Context
**Title**: {{title}}
**Description**: {{description}}
**Reason**: {{reason}}

## Current Step ({{stepOrder}} of {{stepCount}})
**Action**: {{action}}
**Expected Outcome**: {{expectedOutcome}}
**Risk Level**: {{risk}}
{{skillSection}}{{inputsSection}}

## Instructions
1. Execute this step to completion
2. Be thorough and verify your work
3. Report what you accomplished

Please execute this step now.`;

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
function buildTaskPrompt(step: PlanStep, desire: Desire, taskPromptTemplate = DEFAULT_TASK_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(taskPromptTemplate, {
    title: desire.title,
    description: desire.description,
    reason: desire.reason || 'Not specified',
    stepOrder: step.order,
    stepCount: desire.plan?.steps?.length || '?',
    action: step.action,
    expectedOutcome: step.expectedOutcome || 'Complete successfully',
    risk: step.risk,
    skill: step.skill || '',
    skillSection: step.skill ? `**Suggested Approach**: ${step.skill}\n` : '',
    inputs: step.inputs || null,
    inputsSection: step.inputs ? `**Inputs**: ${JSON.stringify(step.inputs, null, 2)}\n` : '',
    desire,
    step,
  });
}

/**
 * Load the canonical agency execution config.
 */
async function getAgencyExecutionConfig(username?: string): Promise<AgencyExecutionConfig> {
  const agencyConfig = await loadAgencyConfig(username);
  if (!agencyConfig.execution) {
    throw new Error('Agency execution configuration is missing');
  }
  return agencyConfig.execution;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Desire execution cancelled', 'AbortError');
}

/**
 * Execute a step using the configured escalation backend
 * Uses the unified backend abstraction to route to the user's preferred backend
 */
async function executeStep(
  step: PlanStep,
  desire: Desire,
  username?: string,
  onProgress?: DesireProgressCallback,
  taskPromptTemplate?: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  throwIfAborted(signal);
  const prompt = buildTaskPrompt(step, desire, taskPromptTemplate);

  // Ensure backends are loaded before checking
  await ensureBackendsInitialized();

  // Load agency execution config to get preferred backend
  const execConfig = await getAgencyExecutionConfig(username);
  const preferredBackendId = execConfig.preferredBackend;

  // Resolve one backend before execution begins. A configured fallback may replace
  // an unavailable primary, but an attempted external action is never replayed.
  let selectedBackendId = preferredBackendId;
  let backend = preferredBackendId ?
    getBackend(preferredBackendId) :
    getActiveBackend(username);

  if (!backend || !await backend.isAvailable()) {
    const primaryError = backend
      ? `Backend ${backend.name} is not available`
      : preferredBackendId
        ? `Configured backend '${preferredBackendId}' is not registered`
        : 'No execution backend is configured';
    const fallbackBackend = execConfig.fallbackBackend
      && execConfig.fallbackBackend !== preferredBackendId
      ? getBackend(execConfig.fallbackBackend)
      : undefined;
    if (!fallbackBackend || !await fallbackBackend.isAvailable()) {
      return {
        success: false,
        error: `${primaryError}; configured fallback backend is unavailable`,
      };
    }
    backend = fallbackBackend;
    selectedBackendId = fallbackBackend.id;
    console.log(`[desire-executor] ⚠️ ${primaryError}; using configured fallback ${fallbackBackend.name}`);
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
    await submitExecutionProgress(username, workingMsg, {
      desireId: desire.id,
      stepNumber: step.order,
      action: step.action,
      backend: backend.id,
    });
  }

  try {
    // Get configurable timeout from operator config
    const timeout = username
      ? loadFreshOperatorConfig(username).bigBrotherMode?.executionTimeout || DEFAULT_EXECUTION_TIMEOUT
      : DEFAULT_EXECUTION_TIMEOUT;

    // Execute exactly once through the backend selected before the external action.
    const timeoutMins = Math.round(timeout / 60000);
    console.log(`[desire-executor] ⏳ Waiting for response (${timeoutMins} min timeout)...`);
    const result = await escalate(prompt, {
      timeout,
      username,
      preferredBackend: selectedBackendId,
      signal,
    });
    throwIfAborted(signal);

    if (!result.success) {
      console.log(`[desire-executor] ❌ Execution failed: ${result.error}`);
      return {
        success: false,
        error: result.error || 'Execution failed',
      };
    }

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
    if ((error as Error).name === 'AbortError' || signal?.aborted) throw error;
    console.log(`[desire-executor] ❌ Execution error: ${(error as Error).message}`);
    return {
      success: false,
      error: `Execution failed: ${(error as Error).message}`,
    };
  }
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs from graph - graph executor maps by handle name (string keys)
  // Edge uses slot_0/slot_1 handles, so we access by those keys
  // Also check context.desire for direct injection from executeDesireViaGraph
  const slot0 = (inputs['slot_0'] || inputs[0]) as { desire?: Desire } | Desire | undefined;
  const slot1 = (inputs['slot_1'] || inputs[1]) as { userId?: string; cognitiveMode?: string } | undefined;
  const taskPromptTemplate = properties?.taskPromptTemplate ?? DEFAULT_TASK_PROMPT_TEMPLATE;
  const signal = context.abortSignal as AbortSignal | undefined;

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
    throwIfAborted(signal);
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
      await submitExecutionProgress(username, `🎯 ${stepStartMsg}`, {
        desireId: desire.id,
        stepNumber: step.order,
        totalSteps: plan.steps.length,
        action: step.action,
      });
    }

    try {
      const result = await executeStep(step, desire, username, onProgress, taskPromptTemplate, signal);

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
          await submitExecutionProgress(username, stepCompleteMsg, {
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
          await submitExecutionProgress(username, stepErrorMsg, {
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
      if ((error as Error).name === 'AbortError' || signal?.aborted) throw error;
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
        await submitExecutionProgress(username, exceptionMsg, {
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

  // Persist the canonical manifest before secondary execution history and audit data.
  // Any persistence failure fails the graph; callers must never report success for an
  // external effect that was not durably recorded.
  const attemptNumber = (desire.metrics?.executionAttemptCount || 0) + 1;
  const now = new Date().toISOString();
  const updatedDesire: Desire = {
    ...desire,
    execution,
    updatedAt: now,
    status: 'awaiting_review',
    currentStage: 'outcome_review',
    metrics: desire.metrics
      ? {
          ...desire.metrics,
          executionAttemptCount: desire.metrics.executionAttemptCount + 1,
          executionSuccessCount: desire.metrics.executionSuccessCount + (execution.status === 'completed' ? 1 : 0),
          executionFailCount: desire.metrics.executionFailCount + (execution.status === 'completed' ? 0 : 1),
          lastActivityAt: now,
        }
      : desire.metrics,
    stageIterations: {
      planning: desire.stageIterations?.planning || 0,
      planReview: desire.stageIterations?.planReview || 0,
      userApproval: desire.stageIterations?.userApproval || 0,
      executing: (desire.stageIterations?.executing || 0) + 1,
      outcomeReview: desire.stageIterations?.outcomeReview || 0,
    },
  };

  await saveDesireManifest(updatedDesire, username);
  await saveExecutionToFolder(desire.id, execution, attemptNumber, username);
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
    desire: updatedDesire,
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

  properties: {
    taskPromptTemplate: DEFAULT_TASK_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    taskPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_TASK_PROMPT_TEMPLATE,
      label: 'Task Prompt Template',
      description: 'Template variables include {{title}}, {{description}}, {{stepOrder}}, {{stepCount}}, {{action}}, {{expectedOutcome}}, {{risk}}, {{skillSection}}, {{inputsSection}}, {{desire}}, {{step}}.',
      rows: 18,
    },
  },

  execute,
});

export default DesireExecutorNode;
