import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, captureEvent } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import {
  loadDesire,
  moveDesire,
  addScratchpadEntryToFolder,
  type Desire,
  type DesireExecution,
  type PlanStep,
} from '@metahuman/core';
import { loadOperatorConfig } from '@metahuman/core/config';
import { isClaudeSessionReady, sendPrompt, startClaudeSession } from '@metahuman/core/claude-session';

const LOG_PREFIX = '[API:agency/run]';

// Server-side API base URL for internal calls
// Defaults to localhost for local dev, can be overridden for remote deployments
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4321';

// =============================================================================
// BIG BROTHER OPERATOR ROUTING
// =============================================================================
// ALL execution routes through the Big Brother operator system.
// DO NOT add direct skill calls here - the operator handles skill selection.
// DEPRECATED: Direct executeSkill calls - use operator API instead
// =============================================================================

// ============================================================================
// Plan Execution via Big Brother Operator
// ============================================================================
// NOTE: Outcome review is handled separately via /api/agency/desires/[id]/outcome-review
// This endpoint only executes the plan and sets status to 'awaiting_review'
// ============================================================================

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
 * Execute a single plan step via Claude CLI (Big Brother mode) or operator API.
 * When Big Brother delegateAll is enabled, routes directly to Claude CLI.
 */
async function executeStep(
  step: PlanStep,
  desire: Desire,
  _username?: string,
  cookieHeader?: string,
): Promise<{ success: boolean; result?: unknown; error?: string; operatorResponse?: OperatorResponse }> {
  console.log(`${LOG_PREFIX} 🔧 Executing step ${step.order}: ${step.action}`);

  // Check if Big Brother delegation mode is enabled
  const operatorConfig = loadOperatorConfig();
  const bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled === true;
  const delegateAll = operatorConfig.bigBrotherMode?.delegateAll === true;

  // Build the goal for Big Brother
  // Include skill hint if specified, but let operator decide
  const goal = step.skill
    ? `Execute: ${step.action}\n\nSuggested skill: ${step.skill}\nInputs: ${JSON.stringify(step.inputs || {})}`
    : step.action;

  // =========================================================================
  // BIG BROTHER DELEGATION MODE: Route directly to Claude CLI
  // =========================================================================
  if (bigBrotherEnabled && delegateAll) {
    console.log(`${LOG_PREFIX}    🤖 Big Brother delegation mode - routing to Claude CLI`);

    try {
      // Ensure Claude session is ready
      if (!isClaudeSessionReady()) {
        console.log(`${LOG_PREFIX}    ⏳ Starting Claude session...`);
        const started = await startClaudeSession();
        if (!started) {
          return {
            success: false,
            error: 'Failed to start Claude CLI session',
          };
        }
      }

      // Build prompt for Claude CLI
      const prompt = `You are executing a task for MetaHuman OS Agency system.

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
1. Execute this step to completion using your tools (Read, Write, Bash, etc.)
2. Be thorough and verify your work
3. Report what you accomplished

Please execute this step now.`;

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_step_delegation',
        actor: 'agency-run',
        details: {
          desireId: desire.id,
          stepOrder: step.order,
          action: step.action,
        },
      });

      const response = await sendPrompt(prompt, 120000); // 2 minute timeout

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_step_completed',
        actor: 'agency-run',
        details: {
          desireId: desire.id,
          stepOrder: step.order,
          responseLength: response.length,
        },
      });

      console.log(`${LOG_PREFIX}    ✅ Claude CLI execution completed`);

      return {
        success: true,
        result: {
          claudeResponse: response,
          executedVia: 'claude-cli',
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.log(`${LOG_PREFIX}    ❌ Claude CLI error: ${(error as Error).message}`);

      audit({
        level: 'error',
        category: 'action',
        event: 'big_brother_step_failed',
        actor: 'agency-run',
        details: {
          desireId: desire.id,
          stepOrder: step.order,
          error: (error as Error).message,
        },
      });

      return {
        success: false,
        error: `Claude CLI execution failed: ${(error as Error).message}`,
      };
    }
  }

  // =========================================================================
  // FALLBACK: Use operator API (local skills)
  // =========================================================================
  console.log(`${LOG_PREFIX}    📡 Routing to operator API...`);

  // Build rich context for the operator
  const context = `
## Desire Execution Context

**Desire**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason || 'Not specified'}

## Current Step (${step.order} of ${desire.plan?.steps?.length || '?'})

**Action**: ${step.action}
**Expected Outcome**: ${step.expectedOutcome || 'Complete successfully'}
**Risk Level**: ${step.risk}
${step.skill ? `**Suggested Skill**: ${step.skill}` : ''}
${step.inputs ? `**Inputs**: ${JSON.stringify(step.inputs, null, 2)}` : ''}
${step.requiresApproval ? '**⚠️ This step requires careful execution**' : ''}

Please execute this step and report the result.
`.trim();

  console.log(`${LOG_PREFIX}    📡 Routing to Big Brother operator...`);

  try {
    // Call the Big Brother operator API
    // IMPORTANT: Pass cookies to maintain authentication context
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const response = await fetch(`${API_BASE_URL}/api/operator`, {
      method: 'POST',
      headers,
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
      console.log(`${LOG_PREFIX}    ❌ Operator API error: ${response.status}`);
      return {
        success: false,
        error: `Operator API error: ${response.status} - ${errorText}`,
      };
    }

    const operatorResult: OperatorResponse = await response.json();

    if (!operatorResult.success) {
      console.log(`${LOG_PREFIX}    ❌ Operator failed: ${operatorResult.error?.message || operatorResult.error?.reason}`);
      return {
        success: false,
        error: operatorResult.error?.message || operatorResult.error?.reason || 'Operator failed',
        operatorResponse: operatorResult,
      };
    }

    console.log(`${LOG_PREFIX}    ✅ Operator succeeded`);
    if (operatorResult.reasoning) {
      console.log(`${LOG_PREFIX}    💭 Reasoning: ${operatorResult.reasoning.substring(0, 100)}...`);
    }

    return {
      success: true,
      result: {
        operatorResult: operatorResult.result,
        reasoning: operatorResult.reasoning,
        actions: operatorResult.actions,
        timestamp: new Date().toISOString(),
      },
      operatorResponse: operatorResult,
    };
  } catch (error) {
    console.log(`${LOG_PREFIX}    ❌ Failed to call operator: ${(error as Error).message}`);
    return {
      success: false,
      error: `Failed to call Big Brother operator: ${(error as Error).message}`,
    };
  }
}

/**
 * Execute an entire desire plan inline
 */
async function executePlanInline(
  desire: Desire,
  username: string,
  cookieHeader?: string
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
    stepsTotal: plan.steps.length,
    stepResults: [],
  };

  console.log(`${LOG_PREFIX} 🚀 Executing plan with ${plan.steps.length} steps`);
  console.log(`${LOG_PREFIX}    Goal: ${plan.operatorGoal}`);

  for (const step of plan.steps) {
    try {
      execution.currentStep = step.order;

      const result = await executeStep(step, desire, username, cookieHeader);

      (execution.stepResults as StepResult[]).push({
        stepOrder: step.order,
        success: result.success,
        result: result.result,
        error: result.error,
        completedAt: new Date().toISOString(),
      });

      if (result.success) {
        execution.stepsCompleted = (execution.stepsCompleted || 0) + 1;
        console.log(`${LOG_PREFIX}    ✅ Step ${step.order} completed`);
      } else {
        execution.status = 'failed';
        execution.error = `Step ${step.order} failed: ${result.error}`;
        console.log(`${LOG_PREFIX}    ❌ Step ${step.order} failed: ${result.error}`);
        break;
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = `Step ${step.order} threw error: ${(error as Error).message}`;
      console.log(`${LOG_PREFIX}    ❌ Step ${step.order} error: ${(error as Error).message}`);
      break;
    }
  }

  // If we completed all steps, mark as completed
  if (execution.status !== 'failed' && execution.stepsCompleted === plan.steps.length) {
    execution.status = 'completed';
    execution.completedAt = new Date().toISOString();
    console.log(`${LOG_PREFIX} 🎉 All ${plan.steps.length} steps completed successfully!`);
  }

  return execution;
}

/**
 * POST /api/agency/desires/:id/run
 * Execute a desire's plan inline (not waiting for background agent)
 * This is the "real" execute that actually runs the plan
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to execute desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      console.log(`${LOG_PREFIX} ❌ Owner role required`);
      return new Response(
        JSON.stringify({ error: 'Owner role required to execute desires.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 🚀 Run requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);

    // Only allow running desires in 'approved' or 'executing' status
    if (!['approved', 'executing'].includes(desire.status)) {
      console.log(`${LOG_PREFIX} ❌ Wrong status: ${desire.status} (needs: approved or executing)`);
      return new Response(
        JSON.stringify({ error: `Cannot run desire in '${desire.status}' status. Must be 'approved' or 'executing'.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if desire has a plan attached
    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      console.log(`${LOG_PREFIX} ❌ No plan attached to desire`);
      return new Response(
        JSON.stringify({
          error: 'Cannot run desire without a plan. Generate a plan first.',
          suggestion: 'Use the "Generate Plan" button first.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} ✅ Plan found with ${desire.plan.steps.length} steps`);

    // Move to executing status if not already
    const now = new Date().toISOString();
    let executingDesire: Desire = desire;

    if (desire.status === 'approved') {
      executingDesire = {
        ...desire,
        status: 'executing',
        updatedAt: now,
        execution: {
          startedAt: now,
          status: 'in_progress',
          stepsCompleted: 0,
          stepsTotal: desire.plan?.steps?.length || 1,
        },
      };
      await moveDesire(executingDesire, 'approved', 'executing', user.username);
      console.log(`${LOG_PREFIX} ⚡ Moved to executing status`);
    }

    // Actually execute the plan
    // Extract cookie header to pass to operator API for authentication
    const cookieHeader = request.headers.get('cookie') || undefined;
    console.log(`${LOG_PREFIX} 🏃 Starting plan execution...`);
    const execution = await executePlanInline(executingDesire, user.username, cookieHeader);

    // Update desire with execution results (temporarily)
    let desireWithExecution: Desire = {
      ...executingDesire,
      execution,
      updatedAt: new Date().toISOString(),
    };

    // Audit the execution
    audit({
      category: 'agent',
      level: execution.status === 'completed' ? 'info' : 'warn',
      event: 'desire_executed_inline',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        executionStatus: execution.status,
        stepsCompleted: execution.stepsCompleted,
        totalSteps: desire.plan?.steps.length || 0,
        error: execution.error,
        manual: true,
      },
    });

    // =========================================================================
    // SET STATUS TO AWAITING_REVIEW
    // Outcome review is triggered separately (via scheduler or manual UI)
    // =========================================================================
    const nowFinal = new Date().toISOString();
    const newStatus: Desire['status'] = 'awaiting_review';

    console.log(`${LOG_PREFIX} 📋 Execution complete - status → awaiting_review`);
    console.log(`${LOG_PREFIX}    Steps completed: ${execution.stepsCompleted}/${desire.plan?.steps.length || 0}`);
    console.log(`${LOG_PREFIX}    Outcome review will run separately (scheduler or manual trigger)`);

    // Build desire with execution results (no outcome review yet)
    const finalDesire: Desire = {
      ...desireWithExecution,
      status: newStatus,
      currentStage: 'outcome_review',
      updatedAt: nowFinal,
      // Update execution attempt metrics (keep existing if present)
      ...(desire.metrics && {
        metrics: {
          ...desire.metrics,
          executionAttemptCount: desire.metrics.executionAttemptCount + 1,
          lastActivityAt: nowFinal,
        },
      }),
    };

    // Move desire to awaiting_review status
    console.log(`${LOG_PREFIX} 📦 Moving executing → ${newStatus}`);
    await moveDesire(finalDesire, 'executing', newStatus, user.username);

    // Audit the status change
    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_awaiting_review',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        executionStatus: execution.status,
        stepsCompleted: execution.stepsCompleted,
        totalSteps: desire.plan?.steps.length || 0,
        newStatus,
      },
    });

    // Add scratchpad entry for execution completion
    await addScratchpadEntryToFolder(id, {
      timestamp: nowFinal,
      type: 'execution_completed',
      description: `Execution ${execution.status}: ${execution.stepsCompleted}/${desire.plan?.steps.length || 0} steps completed`,
      actor: 'user',
      data: {
        executionStatus: execution.status,
        stepsCompleted: execution.stepsCompleted,
        totalSteps: desire.plan?.steps.length || 0,
        stepResults: execution.stepResults,
        error: execution.error,
        newStatus,
      },
    }, user.username);

    // Log execution completion to inner dialogue
    const executionSummary = execution.status === 'completed'
      ? `I've executed the plan for "${desire.title}" - all ${execution.stepsCompleted} steps completed successfully. Now awaiting outcome review.`
      : `I attempted to execute "${desire.title}" but encountered issues. ${execution.error || 'Some steps failed.'} Now awaiting outcome review.`;

    captureEvent(executionSummary, {
      type: 'inner_dialogue',
      tags: ['agency', 'execution', 'manual', 'inner'],
      metadata: {
        desireId: id,
        executionStatus: execution.status,
        stepsCompleted: execution.stepsCompleted,
        totalSteps: desire.plan?.steps.length || 0,
      },
    });

    // Build response message
    const message = execution.status === 'completed'
      ? `✅ Execution complete! "${desire.title}" - ${execution.stepsCompleted}/${desire.plan?.steps.length || 0} steps completed. Status: awaiting_review`
      : `⚠️ Execution had issues: "${desire.title}" - ${execution.stepsCompleted}/${desire.plan?.steps.length || 0} steps completed. ${execution.error || ''} Status: awaiting_review`;

    console.log(`${LOG_PREFIX} ✅ Execution complete - awaiting outcome review`);

    return new Response(JSON.stringify({
      success: execution.status === 'completed',
      desire: finalDesire,
      execution,
      message,
      awaitingReview: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
