/**
 * Agency workflow API handlers.
 *
 * Owns transport, coordinator admission, durable-result verification, and SSE
 * progress for manual Desire workflows. Astro route files only delegate here.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, streamResponse } from '../types.js';
import {
  loadDesire,
  type Desire,
} from '../../agency/index.js';
import {
  assertDesireExecutable,
  type ExecutableDesire,
} from '../../agency/desire-execution-service.js';
import {
  getQueueManager,
  submitDesirePlanning,
  submitDesireExecution,
  submitDesireOutcomeReview,
  type QueueEvent,
} from '../../queue/index.js';

const PLAN_LOG_PREFIX = '[API:agency/generate-plan]';
const PLAN_STREAM_LOG_PREFIX = '[API:agency/generate-plan-stream]';
const RUN_LOG_PREFIX = '[API:agency/run]';
const RUN_STREAM_LOG_PREFIX = '[API:agency/run-stream]';
const OUTCOME_LOG_PREFIX = '[API:agency/outcome-review]';
const OUTCOME_STREAM_LOG_PREFIX = '[API:agency/outcome-review-stream]';

class WorkflowError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

function workflowErrorResponse(error: unknown): UnifiedResponse {
  if (error instanceof WorkflowError) {
    return { status: error.status, error: error.message };
  }
  return { status: 500, error: (error as Error).message };
}

function requireOwner(req: UnifiedRequest, action: string): UnifiedResponse | undefined {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: `Authentication required to ${action}.` };
  }
  if (req.user.role !== 'owner') {
    return { status: 403, error: `Owner role required to ${action}.` };
  }
  return undefined;
}

function namedSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function dataSse(event: {
  type: 'phase' | 'log' | 'result' | 'error' | 'done';
  phase?: string;
  message?: string;
  data?: unknown;
}): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function loadPlannableDesire(username: string, id: string): Promise<Desire> {
  const desire = await loadDesire(id, username);
  if (!desire) throw new WorkflowError('Desire not found', 404);

  const plannable = desire.status === 'planning'
    || desire.status === 'pending'
    || (desire.status === 'approved' && !desire.plan);
  if (!plannable) {
    throw new WorkflowError(
      `Cannot generate a plan for desire in '${desire.status}' status. Reset or revise it to planning first.`,
      400,
    );
  }
  return desire;
}

function rejectInlineCritique(req: UnifiedRequest): void {
  const critique = (req.body as { critique?: unknown } | undefined)?.critique;
  if (typeof critique === 'string' && critique.trim()) {
    throw new WorkflowError(
      'Submit plan feedback through the revise endpoint before generating the replacement plan.',
      400,
    );
  }
}

export async function handleGenerateDesirePlan(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'generate plans');
  if (auth) return auth;
  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    rejectInlineCritique(req);
    const desire = await loadPlannableDesire(req.user.username, id);
    const task = await submitDesirePlanning({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-plan-api' },
    });
    return successResponse({
      success: true,
      planningQueued: true,
      taskId: task.id,
      desire,
      message: `Plan generation queued for "${desire.title}".`,
    }, 202);
  } catch (error) {
    console.error(`${PLAN_LOG_PREFIX} Error:`, error);
    return workflowErrorResponse(error);
  }
}

export async function handleGenerateDesirePlanStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  const response = streamResponse(generatePlanStream(req));
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
}

async function* generatePlanStream(req: UnifiedRequest): AsyncIterable<string> {
  const startTime = Date.now();
  try {
    yield namedSse('phase', { phase: 'authenticating', message: 'Checking authentication...' });
    const auth = requireOwner(req, 'generate plans');
    if (auth) {
      yield namedSse('error', { error: auth.error });
      return;
    }
    const id = req.params?.id;
    if (!id) {
      yield namedSse('error', { error: 'Desire ID is required' });
      return;
    }

    rejectInlineCritique(req);
    yield namedSse('phase', { phase: 'loading', message: 'Loading desire...' });
    const desire = await loadPlannableDesire(req.user.username, id);
    yield namedSse('desire_loaded', {
      desireId: id,
      title: desire.title,
      status: desire.status,
      hasPlan: Boolean(desire.plan),
    });

    const task = await submitDesirePlanning({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-plan-stream' },
    });
    yield namedSse('started', {
      desireId: id,
      taskId: task.id,
      message: 'Plan generation admitted to the Work Coordinator.',
    });
    yield namedSse('queued', {
      taskId: task.id,
      state: task.state,
      message: 'The Desire Planner agent owns generation, validation, review, and persistence.',
    });

    const manager = getQueueManager();
    let wake: (() => void) | undefined;
    const listener = (event: QueueEvent) => {
      if (event.taskId !== task.id) return;
      wake?.();
      wake = undefined;
    };
    manager.addEventListener(listener);
    try {
      let current = manager.getTask(task.id);
      if (!current) throw new Error('Queued plan generation is not visible to the coordinator owner');
      while (!['completed', 'failed', 'cancelled', 'expired'].includes(current.state)) {
        if (req.signal?.aborted) {
          manager.cancel(task.id, 'Plan generation stream closed by requester');
          return;
        }
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        current = manager.getTask(task.id);
        if (!current) throw new Error('Queued plan generation disappeared before completion');
      }
      if (current.state !== 'completed') {
        throw new Error(current.error?.message || `Plan generation ${current.state}`);
      }
    } finally {
      wake?.();
      manager.removeEventListener(listener);
    }

    const finalDesire = await loadDesire(id, req.user.username);
    if (!finalDesire) throw new Error('Planned desire could not be reloaded');
    const awaitingQuestions = finalDesire.status === 'questioning'
      && Boolean(finalDesire.clarifyingQuestions);
    const durablePlanResult = Boolean(finalDesire.plan)
      && ['approved', 'awaiting_approval', 'rejected'].includes(finalDesire.status);
    const feasibilityRejection = finalDesire.status === 'rejected'
      && !finalDesire.plan;
    if (!awaitingQuestions && !durablePlanResult && !feasibilityRejection) {
      throw new Error('Desire Planner completed without a durable planning outcome');
    }

    yield namedSse('complete', {
      success: true,
      taskId: task.id,
      desire: finalDesire,
      plan: finalDesire.plan,
      awaitingQuestions,
      message: awaitingQuestions
        ? `Clarifying questions are ready for "${finalDesire.title}".`
        : `Planning completed for "${finalDesire.title}".`,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error(`${PLAN_STREAM_LOG_PREFIX} Error:`, error);
    yield namedSse('error', { error: (error as Error).message });
  }
}

async function loadExecutableDesire(username: string, id: string): Promise<ExecutableDesire> {
  const desire = await loadDesire(id, username);
  if (!desire) throw new WorkflowError('Desire not found', 404);
  try {
    assertDesireExecutable(desire);
  } catch (error) {
    throw new WorkflowError((error as Error).message, 400);
  }
  return desire;
}

export async function handleRunDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'execute desires');
  if (auth) return auth;
  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    console.log(`${RUN_LOG_PREFIX} 🚀 Run requested for: ${id}`);
    const desire = await loadExecutableDesire(req.user.username, id);
    const task = await submitDesireExecution({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-run-api' },
    });
    return successResponse({
      success: true,
      executionQueued: true,
      taskId: task.id,
      desire,
      message: `Execution queued for "${desire.title}".`,
    }, 202);
  } catch (error) {
    console.error(`${RUN_LOG_PREFIX} ❌ Error:`, error);
    const response = workflowErrorResponse(error);
    if (error instanceof WorkflowError && error.message === 'Cannot run desire without a plan. Generate a plan first.') {
      response.data = { error: error.message, suggestion: 'Use the "Generate Plan" button first.' };
      response.error = undefined;
    }
    return response;
  }
}

export async function handleRunDesireStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  return streamResponse(runDesireStream(req));
}

async function* runDesireStream(req: UnifiedRequest): AsyncIterable<string> {
  const startTime = Date.now();
  try {
    yield namedSse('phase', { phase: 'authenticating', message: 'Checking authentication...' });
    const auth = requireOwner(req, 'execute desires');
    if (auth) {
      yield namedSse('error', { error: auth.error });
      return;
    }
    const id = req.params?.id;
    if (!id) {
      yield namedSse('error', { error: 'Desire ID is required' });
      return;
    }

    console.log(`${RUN_STREAM_LOG_PREFIX} 🚀 Stream run requested for: ${id}`);
    yield namedSse('phase', { phase: 'loading', message: 'Loading desire...' });
    const desire = await loadExecutableDesire(req.user.username, id);

    yield namedSse('desire_loaded', {
      desireId: id,
      title: desire.title,
      totalSteps: desire.plan.steps.length,
      goal: desire.plan.operatorGoal,
    });

    const task = await submitDesireExecution({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-run-stream' },
    });
    yield namedSse('queued', { taskId: task.id, state: task.state, message: 'Execution admitted to the Work Coordinator.' });

    const manager = getQueueManager();
    let outputIndex = 0;
    let wake: (() => void) | undefined;
    const listener = (event: QueueEvent) => {
      if (event.taskId !== task.id) return;
      wake?.();
      wake = undefined;
    };

    manager.addEventListener(listener);
    try {
      let current = manager.getTask(task.id);
      if (!current) throw new Error('Queued desire execution is not visible to the coordinator owner');

      while (!['completed', 'failed', 'cancelled', 'expired'].includes(current.state)) {
        const output = manager.getOutput(task.id);
        for (const chunk of output.slice(outputIndex)) yield chunk;
        outputIndex = output.length;
        if (req.signal?.aborted) {
          manager.cancel(task.id, 'Desire execution stream closed by requester');
          return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        current = manager.getTask(task.id);
        if (!current) throw new Error('Queued desire execution disappeared before completion');
      }
      const finalOutput = manager.getOutput(task.id);
      for (const chunk of finalOutput.slice(outputIndex)) yield chunk;

      if (current.state !== 'completed') {
        throw new Error(current.error?.message || `Desire execution ${current.state}`);
      }
    } finally {
      wake?.();
      manager.removeEventListener(listener);
    }

    const finalDesire = await loadDesire(id, req.user.username);
    if (!finalDesire) throw new Error('Executed desire could not be reloaded');
    const execution = finalDesire.execution;
    const executionSucceeded = execution?.status === 'completed';
    yield namedSse('phase', { phase: 'finalizing', message: 'Execution attempt durably recorded.' });
    yield namedSse('complete', {
      success: executionSucceeded,
      taskId: task.id,
      desire: finalDesire,
      execution,
      message: executionSucceeded
        ? `Execution completed for "${finalDesire.title}".`
        : `Execution failed for "${finalDesire.title}": ${execution?.error || 'unknown error'}.`,
      awaitingReview: finalDesire.status === 'awaiting_review',
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error(`${RUN_STREAM_LOG_PREFIX} ❌ Error:`, error);
    yield namedSse('error', { error: (error as Error).message });
  }
}

async function loadReviewableDesire(username: string, id: string): Promise<Desire> {
  const desire = await loadDesire(id, username);
  if (!desire) throw new WorkflowError('Desire not found', 404);
  if (!['awaiting_review', 'completed', 'failed'].includes(desire.status)) {
    throw new WorkflowError(`Cannot review outcome for desire in '${desire.status}' status. Must be 'awaiting_review', 'completed', or 'failed'.`, 400);
  }
  if (!desire.execution) {
    throw new WorkflowError('Cannot review outcome without execution data.', 400);
  }
  if (desire.outcomeReview) {
    throw new WorkflowError('This desire already has a durable outcome review.', 409);
  }
  return desire;
}

export async function handleOutcomeReview(req: UnifiedRequest): Promise<UnifiedResponse> {
  const auth = requireOwner(req, 'review outcomes');
  if (auth) return auth;
  const id = req.params?.id;
  if (!id) return { status: 400, error: 'Desire ID is required' };

  try {
    const desire = await loadReviewableDesire(req.user.username, id);
    const task = await submitDesireOutcomeReview({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-outcome-review-api' },
    });
    return successResponse({
      success: true,
      reviewQueued: true,
      taskId: task.id,
      desire,
      message: `Outcome review queued for "${desire.title}".`,
    }, 202);
  } catch (error) {
    console.error(`${OUTCOME_LOG_PREFIX} Error:`, error);
    return workflowErrorResponse(error);
  }
}

export async function handleOutcomeReviewStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  return streamResponse(outcomeReviewStream(req));
}

async function* outcomeReviewStream(req: UnifiedRequest): AsyncIterable<string> {
  try {
    const auth = requireOwner(req, 'review outcomes');
    if (auth) {
      yield dataSse({ type: 'error', message: auth.error });
      return;
    }
    const id = req.params?.id;
    if (!id) {
      yield dataSse({ type: 'error', message: 'Desire ID is required' });
      return;
    }

    yield dataSse({ type: 'phase', phase: 'Loading desire...' });
    const desire = await loadReviewableDesire(req.user.username, id);
    yield dataSse({ type: 'log', message: `Found: "${desire.title}" (status: ${desire.status})` });
    const task = await submitDesireOutcomeReview({
      username: req.user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-outcome-review-stream' },
    });
    yield dataSse({ type: 'phase', phase: 'Review admitted to Work Coordinator...' });
    yield dataSse({ type: 'log', message: `Queued work item ${task.id} (${task.state})` });

    const manager = getQueueManager();
    let wake: (() => void) | undefined;
    const listener = (event: QueueEvent) => {
      if (event.taskId !== task.id) return;
      wake?.();
      wake = undefined;
    };
    manager.addEventListener(listener);
    try {
      let current = manager.getTask(task.id);
      if (!current) throw new Error('Queued outcome review is not visible to the coordinator owner');
      while (!['completed', 'failed', 'cancelled', 'expired'].includes(current.state)) {
        if (req.signal?.aborted) {
          manager.cancel(task.id, 'Outcome review stream closed by requester');
          return;
        }
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        current = manager.getTask(task.id);
        if (!current) throw new Error('Queued outcome review disappeared before completion');
      }
      if (current.state !== 'completed') {
        throw new Error(current.error?.message || `Outcome review ${current.state}`);
      }
    } finally {
      wake?.();
      manager.removeEventListener(listener);
    }

    const reviewed = await loadDesire(id, req.user.username);
    if (!reviewed?.outcomeReview) throw new Error('Outcome review completed without a durable review');
    yield dataSse({ type: 'result', data: {
      success: true,
      taskId: task.id,
      desire: reviewed,
      outcomeReview: reviewed.outcomeReview,
      message: `Outcome review completed for "${reviewed.title}".`,
    } });
    yield dataSse({ type: 'done' });
  } catch (error) {
    console.error(`${OUTCOME_STREAM_LOG_PREFIX} Stream error:`, error);
    yield dataSse({ type: 'error', message: (error as Error).message });
  }
}
