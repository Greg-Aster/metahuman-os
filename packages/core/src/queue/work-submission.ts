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

export type DesireAgentOperation = 'plan' | 'execute' | 'review' | 'checkin';

/**
 * The only public admission contract for Desire work after generation.
 * Callers request an operation from the Desire Agent; the agent contract owns
 * the internal planner, executor, outcome-review, and check-in handlers.
 */
export interface DesireAgentSubmission {
  operation: DesireAgentOperation;
  username: string;
  source: WorkSource;
  desireId?: string;
  force?: boolean;
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

function desireAgentMetadata(input: DesireAgentSubmission): Record<string, any> {
  const requestedBy = typeof input.metadata?.producer === 'string'
    ? input.metadata.producer
    : input.source;
  return {
    ...input.metadata,
    producer: 'desire-agent',
    monitorAgentId: 'desire-agent',
    desireAgentOperation: input.operation,
    requestedBy,
  };
}

function validateDesireAgentIdentity(input: DesireAgentSubmission): {
  username: string;
  desireId?: string;
} {
  const username = input.username.trim();
  const desireId = input.desireId?.trim();
  if (!PROFILE_USERNAME_PATTERN.test(username)) {
    throw new Error('Desire Agent requires a valid profile username');
  }
  if (desireId && !/^desire-[a-zA-Z0-9_-]+$/.test(desireId)) {
    throw new Error('Desire Agent requires a valid desire ID');
  }
  if (input.operation === 'checkin' && !desireId) {
    throw new Error('Desire Agent check-in requires a desire ID');
  }
  return { username, desireId };
}

/** Build one coordinator task owned and attributed to the Desire Agent. */
export function buildDesireAgentTaskInput(input: DesireAgentSubmission): TaskInput {
  const { username, desireId } = validateDesireAgentIdentity(input);
  const metadata = desireAgentMetadata(input);

  if (input.operation === 'plan') {
    const args = desireId ? ['--desire-id', desireId] : [];
    return {
      type: 'generic',
      handler: 'agent.desire-planner',
      resource: 'remote-llm',
      source: input.source,
      username,
      priority: input.priority ?? 'high',
      input: {
        agentId: 'desire-planner',
        args,
        triggeredBy: 'desire-agent',
      },
      parentTaskId: input.parentTaskId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey || `desire-agent:plan:${desireId || 'pending-batch'}`,
      maxAttempts: 2,
      metadata,
    };
  }

  if (input.operation === 'execute') {
    return {
      type: 'desire_execute',
      handler: 'agency.desire-execute',
      resource: 'remote-llm',
      source: input.source,
      username,
      priority: input.priority ?? 'high',
      input: { desireId, triggeredBy: 'desire-agent' },
      parentTaskId: input.parentTaskId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey || `desire-agent:execute:${desireId || 'approved-batch'}`,
      maxAttempts: 1,
      metadata,
    };
  }

  if (input.operation === 'review') {
    return {
      type: 'desire_review',
      handler: 'agency.desire-outcome-review',
      resource: 'remote-llm',
      source: input.source,
      username,
      priority: input.priority ?? 'normal',
      input: { desireId, triggeredBy: 'desire-agent' },
      parentTaskId: input.parentTaskId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey || `desire-agent:review:${desireId || 'pending-batch'}`,
      maxAttempts: 1,
      metadata,
    };
  }

  return {
    type: 'desire_checkin',
    handler: 'agency.desire-checkin',
    resource: 'local-llm',
    source: input.source,
    username,
    priority: input.priority ?? 'high',
    input: {
      desireId,
      checkProgress: true,
      force: input.force === true,
      triggeredBy: 'desire-agent',
    },
    parentTaskId: input.parentTaskId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey || `desire-agent:checkin:${desireId}:${input.force ? 'force' : 'normal'}`,
    maxAttempts: 2,
    metadata,
  };
}

export function submitDesireAgent(input: DesireAgentSubmission): Promise<QueuedTask> {
  return submitCoordinatorWork(buildDesireAgentTaskInput(input));
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
