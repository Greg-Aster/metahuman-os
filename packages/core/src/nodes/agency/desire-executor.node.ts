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
import {
  saveExecutionToFolder,
  saveDesireManifest,
  addScratchpadEntryToFolder,
} from '../../agency/storage.js';

interface StepResult {
  stepOrder: number;
  success: boolean;
  result?: unknown;
  error?: string;
  completedAt: string;
  operatorResponse?: {
    reasoning?: string;
    actions?: string[];
    scratchpad?: unknown[];
  };
}

interface OperatorResponse {
  success: boolean;
  result?: string | null;
  reasoning?: string;
  actions?: string[];
  scratchpad?: unknown[];
  error?: {
    type: string;
    reason: string;
    message?: string;
  };
}

/**
 * Call the Big Brother operator to execute a step
 */
async function executeStepViaOperator(
  step: PlanStep,
  desire: Desire,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<{ success: boolean; result?: unknown; error?: string; operatorResponse?: OperatorResponse }> {

  // Build the goal for the operator
  // The operator is intelligent and can figure out how to accomplish the goal
  const goal = step.skill
    ? `Execute skill '${step.skill}' with inputs: ${JSON.stringify(step.inputs || {})}. Action: ${step.action}`
    : step.action;

  // Build context for the operator
  const context = `
This is step ${step.order} of executing desire "${desire.title}".

Desire Description: ${desire.description}
Desire Reason: ${desire.reason || 'Not specified'}

Step Action: ${step.action}
Expected Outcome: ${step.expectedOutcome || 'Complete successfully'}
Risk Level: ${step.risk}
${step.skill ? `Suggested Skill: ${step.skill}` : ''}
${step.inputs ? `Inputs: ${JSON.stringify(step.inputs, null, 2)}` : ''}

Please execute this step and report the result.
`.trim();

  try {
    // Call the operator API
    const response = await fetch('http://localhost:4321/api/operator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal,
        context,
        autoApprove: !step.requiresApproval,
        allowMemoryWrites: true,
        mode: step.risk === 'high' || step.risk === 'critical' ? 'strict' : 'yolo',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Operator API error: ${response.status} - ${errorText}`,
      };
    }

    const operatorResult: OperatorResponse = await response.json();

    if (!operatorResult.success) {
      return {
        success: false,
        error: operatorResult.error?.message || operatorResult.error?.reason || 'Operator failed',
        operatorResponse: operatorResult,
      };
    }

    return {
      success: true,
      result: operatorResult.result,
      operatorResponse: operatorResult,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to call operator: ${(error as Error).message}`,
    };
  }
}

const execute: NodeExecutor = async (inputs, context, _properties) => {
  // Inputs from graph:
  // slot 0: { desire } from desire_loader or approval_queue
  // slot 1: { userId, cognitiveMode } from user context
  const slot0 = inputs[0] as { desire?: Desire } | undefined;
  const slot1 = inputs[1] as { userId?: string; cognitiveMode?: string } | undefined;

  const desire = slot0?.desire;
  const userContext = slot1;
  const username = context.userId as string | undefined;

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

  console.log(`[desire-executor] 🚀 Executing plan with ${plan.steps.length} steps`);
  console.log(`[desire-executor]    Goal: ${plan.operatorGoal}`);

  // Execute each step sequentially
  for (const step of plan.steps) {
    console.log(`[desire-executor] 📍 Step ${step.order}: ${step.action}`);
    execution.currentStep = step.order;

    try {
      const result = await executeStepViaOperator(step, desire, userContext);

      const stepResult: StepResult = {
        stepOrder: step.order,
        success: result.success,
        result: result.result,
        error: result.error,
        completedAt: new Date().toISOString(),
        operatorResponse: result.operatorResponse ? {
          reasoning: result.operatorResponse.reasoning,
          actions: result.operatorResponse.actions,
          scratchpad: result.operatorResponse.scratchpad,
        } : undefined,
      };

      (execution.stepResults as StepResult[]).push(stepResult);

      if (result.success) {
        execution.stepsCompleted = (execution.stepsCompleted || 0) + 1;
        console.log(`[desire-executor]    ✅ Step ${step.order} completed`);
      } else {
        execution.status = 'failed';
        execution.error = `Step ${step.order} failed: ${result.error}`;
        console.log(`[desire-executor]    ❌ Step ${step.order} failed: ${result.error}`);
        break;
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = `Step ${step.order} threw error: ${(error as Error).message}`;
      console.log(`[desire-executor]    ❌ Step ${step.order} error: ${(error as Error).message}`);
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
    desire.execution = execution;
    desire.updatedAt = now;
    desire.currentStage = execution.status === 'completed' ? 'outcome_review' : 'failed';

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

  return {
    execution,
    success: execution.status === 'completed',
    error: execution.error,
    desire, // Return updated desire
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
  ],

  properties: {},

  execute,
});

export default DesireExecutorNode;
