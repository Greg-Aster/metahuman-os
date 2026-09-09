/**
 * Single-ledger work coordinator.
 *
 * Resource lanes limit concurrency. They never own task ordering or lifecycle.
 */

import { randomUUID } from 'node:crypto';
import { canonicalJSON } from '../durable-execution/store.js';
import {
  DEFAULT_HANDLERS,
  DEFAULT_PRIORITIES,
  PRIORITY_VALUES,
  TASK_LANE_MAP,
  WorkCommitUncertainError,
  type LaneConfig,
  type Priority,
  type QueueConfig,
  type QueueEvent,
  type QueueEventListener,
  type QueueState,
  type QueuedTask,
  type RemoteResult,
  type RemoteTaskHandle,
  type ResourceLane,
  type ResourceLaneId,
  type TaskInput,
  type TaskType,
  type WorkError,
  type WorkResource,
  type WorkState,
  type BodyLease,
} from './types.js';

const RESOURCE_LANES: ResourceLaneId[] = ['local-llm', 'vector-index', 'remote-llm'];
const TERMINAL_STATES = new Set<WorkState>(['completed', 'failed', 'cancelled', 'expired']);
const DESIRE_AGENT_HANDLER = 'agent.desire-generator';
const DESIRE_AGENT_INTERNAL_HANDLERS = new Map<string, TaskType>([
  ['agent.desire-planner', 'generic'],
  ['agency.desire-execute', 'desire_execute'],
  ['agency.desire-outcome-review', 'desire_review'],
  ['agency.desire-checkin', 'desire_checkin'],
]);
const DESIRE_AGENT_TASK_TYPES = new Set<TaskType>([
  'desire_generate',
  'desire_execute',
  'desire_review',
  'desire_checkin',
]);
const LEGACY_DESIRE_HANDLERS = new Set([
  'agency.desire-signal',
  'agent.desire-agent',
  'agent.desire-executor',
  'agent.desire-outcome-reviewer',
]);

function immutableJSON<T>(value: T): T {
  const freeze = (entry: any): any => {
    if (entry && typeof entry === 'object') {
      Object.values(entry).forEach(freeze);
      Object.freeze(entry);
    }
    return entry;
  };
  return freeze(JSON.parse(JSON.stringify(value)));
}

function protectAdmission(task: QueuedTask): QueuedTask {
  for (const key of ['input', 'metadata', 'durable', 'admissionIdentity', 'admittedRuntimeId'] as const) {
    Object.defineProperty(task, key, {
      value: task[key] === undefined ? undefined : immutableJSON(task[key]),
      enumerable: true, writable: false, configurable: false,
    });
  }
  return task;
}

export function isDesireAgentAdmission(input: Pick<TaskInput, 'type' | 'handler' | 'input' | 'metadata'>): boolean {
  const handler = input.handler || DEFAULT_HANDLERS[input.type];
  if (LEGACY_DESIRE_HANDLERS.has(handler)) return false;
  if (handler === DESIRE_AGENT_HANDLER) {
    return input.type === 'desire_generate' && input.input?.agentId === 'desire-agent';
  }
  const internalTaskType = DESIRE_AGENT_INTERNAL_HANDLERS.get(handler);
  if (internalTaskType) {
    return input.type === internalTaskType
      && input.metadata?.producer === 'desire-agent'
      && input.input?.triggeredBy === 'desire-agent';
  }
  return !DESIRE_AGENT_TASK_TYPES.has(input.type);
}

const DEFAULT_LANE_CONFIGS: Record<ResourceLaneId, LaneConfig & { id: ResourceLaneId; cooldownMs: number }> = {
  'local-llm': {
    id: 'local-llm',
    maxConcurrent: 1,
    cooldownMs: 0,
  },
  'vector-index': {
    id: 'vector-index',
    maxConcurrent: 1,
    cooldownMs: 0,
  },
  'remote-llm': {
    id: 'remote-llm',
    maxConcurrent: 5,
    cooldownMs: 0,
  },
};

export interface QueueManagerOptions extends Partial<QueueConfig> {
  historyLimit?: number;
  outputReplayLimit?: number;
}

export class UnifiedQueueManager {
  private runtimeId: string = randomUUID();
  private recoveryUser?: () => string | null;
  private readonly tasks = new Map<string, QueuedTask>();
  private readonly bodyOwners = new Map<string, BodyLease>();
  private readonly terminalOrder: string[] = [];
  private readonly inFlightRemote = new Map<string, RemoteTaskHandle>();
  private readonly listeners = new Set<QueueEventListener>();
  private readonly resources = new Map<WorkResource, ResourceLane>();
  private readonly idempotency = new Map<string, string>();
  private config: QueueConfig | null = null;
  private paused = false;
  private historyLimit: number;
  private outputReplayLimit: number;
  private onQueueChange?: () => void;
  private committed!: ReturnType<UnifiedQueueManager['snapshot']>;
  private committedIdentity = '';
  private unconfirmedCommit = false;

  constructor(options: QueueManagerOptions = {}) {
    this.historyLimit = Math.max(1, options.historyLimit ?? 200);
    this.outputReplayLimit = Math.max(1, options.outputReplayLimit ?? 1_000);
    this.initializeResources();
    this.committed = this.snapshot();
    this.committedIdentity = canonicalJSON(this.committed);
    if (options.lanes || options.enabled !== undefined) {
      this.configure(options as QueueConfig);
    }
  }

  /** The server supplies its authenticated session owner; pure ledger users do not own login. */
  configureRecovery(runtimeId: string, user: () => string | null): void {
    this.runtimeId = runtimeId;
    this.recoveryUser = user;
  }

  private recoveryEligible(task: QueuedTask): boolean {
    if (!this.recoveryUser) return true;
    const recovered = task.admittedRuntimeId !== this.runtimeId
      || (task.durable && task.durable.originRuntimeId !== this.runtimeId)
      || task.handler === 'graph.signal';
    return !recovered || this.recoveryUser() === task.username;
  }

  private initializeResources(): void {
    for (const laneId of RESOURCE_LANES) {
      this.resources.set(laneId, {
        config: { ...DEFAULT_LANE_CONFIGS[laneId] },
        currentRunning: 0,
      });
    }
  }

  configure(config: QueueConfig): void {
    this.config = config;
    for (const laneId of RESOURCE_LANES) {
      const configured = config.lanes?.[laneId];
      if (!configured) continue;
      const existing = this.resources.get(laneId)!;
      existing.config = {
        ...existing.config,
        ...configured,
        id: laneId,
        maxConcurrent: Math.max(1, configured.maxConcurrent || existing.config.maxConcurrent),
        cooldownMs: Math.max(0, configured.cooldownMs ?? existing.config.cooldownMs),
      };
    }
    this.notifyChange();
  }

  setOnQueueChange(callback: () => void): void {
    this.onQueueChange = callback;
  }

  addEventListener(listener: QueueEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: QueueEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: Omit<QueueEvent, 'timestamp'>): void {
    // Lifecycle publication is an acknowledgement of a committed mutation.
    this.notifyChange();
    const fullEvent: QueueEvent = { ...event, timestamp: new Date().toISOString() };
    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (error) {
        console.error('[WorkCoordinator] Listener error:', error);
      }
    }
  }

  private laneFor(resource: WorkResource, type: TaskType): ResourceLaneId {
    if (RESOURCE_LANES.includes(resource as ResourceLaneId)) return resource as ResourceLaneId;
    return TASK_LANE_MAP[type];
  }

  private idempotencyScope(input: Pick<TaskInput, 'username' | 'idempotencyKey' | 'durable'>): string | undefined {
    if (input.durable) return `${input.username}:execution:${input.durable.executionId}:${input.durable.effectId}`;
    return input.idempotencyKey ? `${input.username}:${input.idempotencyKey}` : undefined;
  }

  enqueue(input: TaskInput): QueuedTask {
    return this.admit(input);
  }

  /** Persist non-dispatch at the same identity owner used by ordinary admission. */
  cancelAdmission(input: TaskInput, reason = 'Cancelled'): QueuedTask {
    if (!input.durable) throw new Error('Cancelled admission requires a durable execution reference');
    return this.admit(input, reason);
  }

  private admit(input: TaskInput, cancellationReason?: string): QueuedTask {
    if (this.unconfirmedCommit) this.notifyChange();
    input = immutableJSON(input);
    if (!input.username?.trim()) throw new Error('Work item username is required');
    if (!input.type) throw new Error('Work item type is required');
    const handler = input.handler || DEFAULT_HANDLERS[input.type];
    const admissionIdentity = input.durable ? canonicalJSON({
      ...input, handler, resource: input.resource || TASK_LANE_MAP[input.type],
      priority: input.priority || DEFAULT_PRIORITIES[input.type], source: input.source || 'system',
    }) : undefined;
    if (!isDesireAgentAdmission(input)) {
      if (handler === DESIRE_AGENT_HANDLER) {
        throw new Error('Desire generation must be admitted as the public Desire Agent');
      }
      throw new Error('Desire lifecycle work must be admitted by the Desire Agent');
    }

    const scope = this.idempotencyScope(input);
    if (input.durable && (!input.durable.executionId || !input.durable.effectId
      || !['resume', 'reconcile'].includes(input.durable.recovery))) {
      throw new Error('Durable work requires an execution, effect, and recovery contract');
    }
    if (scope) {
      const existingId = this.idempotency.get(scope);
      const existing = existingId ? this.tasks.get(existingId) : undefined;
      if (existing && (input.durable || !TERMINAL_STATES.has(existing.state))) {
        if (input.durable && existing.admissionIdentity !== admissionIdentity) {
          throw new Error(`Durable admission conflict: ${input.durable.effectId}`);
        }
        if (cancellationReason !== undefined && existing.state === 'queued' && !existing.startedAt && !existing.bodyLease) {
          const event = this.applyCancellation(existing, cancellationReason);
          this.notifyChange();
          if (event) this.emit(event);
          return existing;
        }
        // A previous attempt may have failed while persisting admission.
        this.notifyChange();
        return existing;
      }
      this.idempotency.delete(scope);
    }

    const createdAt = new Date().toISOString();
    const resource = input.resource || TASK_LANE_MAP[input.type];
    const resourceLane = this.laneFor(resource, input.type);
    const maxAttempts = input.type === 'user_message'
      || input.type === 'desire_execute'
      || input.type === 'desire_review'
      ? 1
      : Math.max(
          1,
          input.maxAttempts
            ?? this.config?.execution?.maxAttempts
            ?? 3,
        );

    const task: QueuedTask = {
      id: `task-${Date.now()}-${randomUUID().slice(0, 8)}`,
      admittedRuntimeId: this.runtimeId,
      type: input.type,
      handler,
      state: cancellationReason !== undefined ? 'cancelled' : 'queued',
      priority: input.priority || DEFAULT_PRIORITIES[input.type],
      source: input.source || 'system',
      username: input.username,
      cognitiveMode: input.cognitiveMode,
      resource,
      createdAt,
      ...(cancellationReason !== undefined ? { cancellationReason, completedAt: createdAt } : {}),
      notBefore: input.notBefore,
      deadline: input.deadline,
      parentTaskId: input.parentTaskId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      durable: input.durable,
      admissionIdentity,
      attempt: 0,
      maxAttempts,
      input: input.input,
      callbackHandler: input.callbackHandler,
      metadata: input.metadata,
    };

    protectAdmission(task);
    this.tasks.set(task.id, task);
    if (scope) this.idempotency.set(scope, task.id);
    const cancellationEvents: Omit<QueueEvent, 'timestamp'>[] = [];
    if (cancellationReason !== undefined) this.addTerminal(task);
    if (cancellationReason === undefined && task.type === 'environment_command' && task.input.type === 'stop') {
      for (const prior of [...this.tasks.values()]) {
        if (prior.type === 'environment_command' && prior.input.sessionId === task.input.sessionId
          && prior.input.type !== 'stop' && ['queued', 'waiting'].includes(prior.state)) {
          const event = this.applyCancellation(prior, 'Superseded by semantic stop');
          if (event) cancellationEvents.push(event);
        }
      }
    }
    // Stop admission and supersession are one ledger transition. Publishing a
    // partial cancellation set could let old queued motion run after the stop.
    this.notifyChange();
    for (const event of cancellationEvents) this.emit(event);
    this.emit({
      type: cancellationReason !== undefined ? 'task_cancelled' : 'task_enqueued',
      taskId: task.id,
      lane: resourceLane,
      details: { type: task.type, handler: task.handler, priority: task.priority, source: task.source },
    });
    return task;
  }

  enqueueUserMessage(message: string, username: string, options: Partial<TaskInput> = {}): QueuedTask {
    return this.enqueue({
      type: 'user_message',
      handler: options.handler || 'chat.persona',
      resource: options.resource || 'local-llm',
      source: options.source || 'user',
      input: { message, ...options.input },
      username,
      priority: 'critical',
      ...options,
    });
  }

  private sortTasks(tasks: QueuedTask[]): QueuedTask[] {
    return tasks.sort((left, right) =>
      PRIORITY_VALUES[left.priority] - PRIORITY_VALUES[right.priority]
      || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      || left.id.localeCompare(right.id));
  }

  private capacityFor(task: QueuedTask): ResourceLane {
    let resource = this.resources.get(task.resource);
    if (!resource) {
      resource = {
        config: { id: this.laneFor(task.resource, task.type), maxConcurrent: 1, cooldownMs: 0 },
        currentRunning: 0,
      };
      this.resources.set(task.resource, resource);
    }
    return resource;
  }

  private isResourceAvailable(task: QueuedTask, now = Date.now()): boolean {
    const resource = this.capacityFor(task);
    if (resource.currentRunning >= resource.config.maxConcurrent) return false;
    if (task.type === 'environment_command' && task.input?.type !== 'stop') {
      const bodyId = task.input?.sessionId;
      if ([...this.tasks.values()].some(other => other.id !== task.id && !TERMINAL_STATES.has(other.state)
        && (other.bodyLease?.bodyId === bodyId
          || (other.type === 'environment_command' && other.input?.sessionId === bodyId && other.input?.type === 'stop'
            && this.recoveryEligible(other))))) return false;
    }
    if (resource.lastExecutionAt && resource.config.cooldownMs > 0) {
      return now - new Date(resource.lastExecutionAt).getTime() >= resource.config.cooldownMs;
    }
    return true;
  }

  private reconcileTimeBounds(now = Date.now()): void {
    for (const task of this.tasks.values()) {
      if ((task.state !== 'queued' && task.state !== 'waiting') || !task.deadline || task.bodyLease) continue;
      if (new Date(task.deadline).getTime() <= now) this.expire(task.id);
    }
  }

  getNextExecutable(canHandle?: (task: QueuedTask) => boolean): QueuedTask | null {
    if (this.unconfirmedCommit) this.notifyChange();
    if (this.paused) return null;
    const now = Date.now();
    this.reconcileTimeBounds(now);
    const candidates = this.sortTasks([...this.tasks.values()].filter(task => {
      if (task.state !== 'queued') return false;
      if (!this.recoveryEligible(task)) return false;
      if (task.cancellationRequestedAt) return false;
      if (task.notBefore && new Date(task.notBefore).getTime() > now) return false;
      if (!this.isResourceAvailable(task, now)) return false;
      return canHandle ? canHandle(task) : true;
    }));
    return candidates[0] || null;
  }

  claim(taskId: string, leaseOwner = 'execution-engine'): QueuedTask | null {
    if (this.unconfirmedCommit) this.notifyChange();
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'queued' || task.cancellationRequestedAt || this.paused) return null;
    if (!this.recoveryEligible(task)) return null;
    const now = Date.now();
    if (task.notBefore && new Date(task.notBefore).getTime() > now) return null;
    if (task.deadline && new Date(task.deadline).getTime() <= now) {
      this.expire(task.id);
      return null;
    }
    if (!this.isResourceAvailable(task, now)) return null;

    task.state = 'leased';
    task.leaseOwner = leaseOwner;
    task.startedAt = new Date(now).toISOString();
    if (task.type === 'environment_command') {
      const bodyId = String(task.input.sessionId);
      const current = this.bodyOwners.get(bodyId);
      task.bodyLease = Object.freeze({ bodyId, executionId: task.durable?.executionId ?? task.id,
        generation: (current?.generation ?? 0) + 1 });
      this.bodyOwners.set(bodyId, task.bodyLease);
    }
    this.capacityFor(task).currentRunning += 1;
    this.notifyChange();
    this.emit({
      type: 'task_started',
      taskId: task.id,
      lane: this.laneFor(task.resource, task.type),
      details: { type: task.type, handler: task.handler, attempt: task.attempt },
    });
    return task;
  }

  hasCurrentBodyLease(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    const lease = task?.bodyLease;
    const current = lease && this.bodyOwners.get(lease.bodyId);
    return !this.unconfirmedCommit && Boolean(lease && current
      && lease.generation === current.generation && lease.executionId === current.executionId);
  }

  assertBodyLease(taskId: string): BodyLease {
    const task = this.tasks.get(taskId);
    if (!this.hasCurrentBodyLease(taskId)) throw new Error('Stale body ownership');
    if (task?.cancellationRequestedAt || task?.state === 'cancelled') throw new Error('Body work was cancelled');
    return task!.bodyLease!;
  }

  private releaseCapacity(task: QueuedTask): void {
    const resource = this.capacityFor(task);
    resource.currentRunning = Math.max(0, resource.currentRunning - 1);
    resource.lastExecutionAt = new Date().toISOString();
    task.leaseOwner = undefined;
  }

  private normalizeError(error: string | WorkError | undefined, fallbackCode: string, retryable = false): WorkError | undefined {
    if (!error) return undefined;
    if (typeof error !== 'string') return error;
    return { code: fallbackCode, message: error, retryable };
  }

  private addTerminal(task: QueuedTask): void {
    if (!this.terminalOrder.includes(task.id)) this.terminalOrder.unshift(task.id);
    const scope = this.idempotencyScope(task);
    if (!task.durable && scope && this.idempotency.get(scope) === task.id) this.idempotency.delete(scope);
    while (this.terminalOrder.length > this.historyLimit) {
      const removedId = this.terminalOrder.pop();
      if (removedId && !this.tasks.get(removedId)?.durable) this.tasks.delete(removedId);
    }
  }

  complete(
    taskId: string,
    success: boolean,
    resultOrError?: Record<string, any> | string | WorkError,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task || !['leased', 'waiting'].includes(task.state)) return;
    if (task.state === 'leased') this.releaseCapacity(task);
    task.state = success ? 'completed' : 'failed';
    task.completedAt = new Date().toISOString();
    if (success && resultOrError && typeof resultOrError !== 'string' && !('message' in resultOrError && 'retryable' in resultOrError)) {
      task.result = resultOrError;
      task.error = undefined;
    } else if (!success) {
      task.error = this.normalizeError(resultOrError as string | WorkError | undefined, 'execution_failed');
    }
    this.addTerminal(task);
    this.notifyChange();
    this.emit({
      type: success ? 'task_completed' : 'task_failed',
      taskId,
      lane: this.laneFor(task.resource, task.type),
      details: { type: task.type, handler: task.handler, error: task.error },
    });
  }

  requeue(task: QueuedTask, error?: string | WorkError): boolean {
    const current = this.tasks.get(task.id);
    if (!current || current.state !== 'leased') return false;
    const failure = this.normalizeError(error, 'execution_failed', true);
    if (current.bodyLease || failure?.code === 'outcome_unknown') {
      current.error = failure?.code === 'outcome_unknown' ? failure
        : { code: 'outcome_unknown', message: 'Interrupted physical action requires a correlated result or reconciliation', retryable: false };
      this.wait(current.id, 'outcome_unknown');
      return false;
    }
    if (current.cancellationRequestedAt) {
      this.acknowledgeCancellation(current.id);
      return false;
    }
    if (current.durable?.recovery === 'reconcile') {
      // A reported handler failure is known. Publish it to the parent; do not
      // automatically replay a non-replayable effect or invent uncertainty.
      this.complete(current.id, false, { ...(failure ?? { code: 'execution_failed', message: 'Handler failed' }), retryable: false });
      return false;
    }
    if (failure?.retryable === false) {
      this.complete(current.id, false, failure);
      return false;
    }
    if (current.type === 'user_message'
      || current.type === 'desire_execute'
      || current.type === 'desire_review') current.maxAttempts = 1;
    this.releaseCapacity(current);
    current.attempt += 1;
    if (current.attempt >= current.maxAttempts) {
      current.state = 'failed';
      current.completedAt = new Date().toISOString();
      const exhausted = this.normalizeError(error || 'Maximum attempts exhausted', 'attempts_exhausted');
      current.error = exhausted && { ...exhausted, retryable: false };
      this.addTerminal(current);
      this.emit({ type: 'task_failed', taskId: current.id, lane: this.laneFor(current.resource, current.type), details: { error: current.error } });
      this.notifyChange();
      return false;
    }

    current.state = 'queued';
    current.startedAt = undefined;
    current.error = this.normalizeError(error, 'retryable_failure', true);
    this.emit({
      type: 'task_retried',
      taskId: current.id,
      lane: this.laneFor(current.resource, current.type),
      details: { attempt: current.attempt, maxAttempts: current.maxAttempts },
    });
    this.notifyChange();
    return true;
  }

  wait(taskId: string, reason: string, wakeAt?: string): QueuedTask | null {
    const task = this.tasks.get(taskId);
    if (!task || (task.state !== 'queued' && task.state !== 'leased')) return null;
    if (task.state === 'leased') this.releaseCapacity(task);
    task.state = 'waiting';
    task.waitingReason = reason;
    task.wakeAt = wakeAt;
    task.notBefore = wakeAt || task.notBefore;
    this.emit({ type: 'task_waiting', taskId, lane: this.laneFor(task.resource, task.type), details: { reason, wakeAt } });
    this.notifyChange();
    return task;
  }

  releaseWaiting(now = Date.now()): number {
    let released = 0;
    for (const task of this.tasks.values()) {
      if (task.bodyLease || task.state !== 'waiting' || !task.wakeAt || new Date(task.wakeAt).getTime() > now) continue;
      task.state = 'queued';
      task.waitingReason = undefined;
      task.wakeAt = undefined;
      task.notBefore = undefined;
      released += 1;
    }
    if (released > 0) this.notifyChange();
    return released;
  }

  cancel(taskId: string, reason = 'Cancelled'): QueuedTask | null {
    const task = this.tasks.get(taskId);
    if (!task || TERMINAL_STATES.has(task.state)) return null;
    const event = this.applyCancellation(task, reason);
    if (event) {
      this.notifyChange();
      this.emit(event);
    }
    return task;
  }

  private applyCancellation(task: QueuedTask, reason: string): Omit<QueueEvent, 'timestamp'> | null {
    if (task.state === 'leased' || (task.state === 'waiting' && task.bodyLease)) {
      if (task.cancellationRequestedAt) return null;
      task.cancellationRequestedAt = new Date().toISOString();
      task.cancellationReason = reason;
      return { type: 'task_cancel_requested', taskId: task.id, lane: this.laneFor(task.resource, task.type), details: { reason } };
    }
    task.state = 'cancelled';
    task.cancellationReason = reason;
    task.completedAt = new Date().toISOString();
    this.addTerminal(task);
    return { type: 'task_cancelled', taskId: task.id, lane: this.laneFor(task.resource, task.type), details: { reason } };
  }

  acknowledgeCancellation(taskId: string, result?: Record<string, any>): QueuedTask | null {
    const task = this.tasks.get(taskId);
    if (!task || !['leased', 'waiting'].includes(task.state) || !task.cancellationRequestedAt) return null;
    if (task.state === 'leased') this.releaseCapacity(task);
    task.state = 'cancelled';
    if (result) task.result = result;
    task.completedAt = new Date().toISOString();
    this.addTerminal(task);
    this.notifyChange();
    this.emit({ type: 'task_cancelled', taskId, lane: this.laneFor(task.resource, task.type), details: { reason: task.cancellationReason } });
    return task;
  }

  expire(taskId: string): QueuedTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.bodyLease || (task.state !== 'queued' && task.state !== 'waiting')) return null;
    task.state = 'expired';
    task.completedAt = new Date().toISOString();
    task.error = { code: 'deadline_expired', message: 'Work deadline expired before execution', retryable: false };
    this.addTerminal(task);
    this.emit({ type: 'task_expired', taskId, lane: this.laneFor(task.resource, task.type), details: { deadline: task.deadline } });
    this.notifyChange();
    return task;
  }

  appendOutput(taskId: string, chunk: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.output ||= [];
    task.output.push(chunk);
    if (task.output.length > this.outputReplayLimit) {
      task.output.splice(0, task.output.length - this.outputReplayLimit);
    }
    this.emit({ type: 'task_output', taskId, lane: this.laneFor(task.resource, task.type), details: { chunk } });
    this.notifyChange();
  }

  getOutput(taskId: string): string[] {
    return [...(this.tasks.get(taskId)?.output || [])];
  }

  hasTaskOfType(type: TaskType, username?: string): boolean {
    return [...this.tasks.values()].some(task =>
      !TERMINAL_STATES.has(task.state)
      && task.type === type
      && (!username || task.username === username));
  }

  getTask(taskId: string): QueuedTask | null {
    return this.tasks.get(taskId) || null;
  }

  findTask(match: (task: QueuedTask) => boolean): QueuedTask | null {
    return [...this.tasks.values()].find(match) || null;
  }

  attachExecution(taskId: string, executionId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'leased') throw new Error('Only leased work can enter a graph execution');
    task.graphExecutions ??= [];
    if (!task.graphExecutions.includes(executionId)) task.graphExecutions.push(executionId);
    this.notifyChange();
  }

  getAllTasks(): QueuedTask[] {
    return this.sortTasks([...this.tasks.values()].filter(task => !TERMINAL_STATES.has(task.state)));
  }

  getHistory(): QueuedTask[] {
    return this.terminalOrder.map(id => this.tasks.get(id)).filter((task): task is QueuedTask => Boolean(task));
  }

  pause(): void {
    this.paused = true;
    this.emit({ type: 'lane_blocked', details: { reason: 'coordinator_paused' } });
    this.notifyChange();
  }

  resume(): void {
    this.paused = false;
    this.emit({ type: 'lane_unblocked', details: { reason: 'coordinator_resumed' } });
    this.notifyChange();
  }

  isPaused(): boolean {
    return this.paused;
  }

  getLaneStatus(laneId: ResourceLaneId): {
    queued: number;
    running: number;
    maxConcurrent: number;
    canExecute: boolean;
    paused: boolean;
  } {
    const resource = this.resources.get(laneId)!;
    const matching = [...this.tasks.values()].filter(task => this.laneFor(task.resource, task.type) === laneId);
    return {
      queued: matching.filter(task => task.state === 'queued' || task.state === 'waiting').length,
      running: matching.filter(task => task.state === 'leased').length,
      maxConcurrent: resource.config.maxConcurrent,
      canExecute: resource.currentRunning < resource.config.maxConcurrent,
      paused: false,
    };
  }

  getStats(): {
    totalQueued: number;
    totalRunning: number;
    byLane: Record<ResourceLaneId, { queued: number; running: number }>;
    byPriority: Record<Priority, number>;
    inFlightRemote: number;
  } {
    const active = this.getAllTasks();
    const byLane = {} as Record<ResourceLaneId, { queued: number; running: number }>;
    for (const laneId of RESOURCE_LANES) {
      const matching = active.filter(task => this.laneFor(task.resource, task.type) === laneId);
      byLane[laneId] = {
        queued: matching.filter(task => task.state === 'queued' || task.state === 'waiting').length,
        running: matching.filter(task => task.state === 'leased').length,
      };
    }
    const byPriority: Record<Priority, number> = { critical: 0, high: 0, normal: 0, low: 0, background: 0 };
    for (const task of active) byPriority[task.priority] += 1;
    return {
      totalQueued: active.filter(task => task.state === 'queued' || task.state === 'waiting').length,
      totalRunning: active.filter(task => task.state === 'leased').length,
      byLane,
      byPriority,
      inFlightRemote: this.inFlightRemote.size,
    };
  }

  trackRemoteTask(handle: RemoteTaskHandle): void {
    this.inFlightRemote.set(handle.taskId, handle);
    this.emit({ type: 'remote_dispatched', taskId: handle.taskId, lane: 'remote-llm', details: { provider: handle.provider } });
    this.notifyChange();
  }

  handleRemoteCallback(result: RemoteResult): void {
    this.inFlightRemote.delete(result.taskId);
    this.emit({
      type: 'remote_callback',
      taskId: result.taskId,
      lane: 'remote-llm',
      details: { success: result.success, durationMs: result.durationMs, hasFollowUp: Boolean(result.followUpTasks?.length) },
    });
    this.complete(result.taskId, result.success, result.success ? { output: result.output } : 'Remote task failed');
    for (const followUp of result.followUpTasks || []) this.enqueue(followUp);
    this.notifyChange();
  }

  getInFlightRemote(): RemoteTaskHandle[] {
    return [...this.inFlightRemote.values()];
  }

  exportState(): QueueState {
    const items = this.getAllTasks();
    return {
      items,
      history: this.getHistory(),
      durableReceipts: [...this.tasks.values()].filter(task => task.durable
        && TERMINAL_STATES.has(task.state) && !this.terminalOrder.includes(task.id)),
      bodyOwners: Object.fromEntries(this.bodyOwners),
      inFlightRemote: this.getInFlightRemote(),
      lastUpdated: new Date().toISOString(),
    };
  }

  importState(state: QueueState): void {
    this.clear(false);
    this.bodyOwners.clear();
    for (const [bodyId, lease] of Object.entries(state.bodyOwners ?? {})) {
      if (lease.bodyId !== bodyId || !lease.executionId || !Number.isSafeInteger(lease.generation) || lease.generation < 1) {
        throw new Error('Invalid persisted body ownership');
      }
      this.bodyOwners.set(bodyId, Object.freeze({ ...lease }));
    }
    for (const rawTask of state.durableReceipts || []) {
      if (!rawTask.durable || !TERMINAL_STATES.has(rawTask.state)) throw new Error('Invalid durable admission receipt');
      const task = protectAdmission({ ...rawTask });
      this.tasks.set(task.id, task);
      this.idempotency.set(this.idempotencyScope(task)!, task.id);
    }
    // Terminal history is canonical newest-first. Normalize timestamps to
    // repair state written by older loaders that reversed history, then replay
    // oldest-first because addTerminal() prepends each receipt.
    const restoredHistory = [...(state.history || [])].sort((left, right) => {
      const leftAt = Date.parse(left.completedAt || left.createdAt);
      const rightAt = Date.parse(right.completedAt || right.createdAt);
      const normalizedLeft = Number.isFinite(leftAt) ? leftAt : 0;
      const normalizedRight = Number.isFinite(rightAt) ? rightAt : 0;
      return normalizedRight - normalizedLeft;
    });
    for (const rawTask of restoredHistory.reverse()) {
      const task = protectAdmission({ ...rawTask });
      this.tasks.set(task.id, task);
      this.addTerminal(task);
      if (task.durable) this.idempotency.set(this.idempotencyScope(task)!, task.id);
    }
    for (const rawTask of state.items || []) {
      const task = protectAdmission({ ...rawTask });
      if (task.type === 'user_message'
        || task.type === 'desire_execute'
        || task.type === 'desire_review') task.maxAttempts = 1;
      const staleTaskTimeoutMs = Math.max(0, this.config?.execution?.staleTaskTimeoutMs ?? 0);
      const createdAtMs = new Date(task.createdAt).getTime();
      const isStaleRecoveredWork = staleTaskTimeoutMs > 0
        && !task.durable
        && !task.bodyLease
        && task.source !== 'user'
        && !TERMINAL_STATES.has(task.state)
        && Number.isFinite(createdAtMs)
        && Date.now() - createdAtMs > staleTaskTimeoutMs;
      if (isStaleRecoveredWork) {
        task.state = 'expired';
        task.startedAt = undefined;
        task.leaseOwner = undefined;
        task.completedAt = new Date().toISOString();
        task.error = {
          code: 'stale_recovery_task',
          message: 'Stale non-user work was discarded during queue recovery',
          retryable: false,
        };
        this.tasks.set(task.id, task);
        this.addTerminal(task);
        continue;
      }
      if (task.state === 'leased') {
        if (!task.bodyLease) task.startedAt = undefined;
        task.leaseOwner = undefined;
        if (task.bodyLease) {
          task.state = 'waiting';
          task.waitingReason = 'outcome_unknown';
          task.wakeAt = undefined;
          task.error = { code: 'outcome_unknown', message: 'Interrupted physical action requires its adapter receipt', retryable: false };
        } else if (task.cancellationRequestedAt) {
          task.state = 'cancelled';
          task.completedAt = new Date().toISOString();
        } else if (task.durable?.recovery === 'reconcile') {
          task.state = 'waiting';
          task.waitingReason = 'outcome_unknown';
          task.wakeAt = undefined;
          task.error = { code: 'outcome_unknown', message: 'Interrupted effect requires reconciliation before another dispatch', retryable: false };
        } else if (task.durable?.recovery === 'resume' || task.graphExecutions?.length) {
          task.state = 'queued';
        } else if (++task.attempt >= task.maxAttempts) {
          task.state = 'failed';
          task.completedAt = new Date().toISOString();
          task.error = { code: 'restart_attempts_exhausted', message: 'Interrupted work exhausted its attempt budget', retryable: false };
        } else {
          task.state = 'queued';
          task.error = { code: 'restart_recovery', message: 'Interrupted work was requeued after restart', retryable: true };
        }
      }
      this.tasks.set(task.id, task);
      if (TERMINAL_STATES.has(task.state)) this.addTerminal(task);
      const scope = this.idempotencyScope(task);
      if (scope && (task.durable || !TERMINAL_STATES.has(task.state))) this.idempotency.set(scope, task.id);
    }
    for (const handle of state.inFlightRemote || []) this.inFlightRemote.set(handle.taskId, handle);
    this.notifyChange();
  }

  clear(notify = true): void {
    this.tasks.clear();
    this.terminalOrder.length = 0;
    this.idempotency.clear();
    this.inFlightRemote.clear();
    for (const resource of this.resources.values()) resource.currentRunning = 0;
    if (notify) this.notifyChange();
  }

  /** Called only after the execution owner retires its terminal checkpoint. */
  retireExecutionReceipts(executionId: string): void {
    const tasks = [...this.tasks.values()].filter(task => task.durable?.executionId === executionId);
    if (tasks.some(task => !TERMINAL_STATES.has(task.state))) throw new Error('Execution still owns unfinished work');
    for (const task of tasks) {
      this.idempotency.delete(this.idempotencyScope(task)!);
      this.tasks.delete(task.id);
      const index = this.terminalOrder.indexOf(task.id);
      if (index >= 0) this.terminalOrder.splice(index, 1);
    }
    this.notifyChange();
  }

  private notifyChange(): void {
    const candidate = this.snapshot();
    const identity = canonicalJSON(candidate);
    if (identity === this.committedIdentity && !this.unconfirmedCommit) return;
    try {
      this.onQueueChange?.();
      this.committed = candidate;
      this.committedIdentity = identity;
      this.unconfirmedCommit = false;
    } catch (error) {
      if (error instanceof WorkCommitUncertainError) {
        // Rename already published this identity. Do not manufacture an older
        // ledger in RAM or a different work ID on retry. No dispatch proceeds
        // until this exact candidate is durably confirmed.
        this.committed = candidate;
        this.committedIdentity = identity;
        this.unconfirmedCommit = true;
        throw error;
      }
      const previous = this.committed;
      this.tasks.clear();
      previous.tasks.forEach(task => this.tasks.set(task.id, protectAdmission({ ...task })));
      this.terminalOrder.splice(0, this.terminalOrder.length, ...previous.terminalOrder);
      this.idempotency.clear();
      previous.idempotency.forEach(([key, id]) => this.idempotency.set(key, id));
      this.resources.clear();
      previous.resources.forEach(([key, resource]) => this.resources.set(key, structuredClone(resource)));
      this.bodyOwners.clear();
      previous.bodyOwners.forEach(([key, lease]) => this.bodyOwners.set(key, Object.freeze({ ...lease })));
      this.inFlightRemote.clear();
      previous.inFlightRemote.forEach(([key, handle]) => this.inFlightRemote.set(key, handle));
      this.config = previous.config;
      this.paused = previous.paused;
      throw error;
    }
  }

  private snapshot() {
    return {
      tasks: structuredClone([...this.tasks.values()]),
      terminalOrder: [...this.terminalOrder],
      idempotency: [...this.idempotency],
      resources: structuredClone([...this.resources]),
      bodyOwners: structuredClone([...this.bodyOwners]),
      inFlightRemote: [...this.inFlightRemote],
      config: structuredClone(this.config),
      paused: this.paused,
    };
  }
}

let instance: UnifiedQueueManager | null = null;

export function getQueueManager(config?: QueueManagerOptions): UnifiedQueueManager {
  if (!instance) instance = new UnifiedQueueManager(config);
  else if (config?.lanes) instance.configure(config as QueueConfig);
  return instance;
}

export function resetQueueManager(): void {
  instance = null;
}
