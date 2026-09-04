/** Service-token handoff to the one server-owned work coordinator. */

import type { Priority, QueuedTask, TaskInput, WorkSource } from './types.js';
import { resolveAgentExecutablePath } from '../agent-executable-resolver.js';
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

export interface DesirePlanningSubmission {
  username: string;
  source: WorkSource;
  desireId: string;
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

export interface AgentFollowOnSubmission {
  agentId: string;
  username: string;
  seed: string;
  sourceAgent: string;
  executionId: string;
  idempotencyKey: string;
  parentTaskId?: string;
  correlationId?: string;
}

const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROFILE_USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;
const MAX_FOLLOW_ON_SEED_CHARS = 12_000;

/**
 * Admit one agent follow-on through the server-owned Work Coordinator.
 * Graph nodes and non-graph finite agents share this contract; neither starts
 * a child process or owns retry/execution state.
 */
export function buildAgentFollowOnTaskInput(input: AgentFollowOnSubmission): TaskInput {
  const agentId = input.agentId.trim();
  const username = input.username.trim();
  const sourceAgent = input.sourceAgent.trim();
  const executionId = input.executionId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const seed = input.seed.trim();

  if (!AGENT_ID_PATTERN.test(agentId)) throw new Error('Follow-on agentId must be kebab-case');
  if (!AGENT_ID_PATTERN.test(sourceAgent)) throw new Error('Follow-on sourceAgent must be kebab-case');
  if (!username) throw new Error('Follow-on username is required');
  if (!executionId) throw new Error('Follow-on executionId is required');
  if (!idempotencyKey) throw new Error('Follow-on idempotencyKey is required');
  if (!seed) throw new Error('Follow-on seed is required');
  if (seed.length > MAX_FOLLOW_ON_SEED_CHARS) {
    throw new Error(`Follow-on seed must not exceed ${MAX_FOLLOW_ON_SEED_CHARS} characters`);
  }
  if (!resolveAgentExecutablePath(agentId)) {
    throw new Error(`No maintained executable for follow-on agent: ${agentId}`);
  }

  return {
    type: 'generic',
    handler: `agent.${agentId}`,
    resource: 'local-llm',
    source: 'autonomy',
    username,
    priority: 'low',
    input: {
      agentId,
      seed,
      sourceAgent,
      executionId,
      triggeredBy: 'agent-follow-on',
      args: [],
    },
    parentTaskId: input.parentTaskId,
    correlationId: input.correlationId,
    idempotencyKey,
    maxAttempts: 2,
    metadata: {
      producer: sourceAgent,
      followOnAgent: agentId,
      sourceExecutionId: executionId,
    },
  };
}

export function submitAgentFollowOn(input: AgentFollowOnSubmission): Promise<QueuedTask> {
  return submitCoordinatorWork(buildAgentFollowOnTaskInput(input));
}

/** Admit one targeted Desire planning run through the coordinator-owned agent lane. */
export function buildDesirePlanningTaskInput(input: DesirePlanningSubmission): TaskInput {
  const username = input.username.trim();
  const desireId = input.desireId.trim();
  if (!PROFILE_USERNAME_PATTERN.test(username)) {
    throw new Error('Desire planning requires a valid profile username');
  }
  if (!/^desire-[a-zA-Z0-9_-]+$/.test(desireId)) {
    throw new Error('Desire planning requires a valid desire ID');
  }

  return {
    type: 'generic',
    handler: 'agent.desire-planner',
    resource: 'remote-llm',
    source: input.source,
    username,
    priority: input.priority ?? 'high',
    input: {
      agentId: 'desire-planner',
      args: ['--desire-id', desireId],
      triggeredBy: input.metadata?.producer || input.source,
    },
    parentTaskId: input.parentTaskId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey || `desire-plan:${desireId}`,
    maxAttempts: 2,
    metadata: { producer: 'desire-planner', ...input.metadata },
  };
}

export function submitDesirePlanning(input: DesirePlanningSubmission): Promise<QueuedTask> {
  return submitCoordinatorWork(buildDesirePlanningTaskInput(input));
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
export function buildMemoryIndexRefreshTaskInput(input: MemoryIndexRefreshSubmission): TaskInput {
  const username = input.username.trim();
  const force = input.force === true;
  if (!PROFILE_USERNAME_PATTERN.test(username)) {
    throw new Error('Memory index refresh requires a valid profile username');
  }
  if (input.maxAgeHours !== undefined
      && (!Number.isFinite(input.maxAgeHours) || input.maxAgeHours < 0)) {
    throw new Error('Memory index refresh maxAgeHours must be a non-negative number');
  }

  return {
    type: 'index_build',
    handler: 'vector.index-build',
    resource: 'vector-index',
    source: input.source,
    username,
    priority: input.priority ?? 'normal',
    input: {
      force,
      maxAgeHours: input.maxAgeHours,
      triggeredBy: input.metadata?.producer || input.source,
    },
    idempotencyKey: `vector-index-refresh:${force ? 'force' : 'normal'}`,
    maxAttempts: 2,
    metadata: { producer: 'vector-index-refresh', ...input.metadata },
  };
}

export function submitMemoryIndexRefresh(input: MemoryIndexRefreshSubmission): Promise<QueuedTask> {
  return submitCoordinatorWork(buildMemoryIndexRefreshTaskInput(input));
}
