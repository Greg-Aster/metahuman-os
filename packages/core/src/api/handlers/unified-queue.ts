/**
 * Thin transport for the single work coordinator.
 */

import {
  DEFAULT_HANDLERS,
  ensureQueueSystemStarted,
  authorizeWorkSubmission,
  getQueueManager,
  getQueueSystem,
  type Priority,
  type QueueEvent,
  type QueuedTask,
  type TaskType,
  type WorkCognitiveMode,
} from '../../queue/index.js';
import { audit } from '../../audit.js';
import type { UnifiedRequest, UnifiedResponse, UnifiedUser } from '../types.js';

function success(data: Record<string, unknown>, status = 200): UnifiedResponse {
  return { status, data };
}

function failure(error: string, status = 500): UnifiedResponse {
  return { status, data: { success: false, error } };
}

function requireUser(user: UnifiedUser): UnifiedResponse | null {
  return user.isAuthenticated ? null : failure('Authentication required', 401);
}

function sse(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function canReadTask(task: QueuedTask, user: UnifiedUser): boolean {
  return user.role === 'owner' || task.username === user.username;
}

function taskStatus(task: QueuedTask): 'queued' | 'running' | 'completed' | 'failed' {
  if (task.state === 'leased') return 'running';
  if (task.state === 'completed') return 'completed';
  if (task.state === 'failed' || task.state === 'cancelled' || task.state === 'expired') return 'failed';
  return 'queued';
}

function taskView(task: QueuedTask) {
  return {
    id: task.id,
    type: task.type,
    handler: task.handler,
    resource: task.resource,
    state: task.state,
    status: taskStatus(task),
    priority: task.priority,
    source: task.source,
    username: task.username,
    cognitiveMode: task.cognitiveMode,
    createdAt: task.createdAt,
    notBefore: task.notBefore,
    deadline: task.deadline,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    waitingReason: task.waitingReason,
    wakeAt: task.wakeAt,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    correlationId: task.correlationId,
    parentTaskId: task.parentTaskId,
    cancellationRequestedAt: task.cancellationRequestedAt,
    error: task.error?.message,
  };
}

function queueSnapshot(user: UnifiedUser) {
  const system = getQueueSystem();
  const state = system.getState();
  const manager = getQueueManager();
  const visible = (tasks: QueuedTask[]) => tasks.filter(task => canReadTask(task, user)).map(taskView);
  return {
    success: true,
    lifecycle: state.lifecycle,
    running: state.running,
    paused: state.paused,
    degraded: state.degraded,
    error: state.error,
    proactiveScheduling: state.proactiveScheduling,
    stats: state.stats,
    resourceCapacity: state.resourceCapacity,
    tasks: visible(manager.getAllTasks()),
    history: visible(manager.getHistory()),
    inFlightRemote: user.role === 'owner' ? state.inFlightRemote : [],
    nextTriggers: user.role === 'owner' ? state.nextTriggers : [],
    lastActivity: user.role === 'owner' ? state.lastActivity : undefined,
    triggerManager: user.role === 'owner' ? state.triggerManager : undefined,
  };
}

export async function handleGetQueueStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireUser(req.user);
    if (authError) return authError;
    await ensureQueueSystemStarted();
    return success(queueSnapshot(req.user));
  } catch (error) {
    return failure((error as Error).message);
  }
}

export async function handleEnqueueTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireUser(req.user);
    if (authError) return authError;
    const body = (req.body || {}) as {
      type?: TaskType;
      input?: Record<string, any>;
      priority?: Priority;
      deadline?: string;
      notBefore?: string;
      idempotencyKey?: string;
      cognitiveMode?: WorkCognitiveMode;
    };
    if (!body.type || !(body.type in DEFAULT_HANDLERS)) return failure('Unknown work type', 400);
    if (req.user.role !== 'owner' && body.type !== 'user_message') {
      return failure('Only the owner may enqueue system work', 403);
    }

    const input = body.input || {};
    const kind = input.kind === 'response-pipeline' ? 'response-pipeline' : 'persona-chat';
    const handler = body.type === 'user_message'
      ? kind === 'response-pipeline' ? 'chat.response-pipeline' : 'chat.persona'
      : DEFAULT_HANDLERS[body.type];
    const system = await ensureQueueSystemStarted();
    const task = system.enqueue({
      type: body.type,
      handler,
      source: 'user',
      input,
      username: req.user.username,
      priority: body.type === 'user_message' ? 'critical' : body.priority,
      deadline: body.deadline,
      notBefore: body.notBefore,
      idempotencyKey: body.idempotencyKey,
      cognitiveMode: body.cognitiveMode,
      metadata: {
        requestUser: { ...req.user },
        requestSessionId: req.sessionId,
        requestMetadata: req.metadata,
      },
    });

    return success({ success: true, task: taskView(task) });
  } catch (error) {
    console.error('[unified-queue] Error enqueueing work:', error);
    return failure((error as Error).message);
  }
}

export async function handleSubmitCoordinatorWork(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authorization = Object.entries(req.headers ?? {})
    .find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  if (!authorizeWorkSubmission(authorization)) return failure('Valid coordinator service token required', 401);
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, any> : {};
  if (!body.type || !DEFAULT_HANDLERS[body.type as TaskType]) return failure('Unknown work type', 400);
  if (typeof body.username !== 'string' || !body.username.trim()) return failure('Work username is required', 400);
  if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) return failure('Work input must be an object', 400);
  try {
    const system = await ensureQueueSystemStarted();
    const task = system.enqueue(body as any);
    return success({ task }, 202);
  } catch (error) {
    return failure((error as Error).message, 503);
  }
}

export async function handleDeleteQueueTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireUser(req.user);
    if (authError) return authError;
    const taskId = req.params?.id;
    if (!taskId) return failure('Missing task id', 400);
    const manager = getQueueManager();
    const existing = manager.getTask(taskId);
    if (!existing || !canReadTask(existing, req.user)) return failure('Work item not found', 404);
    const task = manager.cancel(taskId, `Cancelled by ${req.user.username}`);
    if (!task) return failure('Work item is already terminal', 409);
    return success({ success: true, task: taskView(task), snapshot: queueSnapshot(req.user) });
  } catch (error) {
    return failure((error as Error).message);
  }
}

export async function handleGetQueueTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req.user);
  if (authError) return authError;
  const taskId = req.params?.id;
  if (!taskId) return failure('Missing task id', 400);
  const task = getQueueManager().getTask(taskId);
  if (!task || !canReadTask(task, req.user)) return failure('Work item not found', 404);
  return success({ success: true, task: taskView(task) });
}

export async function handleClearQueueTasks(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req.user);
  if (authError) return authError;
  const cancelled = getQueueManager().clearQueued();
  return success({ success: true, cancelled, runningPreserved: true, snapshot: queueSnapshot(req.user) });
}

export async function handleTriggerAgent(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req.user);
  if (authError) return authError;
  const agentId = req.params?.agentId || req.params?.id || req.body?.agentId;
  if (!agentId) return failure('Missing agentId', 400);
  const args = Array.isArray(req.body?.args)
    ? req.body.args.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const taskId = getQueueSystem().triggerAgent(agentId, req.user.username, args);
  if (!taskId) return failure(`Unknown agent: ${agentId}`, 404);
  audit({ level: 'info', category: 'action', event: 'queue_agent_triggered', actor: req.user.username, details: { agentId, taskId } });
  return success({ success: true, agentId, taskId });
}

export async function handleQueueControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req.user);
  if (authError) return authError;
  const action = req.body?.action as 'start' | 'stop' | 'pause' | 'resume' | undefined;
  const system = getQueueSystem();
  let result: boolean;
  if (action === 'start') result = await system.start();
  else if (action === 'stop') result = await system.stop();
  else if (action === 'pause') { system.pause(); result = true; }
  else if (action === 'resume') { system.resume(); result = true; }
  else return failure('Unknown queue control action', 400);
  audit({ level: 'info', category: 'action', event: `queue_${action}`, actor: req.user.username, details: { result } });
  return success({ success: result, action, state: system.getState() });
}

export async function handleGetTriggers(): Promise<UnifiedResponse> {
  const system = getQueueSystem();
  const snapshot = system.triggers.getSnapshot();
  return success({
    success: true,
    triggers: snapshot.triggers,
    nextTriggers: system.getState().nextTriggers,
    snapshot,
    compatibilityAlias: true,
  });
}

export async function handleRecordActivity(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req.user);
  if (authError) return authError;
  const system = getQueueSystem();
  system.recordActivity(req.user.username);
  return success({ success: true, lastActivity: system.getState().lastActivity });
}

export async function handleQueueStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return failure('Authentication required', 401);
  async function* stream(): AsyncIterable<string> {
    const manager = getQueueManager();
    const pending: string[] = [];
    let wake: (() => void) | undefined;
    const listener = (event: QueueEvent) => {
      pending.push(sse({ type: event.type, event, snapshot: queueSnapshot(req.user) }));
      wake?.();
      wake = undefined;
    };
    manager.addEventListener(listener);
    try {
      yield sse({ type: 'snapshot', snapshot: queueSnapshot(req.user), timestamp: new Date().toISOString() });
      while (!req.signal?.aborted) {
        while (pending.length > 0) yield pending.shift()!;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 15_000);
          wake = () => { clearTimeout(timer); resolve(); };
          req.signal?.addEventListener('abort', wake, { once: true });
        });
        if (pending.length === 0 && !req.signal?.aborted) yield ': heartbeat\n\n';
      }
    } finally {
      wake?.();
      manager.removeEventListener(listener);
    }
  }
  return { status: 200, stream: stream(), headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } };
}

function terminalStreamEvent(task: QueuedTask): string {
  if (task.state === 'completed') return sse({ type: 'queued_task_completed', data: { taskId: task.id } });
  return sse({ type: 'error', data: { message: task.error?.message || task.cancellationReason || `Work ${task.state}` } });
}

export async function handleQueueTaskStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return failure('Authentication required', 401);
  const taskId = req.params?.id;
  if (!taskId) return failure('Missing task id', 400);
  const initialTask = getQueueManager().getTask(taskId);
  if (!initialTask || !canReadTask(initialTask, req.user)) return failure('Work item not found', 404);
  const streamTaskId = taskId;

  async function* stream(): AsyncIterable<string> {
    const manager = getQueueManager();
    const pending: string[] = [];
    let wake: (() => void) | undefined;
    const listener = (event: QueueEvent) => {
      if (event.taskId !== streamTaskId) return;
      if (event.type === 'task_output' && typeof event.details?.chunk === 'string') pending.push(event.details.chunk);
      else if (event.type === 'task_started') pending.push(sse({ type: 'queued_task_started', data: { taskId: streamTaskId } }));
      else if (event.type === 'task_completed') pending.push(sse({ type: 'queued_task_completed', data: { taskId: streamTaskId } }));
      else if (event.type === 'task_failed' || event.type === 'task_cancelled' || event.type === 'task_expired') {
        const task = manager.getTask(streamTaskId);
        if (task) pending.push(terminalStreamEvent(task));
      }
      wake?.();
      wake = undefined;
    };
    manager.addEventListener(listener);
    try {
      for (const chunk of manager.getOutput(streamTaskId)) yield chunk;
      let task = manager.getTask(streamTaskId);
      if (!task) return;
      if (task.state === 'queued' || task.state === 'waiting') {
        const position = Math.max(1, manager.getAllTasks().filter(item => item.state === 'queued' || item.state === 'waiting').findIndex(item => item.id === streamTaskId) + 1);
        yield sse({ type: 'queued', data: { taskId: streamTaskId, position, resource: task.resource } });
      } else if (task.state === 'leased' && manager.getOutput(streamTaskId).length === 0) {
        yield sse({ type: 'queued_task_started', data: { taskId: streamTaskId } });
      } else if (taskStatus(task) === 'completed' || taskStatus(task) === 'failed') {
        yield terminalStreamEvent(task);
        return;
      }

      while (!req.signal?.aborted) {
        while (pending.length > 0) yield pending.shift()!;
        task = manager.getTask(streamTaskId);
        if (!task || taskStatus(task) === 'completed' || taskStatus(task) === 'failed') return;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 15_000);
          wake = () => { clearTimeout(timer); resolve(); };
          req.signal?.addEventListener('abort', wake, { once: true });
        });
        if (pending.length === 0 && !req.signal?.aborted) yield ': heartbeat\n\n';
      }
    } finally {
      wake?.();
      manager.removeEventListener(listener);
    }
  }

  return { status: 200, stream: stream(), headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } };
}
