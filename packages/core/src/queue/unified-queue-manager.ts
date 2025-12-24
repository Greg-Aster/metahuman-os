/**
 * Unified Queue Manager
 *
 * Single queue system with resource-aware lanes:
 * - local-llm: Sequential execution (one at a time)
 * - vector-index: Always available (bypass queue)
 * - remote-llm: Non-blocking (fire and callback)
 */

import { randomUUID } from 'crypto';
import {
  ResourceLaneId,
  Priority,
  TaskType,
  TaskInput,
  QueuedTask,
  ResourceLane,
  LaneConfig,
  RemoteTaskHandle,
  RemoteResult,
  QueueState,
  QueueEvent,
  QueueEventListener,
  QueueConfig,
  TASK_LANE_MAP,
  DEFAULT_PRIORITIES,
  PRIORITY_VALUES,
} from './types.js';

// Default lane configurations
const DEFAULT_LANE_CONFIGS: Record<ResourceLaneId, LaneConfig> = {
  'local-llm': {
    id: 'local-llm',
    maxConcurrent: 1,
    cooldownMs: 2000,
    backends: ['vllm', 'ollama', 'llama-cpp'],
  },
  'vector-index': {
    id: 'vector-index',
    maxConcurrent: 10,
    cooldownMs: 0,
    bypassQueue: true,
  },
  'remote-llm': {
    id: 'remote-llm',
    maxConcurrent: 5,
    cooldownMs: 0,
    providers: ['runpod', 'big-brother', 'openai'],
    callbackTimeoutMs: 300000,
  },
};

export class UnifiedQueueManager {
  private lanes: Map<ResourceLaneId, ResourceLane>;
  private inFlightRemote: Map<string, RemoteTaskHandle>;
  private listeners: Set<QueueEventListener>;
  private config: QueueConfig | null = null;
  private paused: boolean = false;
  private pausedLanes: Set<ResourceLaneId> = new Set();

  // Callbacks for external integration
  private onQueueChange?: () => void;

  constructor(config?: Partial<QueueConfig>) {
    this.lanes = new Map();
    this.inFlightRemote = new Map();
    this.listeners = new Set();

    // Initialize lanes with default or custom configs
    for (const laneId of ['local-llm', 'vector-index', 'remote-llm'] as ResourceLaneId[]) {
      const laneConfig = config?.lanes?.[laneId] || DEFAULT_LANE_CONFIGS[laneId];
      this.lanes.set(laneId, {
        config: laneConfig,
        currentRunning: 0,
        tasks: [],
      });
    }

    if (config) {
      this.config = config as QueueConfig;
    }
  }

  /**
   * Set callback for queue state changes (for persistence)
   */
  setOnQueueChange(callback: () => void): void {
    this.onQueueChange = callback;
  }

  /**
   * Add event listener
   */
  addEventListener(listener: QueueEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: QueueEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit queue event to all listeners
   */
  private emit(event: Omit<QueueEvent, 'timestamp'>): void {
    const fullEvent: QueueEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        console.error('[UnifiedQueue] Listener error:', err);
      }
    }
  }

  /**
   * Enqueue a new task
   */
  enqueue(input: TaskInput): QueuedTask {
    const lane = TASK_LANE_MAP[input.type] || 'local-llm';
    const priority = input.priority || DEFAULT_PRIORITIES[input.type] || 'normal';

    const task: QueuedTask = {
      id: `task-${Date.now()}-${randomUUID().slice(0, 8)}`,
      type: input.type,
      priority,
      resourceLane: lane,
      queuedAt: new Date().toISOString(),
      payload: input.payload,
      username: input.username,
      retryCount: 0,
      maxRetries: this.config?.defaults?.maxRetries ?? 3,
      deadline: input.deadline,
      callbackHandler: input.callbackHandler,
      metadata: input.metadata,
    };

    // Get the lane and insert by priority
    const resourceLane = this.lanes.get(lane)!;
    this.insertByPriority(resourceLane.tasks, task);

    this.emit({
      type: 'task_enqueued',
      taskId: task.id,
      lane,
      details: { type: input.type, priority },
    });

    this.notifyChange();
    return task;
  }

  /**
   * Convenience method for user messages (critical priority)
   */
  enqueueUserMessage(
    message: string,
    username: string,
    options?: Partial<TaskInput>
  ): QueuedTask {
    return this.enqueue({
      type: 'user_message',
      payload: { message, ...options?.payload },
      username,
      priority: 'critical',
      ...options,
    });
  }

  /**
   * Insert task in priority order (stable sort within priority)
   */
  private insertByPriority(tasks: QueuedTask[], task: QueuedTask): void {
    const taskPriority = PRIORITY_VALUES[task.priority];
    let insertIndex = tasks.length;

    for (let i = 0; i < tasks.length; i++) {
      if (PRIORITY_VALUES[tasks[i].priority] > taskPriority) {
        insertIndex = i;
        break;
      }
    }

    tasks.splice(insertIndex, 0, task);
  }

  /**
   * Pause the queue (stops returning executable tasks)
   */
  pause(): void {
    this.paused = true;
    this.emit({ type: 'lane_blocked', lane: 'local-llm', details: { reason: 'paused' } });
  }

  /**
   * Resume the queue
   */
  resume(): void {
    this.paused = false;
    this.emit({ type: 'lane_unblocked', lane: 'local-llm', details: { reason: 'resumed' } });
  }

  /**
   * Check if queue is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause a specific lane
   */
  pauseLane(laneId: ResourceLaneId): void {
    this.pausedLanes.add(laneId);
    this.emit({ type: 'lane_blocked', lane: laneId, details: { reason: 'lane_paused' } });
    this.notifyChange();
  }

  /**
   * Resume a specific lane
   */
  resumeLane(laneId: ResourceLaneId): void {
    this.pausedLanes.delete(laneId);
    this.emit({ type: 'lane_unblocked', lane: laneId, details: { reason: 'lane_resumed' } });
    this.notifyChange();
  }

  /**
   * Check if a specific lane is paused
   */
  isLanePaused(laneId: ResourceLaneId): boolean {
    return this.pausedLanes.has(laneId);
  }

  /**
   * Get all paused lanes
   */
  getPausedLanes(): ResourceLaneId[] {
    return [...this.pausedLanes];
  }

  /**
   * Get the next executable task from any lane
   * Returns null if no tasks can run (all lanes blocked or empty)
   */
  getNextExecutable(): QueuedTask | null {
    // Don't return tasks if globally paused
    if (this.paused) {
      return null;
    }

    // Check lanes in priority order: local-llm > remote-llm > vector-index
    const laneOrder: ResourceLaneId[] = ['local-llm', 'remote-llm', 'vector-index'];

    for (const laneId of laneOrder) {
      // Skip if lane is paused
      if (this.pausedLanes.has(laneId)) {
        continue;
      }

      const lane = this.lanes.get(laneId)!;

      // Skip if at capacity
      if (lane.currentRunning >= lane.config.maxConcurrent) {
        continue;
      }

      // Skip if in cooldown
      if (lane.lastExecutionAt && lane.config.cooldownMs > 0) {
        const elapsed = Date.now() - new Date(lane.lastExecutionAt).getTime();
        if (elapsed < lane.config.cooldownMs) {
          continue;
        }
      }

      // Get next task from this lane
      if (lane.tasks.length > 0) {
        return lane.tasks[0];
      }
    }

    return null;
  }

  /**
   * Dequeue a specific task (mark as started)
   */
  dequeue(taskId: string): QueuedTask | null {
    for (const [laneId, lane] of this.lanes) {
      const index = lane.tasks.findIndex(t => t.id === taskId);
      if (index !== -1) {
        const task = lane.tasks.splice(index, 1)[0];
        task.startedAt = new Date().toISOString();
        lane.currentRunning++;

        this.emit({
          type: 'task_started',
          taskId: task.id,
          lane: laneId,
          details: { type: task.type },
        });

        this.notifyChange();
        return task;
      }
    }
    return null;
  }

  /**
   * Mark task as completed
   */
  complete(taskId: string, success: boolean, error?: string): void {
    // Find which lane was running this task
    for (const [laneId, lane] of this.lanes) {
      // Decrement running count
      if (lane.currentRunning > 0) {
        lane.currentRunning--;
        lane.lastExecutionAt = new Date().toISOString();

        this.emit({
          type: success ? 'task_completed' : 'task_failed',
          taskId,
          lane: laneId,
          details: { error },
        });

        if (lane.currentRunning === 0 && lane.tasks.length > 0) {
          this.emit({ type: 'lane_unblocked', lane: laneId });
        }

        this.notifyChange();
        return;
      }
    }
  }

  /**
   * Requeue a failed task for retry
   */
  requeue(task: QueuedTask): boolean {
    if (task.retryCount >= task.maxRetries) {
      return false;
    }

    const retriedTask: QueuedTask = {
      ...task,
      retryCount: task.retryCount + 1,
      queuedAt: new Date().toISOString(),
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
    };

    const lane = this.lanes.get(task.resourceLane)!;
    this.insertByPriority(lane.tasks, retriedTask);

    this.emit({
      type: 'task_retried',
      taskId: task.id,
      lane: task.resourceLane,
      details: { retryCount: retriedTask.retryCount },
    });

    this.notifyChange();
    return true;
  }

  /**
   * Check if a task of the given type is already queued
   */
  hasTaskOfType(type: TaskType, username?: string): boolean {
    for (const lane of this.lanes.values()) {
      for (const task of lane.tasks) {
        if (task.type === type && (!username || task.username === username)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get all tasks in a lane
   */
  getLaneTasks(laneId: ResourceLaneId): QueuedTask[] {
    return [...(this.lanes.get(laneId)?.tasks || [])];
  }

  /**
   * Get lane status
   */
  getLaneStatus(laneId: ResourceLaneId): {
    queued: number;
    running: number;
    maxConcurrent: number;
    canExecute: boolean;
    paused: boolean;
  } {
    const lane = this.lanes.get(laneId)!;
    const isPaused = this.pausedLanes.has(laneId);
    const inCooldown = lane.lastExecutionAt && lane.config.cooldownMs > 0 &&
      (Date.now() - new Date(lane.lastExecutionAt).getTime() < lane.config.cooldownMs);

    return {
      queued: lane.tasks.length,
      running: lane.currentRunning,
      maxConcurrent: lane.config.maxConcurrent,
      canExecute: !isPaused && lane.currentRunning < lane.config.maxConcurrent && !inCooldown,
      paused: isPaused,
    };
  }

  /**
   * Track a remote task (for in-flight monitoring)
   */
  trackRemoteTask(handle: RemoteTaskHandle): void {
    this.inFlightRemote.set(handle.taskId, handle);

    this.emit({
      type: 'remote_dispatched',
      taskId: handle.taskId,
      lane: 'remote-llm',
      details: { provider: handle.provider },
    });
  }

  /**
   * Handle remote task callback
   */
  handleRemoteCallback(result: RemoteResult): void {
    const handle = this.inFlightRemote.get(result.taskId);
    if (handle) {
      this.inFlightRemote.delete(result.taskId);
    }

    this.emit({
      type: 'remote_callback',
      taskId: result.taskId,
      lane: 'remote-llm',
      details: {
        success: result.success,
        durationMs: result.durationMs,
        hasFollowUp: !!result.followUpTasks?.length,
      },
    });

    // Mark the lane task as complete
    this.complete(result.taskId, result.success, result.success ? undefined : 'Remote task failed');

    // Enqueue follow-up tasks if any
    if (result.followUpTasks) {
      for (const followUp of result.followUpTasks) {
        this.enqueue(followUp);
      }
    }

    this.notifyChange();
  }

  /**
   * Get in-flight remote tasks
   */
  getInFlightRemote(): RemoteTaskHandle[] {
    return [...this.inFlightRemote.values()];
  }

  /**
   * Get all tasks across all lanes
   */
  getAllTasks(): QueuedTask[] {
    const all: QueuedTask[] = [];
    for (const lane of this.lanes.values()) {
      all.push(...lane.tasks);
    }
    return all.sort((a, b) =>
      PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority] ||
      new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
    );
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    totalQueued: number;
    totalRunning: number;
    byLane: Record<ResourceLaneId, { queued: number; running: number }>;
    byPriority: Record<Priority, number>;
    inFlightRemote: number;
  } {
    const byLane: Record<ResourceLaneId, { queued: number; running: number }> = {} as any;
    const byPriority: Record<Priority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
      background: 0,
    };

    let totalQueued = 0;
    let totalRunning = 0;

    for (const [laneId, lane] of this.lanes) {
      byLane[laneId] = {
        queued: lane.tasks.length,
        running: lane.currentRunning,
      };
      totalQueued += lane.tasks.length;
      totalRunning += lane.currentRunning;

      for (const task of lane.tasks) {
        byPriority[task.priority]++;
      }
    }

    return {
      totalQueued,
      totalRunning,
      byLane,
      byPriority,
      inFlightRemote: this.inFlightRemote.size,
    };
  }

  /**
   * Export queue state for persistence
   */
  exportState(): QueueState {
    return {
      lanes: {
        'local-llm': [...(this.lanes.get('local-llm')?.tasks || [])],
        'vector-index': [...(this.lanes.get('vector-index')?.tasks || [])],
        'remote-llm': [...(this.lanes.get('remote-llm')?.tasks || [])],
      },
      inFlightRemote: [...this.inFlightRemote.values()],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Import queue state (for recovery)
   */
  importState(state: QueueState): void {
    for (const laneId of ['local-llm', 'vector-index', 'remote-llm'] as ResourceLaneId[]) {
      const lane = this.lanes.get(laneId)!;
      lane.tasks = state.lanes[laneId] || [];
    }

    this.inFlightRemote.clear();
    for (const handle of state.inFlightRemote || []) {
      // Remote tasks are considered lost on restart - don't restore them
      // They should timeout and be retried
    }

    this.notifyChange();
  }

  /**
   * Clear all tasks (for testing/reset)
   */
  clear(): void {
    for (const lane of this.lanes.values()) {
      lane.tasks = [];
      lane.currentRunning = 0;
    }
    this.inFlightRemote.clear();
    this.notifyChange();
  }

  /**
   * Notify queue change callback
   */
  private notifyChange(): void {
    if (this.onQueueChange) {
      try {
        this.onQueueChange();
      } catch (err) {
        console.error('[UnifiedQueue] onQueueChange error:', err);
      }
    }
  }
}

// Singleton instance
let instance: UnifiedQueueManager | null = null;

export function getQueueManager(config?: Partial<QueueConfig>): UnifiedQueueManager {
  if (!instance) {
    instance = new UnifiedQueueManager(config);
  }
  return instance;
}

export function resetQueueManager(): void {
  instance = null;
}
