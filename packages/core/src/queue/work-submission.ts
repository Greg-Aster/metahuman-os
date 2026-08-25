/** Service-token handoff to the one server-owned work coordinator. */

import type { Priority, QueuedTask, TaskInput, WorkSource } from './types.js';
import { ensureQueueSystemStarted } from './queue-system.js';
import {
  getWorkCoordinatorToken,
  getWorkCoordinatorUrl,
  isWorkCoordinatorOwner,
} from './work-coordinator-ownership.js';

export {
  authorizeWorkSubmission,
  claimWorkCoordinatorOwnership,
  isWorkCoordinatorOwner,
} from './work-coordinator-ownership.js';

const SUBMISSION_PATH = '/api/internal/work-coordinator/enqueue';

export async function submitCoordinatorWork(input: TaskInput): Promise<QueuedTask> {
  if (isWorkCoordinatorOwner()) {
    const system = await ensureQueueSystemStarted();
    return system.enqueue(input);
  }

  const token = getWorkCoordinatorToken();
  if (!token) throw new Error('Server-owned work coordinator is not available');
  const response = await fetch(`${getWorkCoordinatorUrl()}${SUBMISSION_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const body = await response.json() as { task?: QueuedTask; error?: string };
  if (!response.ok || !body.task) throw new Error(body.error || `Coordinator submission failed (${response.status})`);
  return body.task;
}

export interface MemoryIndexRefreshSubmission {
  username: string;
  source: WorkSource;
  force?: boolean;
  maxAgeHours?: number;
  priority?: Priority;
  metadata?: Record<string, any>;
}

export interface DesireExecutionSubmission {
  username: string;
  source: WorkSource;
  desireId?: string;
  priority?: Priority;
  parentTaskId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

export interface DesireOutcomeReviewSubmission {
  username: string;
  source: WorkSource;
  desireId?: string;
  priority?: Priority;
  parentTaskId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

/** Admit outcome review to the coordinator; the Core Agency graph owns all transitions. */
export function submitDesireOutcomeReview(input: DesireOutcomeReviewSubmission): Promise<QueuedTask> {
  const desireId = input.desireId?.trim();
  return submitCoordinatorWork({
    type: 'desire_review',
    handler: 'agency.desire-outcome-review',
    resource: 'remote-llm',
    source: input.source,
    username: input.username,
    priority: input.priority ?? 'normal',
    input: { desireId, triggeredBy: input.metadata?.producer || input.source },
    parentTaskId: input.parentTaskId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey || `desire-outcome-review:${desireId || 'pending-batch'}`,
    maxAttempts: 1,
    metadata: { producer: 'desire-outcome-reviewer', ...input.metadata },
  });
}

/** Admit desire execution to its one remote-effect lane without executing it in the caller. */
export function submitDesireExecution(input: DesireExecutionSubmission): Promise<QueuedTask> {
  const desireId = input.desireId?.trim();
  return submitCoordinatorWork({
    type: 'desire_execute',
    handler: 'agency.desire-execute',
    resource: 'remote-llm',
    source: input.source,
    username: input.username,
    priority: input.priority ?? 'high',
    input: {
      desireId,
      triggeredBy: input.metadata?.producer || input.source,
    },
    parentTaskId: input.parentTaskId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey || `desire-execute:${desireId || 'approved-batch'}`,
    maxAttempts: 1,
    metadata: { producer: 'desire-executor', ...input.metadata },
  });
}

/** Admit a full index reconciliation to its one durable execution lane. */
export function submitMemoryIndexRefresh(input: MemoryIndexRefreshSubmission): Promise<QueuedTask> {
  const force = input.force === true;
  return submitCoordinatorWork({
    type: 'index_build',
    handler: 'vector.index-build',
    resource: 'vector-index',
    source: input.source,
    username: input.username,
    priority: input.priority ?? 'normal',
    input: {
      force,
      maxAgeHours: input.maxAgeHours,
      triggeredBy: input.metadata?.producer || input.source,
    },
    idempotencyKey: `vector-index-refresh:${force ? 'force' : 'normal'}`,
    metadata: { producer: 'vector-index-refresh', ...input.metadata },
  });
}
