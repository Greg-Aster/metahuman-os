/**
 * Unified Priority Queue for Active Operator
 *
 * A priority-based task queue that ensures:
 * - User messages always get processed first (critical priority)
 * - Tasks are ordered by priority, then by queue time
 * - Queue state can be persisted to disk for crash recovery
 */

import { randomUUID } from 'crypto';
import type {
  QueuedTask,
  TaskType,
  Priority,
  TaskPayload,
} from './types.js';
import {
  PRIORITY_VALUES,
  DEFAULT_TASK_PRIORITIES,
} from './types.js';

/**
 * Unified Priority Queue
 *
 * Manages task ordering with priority-based sorting.
 * Critical tasks (user messages) always go first.
 */
export class UnifiedQueue {
  private queue: QueuedTask[] = [];
  private readonly onQueueChange?: (queue: QueuedTask[]) => void;

  constructor(options?: {
    /** Callback when queue changes (for persistence) */
    onQueueChange?: (queue: QueuedTask[]) => void;
    /** Initial queue state (for restore from disk) */
    initialQueue?: QueuedTask[];
  }) {
    this.onQueueChange = options?.onQueueChange;
    if (options?.initialQueue) {
      this.queue = [...options.initialQueue];
      this.sortQueue();
    }
  }

  /**
   * Add a task to the queue.
   *
   * @param type - The type of task
   * @param payload - Task-specific payload
   * @param options - Optional priority override and username
   * @returns The queued task
   */
  enqueue(
    type: TaskType,
    payload: TaskPayload,
    options?: {
      priority?: Priority;
      username?: string;
      maxRetries?: number;
    }
  ): QueuedTask {
    const task: QueuedTask = {
      id: randomUUID(),
      type,
      priority: options?.priority ?? DEFAULT_TASK_PRIORITIES[type],
      queuedAt: new Date().toISOString(),
      payload,
      username: options?.username,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 3,
    };

    this.queue.push(task);
    this.sortQueue();
    this.notifyChange();

    return task;
  }

  /**
   * Enqueue a user message with critical priority.
   * This is a convenience method that ensures user messages always go first.
   */
  enqueueUserMessage(
    message: string,
    username: string,
    options?: {
      conversationId?: string;
      sessionId?: string;
    }
  ): QueuedTask {
    return this.enqueue(
      'user_message',
      {
        type: 'user_message',
        message,
        conversationId: options?.conversationId,
        sessionId: options?.sessionId,
      },
      {
        priority: 'critical',
        username,
      }
    );
  }

  /**
   * Get the next task without removing it from the queue.
   */
  peek(): QueuedTask | undefined {
    return this.queue[0];
  }

  /**
   * Get and remove the next task from the queue.
   */
  dequeue(): QueuedTask | undefined {
    if (this.queue.length === 0) {
      return undefined;
    }

    const task = this.queue.shift();
    this.notifyChange();
    return task;
  }

  /**
   * Re-queue a task for retry (with incremented retry count).
   * Returns false if max retries exceeded.
   */
  requeue(task: QueuedTask): boolean {
    const newRetryCount = (task.retryCount ?? 0) + 1;
    const maxRetries = task.maxRetries ?? 3;

    if (newRetryCount > maxRetries) {
      return false;
    }

    const requeuedTask: QueuedTask = {
      ...task,
      retryCount: newRetryCount,
      queuedAt: new Date().toISOString(), // Update queue time
    };

    this.queue.push(requeuedTask);
    this.sortQueue();
    this.notifyChange();
    return true;
  }

  /**
   * Remove a specific task by ID.
   */
  remove(taskId: string): boolean {
    const index = this.queue.findIndex((t) => t.id === taskId);
    if (index === -1) {
      return false;
    }

    this.queue.splice(index, 1);
    this.notifyChange();
    return true;
  }

  /**
   * Check if there are any critical priority tasks.
   */
  hasCriticalTasks(): boolean {
    return this.queue.some((t) => t.priority === 'critical');
  }

  /**
   * Check if there are any user messages waiting.
   */
  hasUserMessages(): boolean {
    return this.queue.some((t) => t.type === 'user_message');
  }

  /**
   * Get queue length.
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty.
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get all tasks (readonly).
   */
  getAll(): readonly QueuedTask[] {
    return this.queue;
  }

  /**
   * Get tasks by type.
   */
  getByType(type: TaskType): QueuedTask[] {
    return this.queue.filter((t) => t.type === type);
  }

  /**
   * Get tasks by priority.
   */
  getByPriority(priority: Priority): QueuedTask[] {
    return this.queue.filter((t) => t.priority === priority);
  }

  /**
   * Clear all tasks.
   */
  clear(): void {
    this.queue = [];
    this.notifyChange();
  }

  /**
   * Clear tasks of a specific type.
   */
  clearByType(type: TaskType): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((t) => t.type !== type);
    const removed = before - this.queue.length;
    if (removed > 0) {
      this.notifyChange();
    }
    return removed;
  }

  /**
   * Export queue state for persistence.
   */
  export(): QueuedTask[] {
    return [...this.queue];
  }

  /**
   * Import queue state from persistence.
   */
  import(tasks: QueuedTask[]): void {
    this.queue = [...tasks];
    this.sortQueue();
    this.notifyChange();
  }

  /**
   * Get queue statistics.
   */
  getStats(): {
    total: number;
    byType: Record<TaskType, number>;
    byPriority: Record<Priority, number>;
    oldestTaskAge: number | null;
  } {
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const task of this.queue) {
      byType[task.type] = (byType[task.type] || 0) + 1;
      byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;
    }

    const oldestTask = this.queue[this.queue.length - 1]; // After sorting, oldest is last
    const oldestTaskAge = oldestTask
      ? Date.now() - new Date(oldestTask.queuedAt).getTime()
      : null;

    return {
      total: this.queue.length,
      byType: byType as Record<TaskType, number>,
      byPriority: byPriority as Record<Priority, number>,
      oldestTaskAge,
    };
  }

  /**
   * Sort queue by priority (critical first), then by queue time (oldest first).
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // First, sort by priority (lower value = higher priority)
      const priorityDiff = PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Then, sort by queue time (older first)
      return new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
    });
  }

  /**
   * Notify callback of queue change.
   */
  private notifyChange(): void {
    if (this.onQueueChange) {
      this.onQueueChange(this.export());
    }
  }
}

/**
 * Create a queue with automatic disk persistence.
 * Uses the state persister to save/restore queue state.
 */
export function createPersistentQueue(
  loadState: () => QueuedTask[] | null,
  saveState: (queue: QueuedTask[]) => void
): UnifiedQueue {
  // Load initial state
  const initialQueue = loadState() || [];

  // Create queue with persistence callback
  return new UnifiedQueue({
    initialQueue,
    onQueueChange: saveState,
  });
}
