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
import {
  isClaudeSessionReady,
  sendPrompt,
  startClaudeSession,
} from '../../claude-session.js';
import {
  executeWithInterpreter,
  isInterpreterServerRunning,
} from '../../open-interpreter.js';
import { loadOperatorConfig } from '../../config.js';

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
 * Execute a step via Big Brother (Claude CLI)
 */
async function executeStepViaClaude(
  step: PlanStep,
  desire: Desire
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const prompt = buildTaskPrompt(step, desire);

  console.log(`[desire-executor] 📤 Sending to Claude CLI:`);
  console.log(`[desire-executor]    Action: ${step.action}`);
  console.log(`[desire-executor]    Expected: ${step.expectedOutcome || 'Complete successfully'}`);

  try {
    // Ensure Claude session is ready
    if (!isClaudeSessionReady()) {
      console.log(`[desire-executor] ⏳ Starting Claude session...`);
      const started = await startClaudeSession();
      if (!started) {
        console.log(`[desire-executor] ❌ Failed to start Claude session`);
        return {
          success: false,
          error: 'Failed to start Claude CLI session',
        };
      }
      console.log(`[desire-executor] ✅ Claude session started`);
    }

    console.log(`[desire-executor] ⏳ Waiting for Claude response (5 min timeout)...`);
    // 5 minute timeout for complex tasks
    const response = await sendPrompt(prompt, 300000);

    // Log Claude's response summary
    const responseLines = response.split('\n').filter((l: string) => l.trim());
    const responseSummary = responseLines.slice(0, 5).join('\n   ');
    console.log(`[desire-executor] 📥 Claude response (${response.length} chars):`);
    console.log(`[desire-executor]    ${responseSummary}${responseLines.length > 5 ? '\n   ...(truncated)' : ''}`);

    return {
      success: true,
      result: {
        claudeResponse: response,
        executedVia: 'claude-cli',
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.log(`[desire-executor] ❌ Claude CLI error: ${(error as Error).message}`);
    return {
      success: false,
      error: `Claude CLI execution failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Execute a step via Open Interpreter
 */
async function executeStepViaInterpreter(
  step: PlanStep,
  desire: Desire,
  username?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const task = buildTaskPrompt(step, desire);

  try {
    const response = await executeWithInterpreter(
      { task },
      undefined,
      username
    );

    if (!response.success) {
      return {
        success: false,
        error: response.error || 'Interpreter execution failed',
      };
    }

    return {
      success: true,
      result: {
        interpreterResponse: response.finalOutput,
        messages: response.messages,
        executedVia: 'open-interpreter',
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Interpreter execution failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Execute a step using the best available backend
 * Priority: Big Brother (if enabled) → Open Interpreter → Error
 */
async function executeStep(
  step: PlanStep,
  desire: Desire,
  username?: string,
  onProgress?: DesireProgressCallback
): Promise<{ success: boolean; result?: unknown; error?: string }> {

  // Check Big Brother configuration
  let bigBrotherEnabled = false;
  if (username) {
    const operatorConfig = loadOperatorConfig(username);
    bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled === true;
  }

  // Try Big Brother first if enabled
  if (bigBrotherEnabled) {
    console.log(`[desire-executor] 🤖 Using Big Brother (Claude CLI)...`);

    // Emit "Claude working" progress
    onProgress?.({
      type: 'claude_working',
      stepNumber: step.order,
      totalSteps: desire.plan?.steps?.length || 0,
      action: step.action,
      message: `🤖 Big Brother is working on: ${step.action}`,
      timestamp: Date.now(),
    });

    return executeStepViaClaude(step, desire);
  }

  // Try Open Interpreter if available
  const interpreterRunning = await isInterpreterServerRunning();
  if (interpreterRunning) {
    console.log(`[desire-executor] 🐍 Using Open Interpreter...`);

    // Emit "interpreter working" progress
    onProgress?.({
      type: 'claude_working',
      stepNumber: step.order,
      totalSteps: desire.plan?.steps?.length || 0,
      action: step.action,
      message: `🐍 Open Interpreter is working on: ${step.action}`,
      timestamp: Date.now(),
    });

    return executeStepViaInterpreter(step, desire, username);
  }

  // No execution backend available
  console.log(`[desire-executor] ❌ No execution backend available`);
  return {
    success: false,
    error: 'No execution backend available. Enable Big Brother mode or start Open Interpreter server.',
  };
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
    onProgress?.({
      type: 'step_start',
      stepNumber: step.order,
      totalSteps: plan.steps.length,
      action: step.action,
      message: `Step ${step.order}/${plan.steps.length}: ${step.action}`,
      timestamp: Date.now(),
      data: { expectedOutcome: step.expectedOutcome, risk: step.risk },
    });

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
        onProgress?.({
          type: 'step_complete',
          stepNumber: step.order,
          totalSteps: plan.steps.length,
          action: step.action,
          message: `✅ Step ${step.order}/${plan.steps.length} completed`,
          timestamp: Date.now(),
          data: { result: result.result },
        });
      } else {
        execution.status = 'failed';
        execution.error = `Step ${step.order} failed: ${result.error}`;
        console.log(`[desire-executor]    ❌ Step ${step.order} failed: ${result.error}`);

        // Emit step error progress
        onProgress?.({
          type: 'step_error',
          stepNumber: step.order,
          totalSteps: plan.steps.length,
          action: step.action,
          message: `❌ Step ${step.order} failed: ${result.error}`,
          timestamp: Date.now(),
          data: { error: result.error },
        });
        break;
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = `Step ${step.order} threw error: ${(error as Error).message}`;
      console.log(`[desire-executor]    ❌ Step ${step.order} error: ${(error as Error).message}`);

      // Emit step error progress
      onProgress?.({
        type: 'step_error',
        stepNumber: step.order,
        totalSteps: plan.steps.length,
        action: step.action,
        message: `❌ Step ${step.order} error: ${(error as Error).message}`,
        timestamp: Date.now(),
        data: { error: (error as Error).message },
      });
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
        const resultObj = stepResult.result as { claudeResponse?: string; interpreterResponse?: string };
        const response = resultObj.claudeResponse || resultObj.interpreterResponse || '';
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
