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
