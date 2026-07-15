/**
 * Single-ledger work coordinator.
 *
 * Resource lanes limit concurrency. They never own task ordering or lifecycle.
 */

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_HANDLERS,
  DEFAULT_PRIORITIES,
  PRIORITY_VALUES,
  TASK_LANE_MAP,
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
} from './types.js';

const RESOURCE_LANES: ResourceLaneId[] = ['local-llm', 'vector-index', 'remote-llm'];
const TERMINAL_STATES = new Set<WorkState>(['completed', 'failed', 'cancelled', 'expired']);

const DEFAULT_LANE_CONFIGS: Record<ResourceLaneId, LaneConfig & { id: ResourceLaneId; cooldownMs: number }> = {
  'local-llm': {
    id: 'local-llm',
    maxConcurrent: 1,
    cooldownMs: 0,
  },
  'vector-index': {
    id: 'vector-index',
    maxConcurrent: 10,
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
  private readonly tasks = new Map<string, QueuedTask>();
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

  constructor(options: QueueManagerOptions = {}) {
    this.historyLimit = Math.max(1, options.historyLimit ?? 200);
    this.outputReplayLimit = Math.max(1, options.outputReplayLimit ?? 1_000);
    this.initializeResources();
    if (options.lanes || options.enabled !== undefined) {
      this.configure(options as QueueConfig);
    }
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

  private idempotencyScope(input: TaskInput): string | undefined {
    return input.idempotencyKey ? `${input.username}:${input.idempotencyKey}` : undefined;
  }

  enqueue(input: TaskInput): QueuedTask {
    if (!input.username?.trim()) throw new Error('Work item username is required');
    if (!input.type) throw new Error('Work item type is required');

    const scope = this.idempotencyScope(input);
    if (scope) {
      const existingId = this.idempotency.get(scope);
      const existing = existingId ? this.tasks.get(existingId) : undefined;
      if (existing && !TERMINAL_STATES.has(existing.state)) return existing;
      this.idempotency.delete(scope);
    }

    const createdAt = new Date().toISOString();
    const resource = input.resource || TASK_LANE_MAP[input.type];
    const resourceLane = this.laneFor(resource, input.type);
    const maxAttempts = Math.max(
      1,
      input.maxAttempts
        ?? this.config?.execution?.maxAttempts
        ?? 3,
    );

    const task: QueuedTask = {
      id: `task-${Date.now()}-${randomUUID().slice(0, 8)}`,
      type: input.type,
      handler: input.handler || DEFAULT_HANDLERS[input.type],
      state: 'queued',
      priority: input.priority || DEFAULT_PRIORITIES[input.type],
      source: input.source || 'system',
      username: input.username,
      cognitiveMode: input.cognitiveMode,
      resource,
      createdAt,
      notBefore: input.notBefore,
      deadline: input.deadline,
      parentTaskId: input.parentTaskId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      attempt: 0,
      maxAttempts,
      input: input.input,
      callbackHandler: input.callbackHandler,
      metadata: input.metadata,
    };

    this.tasks.set(task.id, task);
    if (scope) this.idempotency.set(scope, task.id);
    this.emit({
      type: 'task_enqueued',
      taskId: task.id,
      lane: resourceLane,
      details: { type: task.type, handler: task.handler, priority: task.priority, source: task.source },
    });
    this.notifyChange();
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
    if (resource.lastExecutionAt && resource.config.cooldownMs > 0) {
      return now - new Date(resource.lastExecutionAt).getTime() >= resource.config.cooldownMs;
    }
    return true;
  }

  private reconcileTimeBounds(now = Date.now()): void {
    for (const task of this.tasks.values()) {
      if ((task.state !== 'queued' && task.state !== 'waiting') || !task.deadline) continue;
      if (new Date(task.deadline).getTime() <= now) this.expire(task.id);
    }
  }

  getNextExecutable(canHandle?: (task: QueuedTask) => boolean): QueuedTask | null {
    if (this.paused) return null;
    const now = Date.now();
    this.reconcileTimeBounds(now);
    const candidates = this.sortTasks([...this.tasks.values()].filter(task => {
      if (task.state !== 'queued') return false;
      if (task.cancellationRequestedAt) return false;
      if (task.notBefore && new Date(task.notBefore).getTime() > now) return false;
      if (!this.isResourceAvailable(task, now)) return false;
      return canHandle ? canHandle(task) : true;
    }));
    return candidates[0] || null;
  }

  claim(taskId: string, leaseOwner = 'execution-engine'): QueuedTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'queued' || this.paused) return null;
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
    this.capacityFor(task).currentRunning += 1;
    this.emit({
      type: 'task_started',
      taskId: task.id,
      lane: this.laneFor(task.resource, task.type),
      details: { type: task.type, handler: task.handler, attempt: task.attempt },
    });
    this.notifyChange();
    return task;
  }

  private releaseCapacity(task: QueuedTask): void {
    const resource = this.capacityFor(task);
    resource.currentRunning = Math.max(0, resource.currentRunning - 1);
    resource.lastExecutionAt = new Date().toISOString();
    task.leaseOwner = undefined;
  }

  private normalizeError(error: string | WorkError | undefined, fallbackCode: string): WorkError | undefined {
    if (!error) return undefined;
    if (typeof error !== 'string') return error;
    return { code: fallbackCode, message: error, retryable: false };
  }

  private addTerminal(task: QueuedTask): void {
    if (!this.terminalOrder.includes(task.id)) this.terminalOrder.unshift(task.id);
    const scope = task.idempotencyKey ? `${task.username}:${task.idempotencyKey}` : undefined;
    if (scope && this.idempotency.get(scope) === task.id) this.idempotency.delete(scope);
    while (this.terminalOrder.length > this.historyLimit) {
      const removedId = this.terminalOrder.pop();
      if (removedId) this.tasks.delete(removedId);
    }
  }

  complete(
    taskId: string,
    success: boolean,
    resultOrError?: Record<string, any> | string | WorkError,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'leased') return;
    this.releaseCapacity(task);
    task.state = success ? 'completed' : 'failed';
    task.completedAt = new Date().toISOString();
    if (success && resultOrError && typeof resultOrError !== 'string' && !('message' in resultOrError && 'retryable' in resultOrError)) {
      task.result = resultOrError;
      task.error = undefined;
    } else if (!success) {
      task.error = this.normalizeError(resultOrError as string | WorkError | undefined, 'execution_failed');
    }
    this.addTerminal(task);
    this.emit({
      type: success ? 'task_completed' : 'task_failed',
      taskId,
      lane: this.laneFor(task.resource, task.type),
      details: { type: task.type, handler: task.handler, error: task.error },
    });
    this.notifyChange();
  }

  requeue(task: QueuedTask, error?: string | WorkError): boolean {
    const current = this.tasks.get(task.id);
    if (!current || current.state !== 'leased') return false;
    this.releaseCapacity(current);
    current.attempt += 1;
    if (current.attempt >= current.maxAttempts) {
      current.state = 'failed';
      current.completedAt = new Date().toISOString();
      current.error = this.normalizeError(error || 'Maximum attempts exhausted', 'attempts_exhausted');
      this.addTerminal(current);
      this.emit({ type: 'task_failed', taskId: current.id, lane: this.laneFor(current.resource, current.type), details: { error: current.error } });
      this.notifyChange();
      return false;
    }

    current.state = 'queued';
    current.startedAt = undefined;
    current.error = this.normalizeError(error, 'retryable_failure');
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
      if (task.state !== 'waiting' || !task.wakeAt || new Date(task.wakeAt).getTime() > now) continue;
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
    if (task.state === 'leased') {
      task.cancellationRequestedAt = new Date().toISOString();
      task.cancellationReason = reason;
      this.emit({ type: 'task_cancel_requested', taskId, lane: this.laneFor(task.resource, task.type), details: { reason } });
      this.notifyChange();
      return task;
    }
    task.state = 'cancelled';
    task.cancellationReason = reason;
    task.completedAt = new Date().toISOString();
    this.addTerminal(task);
    this.emit({ type: 'task_cancelled', taskId, lane: this.laneFor(task.resource, task.type), details: { reason } });
    this.notifyChange();
    return task;
  }

  acknowledgeCancellation(taskId: string): QueuedTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'leased' || !task.cancellationRequestedAt) return null;
    this.releaseCapacity(task);
    task.state = 'cancelled';
    task.completedAt = new Date().toISOString();
    this.addTerminal(task);
    this.emit({ type: 'task_cancelled', taskId, lane: this.laneFor(task.resource, task.type), details: { reason: task.cancellationReason } });
    this.notifyChange();
    return task;
  }

  expire(taskId: string): QueuedTask | null {
    const task = this.tasks.get(taskId);
    if (!task || (task.state !== 'queued' && task.state !== 'waiting')) return null;
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

  getAllTasks(): QueuedTask[] {
    return this.sortTasks([...this.tasks.values()].filter(task => !TERMINAL_STATES.has(task.state)));
  }

  getHistory(): QueuedTask[] {
    return this.terminalOrder.map(id => this.tasks.get(id)).filter((task): task is QueuedTask => Boolean(task));
  }

  clearQueued(): number {
    const candidates = [...this.tasks.values()].filter(task =>
      task.state === 'queued' || task.state === 'waiting');
    for (const task of candidates) this.cancel(task.id, 'Cancelled by clear queued');
    this.emit({ type: 'lane_cleared', details: { cancelled: candidates.length, runningPreserved: true } });
    return candidates.length;
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
      inFlightRemote: this.getInFlightRemote(),
      lastUpdated: new Date().toISOString(),
    };
  }

  importState(state: QueueState): void {
    this.clear(false);
    for (const rawTask of state.items || []) {
      const task: QueuedTask = { ...rawTask, input: { ...rawTask.input } };
      const staleTaskTimeoutMs = Math.max(0, this.config?.execution?.staleTaskTimeoutMs ?? 0);
      const createdAtMs = new Date(task.createdAt).getTime();
      const isStaleRecoveredWork = staleTaskTimeoutMs > 0
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
        task.attempt += 1;
        task.startedAt = undefined;
        task.leaseOwner = undefined;
        task.cancellationRequestedAt = undefined;
        if (task.attempt >= task.maxAttempts) {
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
      else if (task.idempotencyKey) this.idempotency.set(`${task.username}:${task.idempotencyKey}`, task.id);
    }
    for (const rawTask of state.history || []) {
      const task: QueuedTask = { ...rawTask, input: { ...rawTask.input } };
      this.tasks.set(task.id, task);
      this.addTerminal(task);
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

  private notifyChange(): void {
    try {
      this.onQueueChange?.();
    } catch (error) {
      console.error('[WorkCoordinator] onQueueChange error:', error);
    }
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
